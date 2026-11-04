import { readFileSync } from 'node:fs';
import process from 'node:process';
import { grid5x5 } from '../src/fixtures/grid5x5';
import { town } from '../src/fixtures/town';
import { lonLatToLocal } from '../src/geo/projection';
import { importOsm } from '../src/importers/osm';
import { compile, type CompiledCity } from '../src/network';
import { readZip } from '../src/project/zip';
import { migrateCity } from '../src/schema/migrate';
import {
  createRouteProvider,
  freeFlowLinkCosts,
  type Route,
  type RouteRequest,
} from '../src/routing';
import type { City } from '../src/schema';

export const auditCauses = [
  'lane_distance',
  'dropped_lane',
  'illegal_movement',
  'boundary_dead_end',
] as const;
type Cause = (typeof auditCauses)[number];
export interface RouteIssue {
  cause: Cause;
  step: number;
  road: string;
  node: string;
  lane: string;
}

// Deliberately independent of the router's reachability and graph filters: this is its oracle.
export function auditRoute(
  city: City,
  net: CompiledCity,
  request: RouteRequest,
  route: Route,
  changeM = 30,
): RouteIssue[] {
  const issues: RouteIssue[] = [];
  const destination = net.connectors[request.toConnector]!;
  const corners = city.geo
    ? [
        lonLatToLocal(city.geo, { lon: city.geo.bbox[0], lat: city.geo.bbox[3] }),
        lonLatToLocal(city.geo, { lon: city.geo.bbox[2], lat: city.geo.bbox[1] }),
      ]
    : null;
  let entry = net.lanes[request.fromLane]!;
  const add = (cause: Cause, step: number, lane = entry.idx) => {
    const source = net.lanes[lane]!;
    const road = net.roads[source.road]!;
    if (!issues.some((issue) => issue.cause === cause && issue.step === step))
      issues.push({ cause, step, road: road.id, node: net.nodes[road.to]!.id, lane: source.id });
  };
  for (let i = 0; i < route.roads.length; i++) {
    const road = net.roads[route.roads[i]!]!;
    const final = i === route.roads.length - 1;
    const start = i === 0 ? request.fromPosM : 0;
    const budget = final
      ? destination.positionM
      : i === 0
        ? entry.lengthM
        : Math.max(0, road.lengthM - 10);
    const canReach = (target: number) => {
      const lane = net.lanes[target];
      if (!lane || lane.road !== entry.road || start > budget) return false;
      const delta = lane.lane - entry.lane;
      if (!entry.allowed.includes(request.vehicleClass)) return false;
      for (let k = 1; k <= Math.abs(delta); k++) {
        const previous = net.lanes[road.lanes[entry.lane + (k - 1) * Math.sign(delta)]!]!;
        const next = net.lanes[road.lanes[entry.lane + k * Math.sign(delta)]!]!;
        const position = start + k * changeM;
        if (
          !next.allowed.includes(request.vehicleClass) ||
          position > Math.min(budget, previous.lengthM, next.lengthM)
        )
          return false;
      }
      return true;
    };
    if (entry.road !== road.idx || !route.targetLanes[i]?.some(canReach)) add('lane_distance', i);
    if (final) {
      if (!canReach(destination.lane)) add('lane_distance', i);
      break;
    }
    if (corners) {
      const [nw, se] = corners;
      const pos = net.nodes[road.to]!.pos;
      const boundary =
        Math.min(
          Math.abs(pos.x - nw!.x),
          Math.abs(pos.x - se!.x),
          Math.abs(pos.y - nw!.y),
          Math.abs(pos.y - se!.y),
        ) < 1e-6;
      if (
        boundary &&
        !road.lanes.some((lane) =>
          net.lanes[lane]!.out.some((idx) => !net.movements[idx]!.neverGreen),
        )
      )
        add('boundary_dead_end', i);
    }
    const movement = net.movements[route.movements[i]!];
    if (!movement) {
      add('illegal_movement', i);
      break;
    }
    const from = net.lanes[movement.fromLane]!;
    const to = net.lanes[movement.toLane]!;
    const nextRoad = net.roads[to.road]!;
    const rules = city.nodes[net.nodes[movement.node]!.id]!.turnRules.filter(
      (rule) =>
        rule.from === road.id &&
        rule.to === nextRoad.id &&
        (rule.fromLane === undefined || rule.fromLane === from.lane) &&
        (rule.toLane === undefined || rule.toLane === to.lane),
    );
    rules.sort(
      (a, b) =>
        Number(a.fromLane !== undefined) +
        Number(a.toLane !== undefined) -
        Number(b.fromLane !== undefined) -
        Number(b.toLane !== undefined),
    );
    const rule = rules.at(-1);
    if (
      movement.neverGreen ||
      from.road !== road.idx ||
      to.road !== route.roads[i + 1] ||
      movement.node !== road.to ||
      nextRoad.from !== road.to ||
      !from.out.includes(movement.idx) ||
      !to.in.includes(movement.idx) ||
      !to.allowed.includes(request.vehicleClass) ||
      rule?.allowed === false ||
      (movement.turn === 'uturn' && !rule?.allowed)
    )
      add('illegal_movement', i);
    if (!canReach(from.idx) || !route.targetLanes[i]?.includes(from.idx)) add('lane_distance', i);
    if (
      nextRoad.lanes.length < road.lanes.length &&
      ['through', 'merge', 'diverge'].includes(movement.turn)
    ) {
      const fromLeft =
        movement.turn === 'through' ? net.drivingSide === 'right' : net.drivingSide === 'left';
      const ordinal = fromLeft ? from.lane : road.lanes.length - 1 - from.lane;
      if (ordinal >= nextRoad.lanes.length) add('dropped_lane', i, from.idx);
    }
    entry = to;
  }
  if (route.movements.length !== route.roads.length - 1) add('illegal_movement', 0);
  return issues;
}

export function auditCity(city: City, net: CompiledCity) {
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(net);
  const counts = Object.fromEntries(auditCauses.map((cause) => [cause, 0])) as Record<
    Cause,
    number
  >;
  const failures: Record<string, number> = {};
  const examples: (RouteIssue & { pair: string; roads: string[] })[] = [];
  let pairs = 0,
    routable = 0,
    rejected = 0;
  for (const origin of net.connectors.filter((c) => c.direction !== 'in')) {
    for (const destination of net.connectors.filter((c) => c.direction !== 'out')) {
      if (origin.place === destination.place) continue;
      pairs++;
      const request: RouteRequest = {
        fromLane: origin.lane,
        fromPosM: origin.positionM,
        toConnector: destination.idx,
        vehicleClass: 'car',
        desiredSpeedFactor: 1,
        noise: 0,
        seed: 1,
      };
      const result = provider.route(net, costs, request);
      if (!result.ok) {
        failures[result.reason] = (failures[result.reason] ?? 0) + 1;
        continue;
      }
      routable++;
      const issues = auditRoute(city, net, request, result.route);
      if (issues.length) rejected++;
      for (const cause of new Set(issues.map((issue) => issue.cause))) counts[cause]++;
      for (const issue of issues) {
        if (examples.filter((example) => example.cause === issue.cause).length < 3)
          examples.push({
            ...issue,
            pair: `${origin.id}>${destination.id}`,
            roads: result.route.roads.map((idx) => net.roads[idx]!.id),
          });
      }
    }
  }
  return { pairs, routable, rejected, counts, failures, examples };
}

async function loadCity(file: string, bounds: string[]): Promise<City> {
  if (file === 'grid' || file === 'grid5x5') return grid5x5();
  if (file === 'town') return town();
  if (file.endsWith('.osm')) {
    if (
      bounds.length !== 0 &&
      (bounds.length !== 4 || bounds.some((n) => !Number.isFinite(Number(n))))
    )
      throw new Error('Expected bbox: west south east north');
    const bbox = bounds.length
      ? (bounds.map(Number) as [number, number, number, number])
      : undefined;
    const result = importOsm(readFileSync(file, 'utf8'), {
      importerVersion: '1',
      drivingSide: 'right',
      bbox,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    return result.city;
  }
  const bytes = readFileSync(file);
  // Only the canonical city is needed; scenarios/history do not participate in the audit.
  const document =
    bytes[0] === 0x50 && bytes[1] === 0x4b
      ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readZip(bytes)['city.json']))
      : JSON.parse(bytes.toString('utf8'));
  return migrateCity(document.city ?? document);
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/route-audit.ts')) {
  const [file, ...bounds] = process.argv.slice(2);
  const inputs = file
    ? [[file, ...bounds]]
    : [
        ['grid'],
        ['town'],
        ['fixtures/osm/sindelfingen-a81.osm', '8.98', '48.69', '9.0', '48.702'],
        ['fixtures/osm/munich-donnersberger.osm', '11.525', '48.135', '11.545', '48.148'],
      ];
  for (const [file, ...bounds] of inputs) {
    const city = await loadCity(file!, bounds);
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const report = auditCity(city, result.compiled);
    console.info(JSON.stringify({ city: file, ...report }, null, 2));
    if (report.rejected) process.exitCode = 1;
  }
}
