import { distance, nearestOnPolyline } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity, WalkGraph } from '../network';
import { serviceDwellS, type TrainTimetable } from '../network/trains';
import { railTimetable } from '../network/trams';
import { MinHeap } from './heap';
import type { WalkPosition } from './walk';

/**
 * TASK-174: transit routing on a time-expanded timetable graph.
 *
 * Stops are the S-Bahn platforms of station places and the tram stops of TASK-138's service
 * (`railTimetable`, the timetable the simulation runs). Every run of a route over two days is a
 * chain of events, an arrival and a departure per stop it calls at. Arcs: ride (departure to the
 * next arrival of the same run), dwell (staying on board through a stop), wait (a stop's
 * departures in time order), and alighting to board again at the same stop after
 * `SAME_STOP_TRANSFER_S` or at another stop after walking there. Every arc goes forward in time,
 * so one pass over the events in time order finds the least generalized cost: walking and waiting
 * count their seconds, riding its seconds times a comfort weight, and each transfer a penalty.
 */

/** Straight line times this from the walk network to where riders stand on a platform. */
export const PLATFORM_DETOUR = 1.3;
/** A tram stop is reached from the nearest walk link within this distance, on its grade. */
const TRAM_ACCESS_M = 60;
/** The longest walk to the first stop, from the last one, or between two stops. */
export const MAX_ACCESS_S = 900;
const MAX_TRANSFER_WALK_S = 600;
/** Time to alight and stand ready for the next vehicle at the same stop. */
export const SAME_STOP_TRANSFER_S = 60;
/** The graph spans two days of runs, so a trip leaving late in the evening finds its service. */
const HORIZON_S = 2 * 86400;
/** The longest trip the router searches, from the departure. */
const MAX_TRIP_S = 2 * 3600;

export interface TransitAccess {
  position: WalkPosition;
  /** Where the walk ends on the walk network. */
  point: Vec2;
  /** From there to the platform's middle, straight line times `PLATFORM_DETOUR`. */
  platformM: number;
}

export interface TransitStop {
  id: string;
  name: string;
  kind: 'tram' | 'sbahn';
  layer: number;
  /** The station place of an S-Bahn platform. */
  station: string | null;
  /** The platform: a ring without its closing point, a line, or one point. */
  shape: Vec2[];
  centre: Vec2;
  access: TransitAccess[];
}

export interface TransitLine {
  route: number;
  kind: 'tram' | 'sbahn';
  name: string;
  /** Stops in the order the route calls at them. */
  visits: { stop: number; arrivalS: number }[];
}

export interface TransitWeights {
  /** Per second of riding (dwells on board included). */
  ride: number;
  /** Per second of waiting. */
  wait: number;
  /** Per transfer, seconds. */
  transferS: number;
}

export interface TransitRide {
  /** The route in `railTimetable`'s order, and the run: its departure index and cycle. */
  route: number;
  departure: number;
  cycle: number;
  fromStop: number;
  toStop: number;
  boardS: number;
  alightS: number;
}

export interface TransitPlan {
  accessStop: number;
  rides: TransitRide[];
  /** Walking between consecutive rides, seconds; 0 when the next one leaves the same stop. */
  transferWalksS: number[];
  egressStop: number;
  accessS: number;
  egressS: number;
  waitS: number;
  rideS: number;
  arriveS: number;
  costS: number;
}

export interface TransitNetwork {
  stops: TransitStop[];
  lines: TransitLine[];
  table: TrainTimetable;
  walkSpeedMps: number;
  /** Walking seconds from every walk node to each stop's platform (via its best access). */
  walkS: Float64Array[];
  via: Uint8Array[];
  /** Per stop, the stops a rider may walk to for a transfer, with the seconds it takes. */
  transfers: { stop: number; walkS: number }[][];
  route(query: TransitQuery, weights: TransitWeights): TransitPlan | null;
  /** Walk seconds from a place to every stop's platform, and the access each uses. */
  placeAccess(placeId: string): { walkS: Float64Array; via: Uint8Array };
  /** The stop index of a stop id. */
  index: Map<string, number>;
  nodeCount: number;
}

export interface TransitQuery {
  departS: number;
  /** Per stop: seconds from the origin to its platform; Infinity where out of reach. */
  accessS: ArrayLike<number>;
  /** Per stop: seconds from its platform to the destination. */
  egressS: ArrayLike<number>;
}

const compass = [
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
  'north',
  'northeast',
];

function stopShape(rail: NonNullable<CompiledCity['rail']>, id: string) {
  const tram = rail.tramStops?.find((s) => s.id === id);
  const platform = rail.platforms.find(
    (p) => p.id === (tram?.platform?.kind === 'mapped' ? tram.platform.platform : id),
  );
  const shape =
    tram?.platform?.kind === 'generated'
      ? tram.platform.ring.slice(0, -1)
      : platform
        ? platform.shape.kind === 'polygon'
          ? platform.shape.ring.slice(0, -1)
          : platform.shape.kind === 'line'
            ? platform.shape.line
            : [platform.shape.pos]
        : tram!.halts.map((h) => h.pos);
  const xs = shape.map((p) => p.x),
    ys = shape.map((p) => p.y);
  const centre = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  return {
    name: tram?.name ?? platform!.name,
    layer: tram?.layer ?? platform!.layer,
    station: tram ? null : platform!.station,
    shape,
    centre,
  };
}

function tramAccess(walk: WalkGraph, centre: Vec2, layer: number): TransitAccess[] {
  let best = TRAM_ACCESS_M,
    found: TransitAccess | null = null;
  for (const link of walk.links) {
    // A crossing link is no place to end a walk; its kerbs are.
    if (link.crossing || link.layer !== layer) continue;
    const near = nearestOnPolyline(link.line, centre);
    if (near.away < best) {
      best = near.away;
      found = {
        position: { link: link.idx, positionM: near.along },
        point: near.point,
        platformM: near.away * PLATFORM_DETOUR,
      };
    }
  }
  return found ? [found] : [];
}

/** One-to-all walking seconds over the walk graph from several starts, each with its own cost. */
export function walkCostsFrom(
  graph: WalkGraph,
  starts: { position: WalkPosition; costS: number }[],
  speedMps: number,
  stepsFactor: number,
): { costS: Float64Array; via: Uint8Array } {
  const time = (link: number, length: number) =>
    length / (speedMps * (graph.links[link]!.kind === 'steps' ? stepsFactor : 1));
  const costS = new Float64Array(graph.nodes.length).fill(Infinity);
  const via = new Uint8Array(graph.nodes.length);
  const heap = new MinHeap();
  const seed = (node: number, cost: number, start: number) => {
    if (cost >= costS[node]!) return;
    costS[node] = cost;
    via[node] = start;
    heap.push(node, cost);
  };
  starts.forEach(({ position, costS: base }, start) => {
    if ('node' in position) seed(position.node, base, start);
    else if ('link' in position) {
      const link = graph.links[position.link]!;
      seed(link.from, base + time(link.idx, position.positionM), start);
      seed(link.to, base + time(link.idx, link.lengthM - position.positionM), start);
    } else for (const node of graph.places.get(position.placeId) ?? []) seed(node, base, start);
  });
  let node: number | undefined;
  while ((node = heap.pop()) !== undefined) {
    const cost = heap.cost;
    if (cost !== costS[node]) continue;
    for (const idx of graph.nodes[node]!.links) {
      const link = graph.links[idx]!,
        next = link.from === node ? link.to : link.from,
        value = cost + time(idx, link.lengthM);
      if (value < costS[next]!) {
        costS[next] = value;
        via[next] = via[node]!;
        heap.push(next, value);
      }
    }
  }
  return { costS, via };
}

/** Walking seconds to a walk position, from a one-to-all table. */
function costAt(graph: WalkGraph, table: Float64Array, position: WalkPosition, speedMps: number) {
  if ('node' in position) return table[position.node]!;
  if ('link' in position) {
    const link = graph.links[position.link]!;
    return Math.min(
      table[link.from]! + position.positionM / speedMps,
      table[link.to]! + (link.lengthM - position.positionM) / speedMps,
    );
  }
  return Math.min(...(graph.places.get(position.placeId) ?? []).map((n) => table[n]!));
}

const networks = new WeakMap<CompiledCity, Map<string, TransitNetwork | null>>();

/** The transit network of a compiled city at a walking speed, cached by both. Null without a
 * stop served by the timetable. */
export function transitNetwork(
  city: CompiledCity,
  walkSpeedMps = 1.4,
  stepsFactor = 0.6,
): TransitNetwork | null {
  const key = `${walkSpeedMps}/${stepsFactor}`;
  let byKey = networks.get(city);
  if (!byKey) networks.set(city, (byKey = new Map()));
  if (!byKey.has(key)) byKey.set(key, buildTransit(city, walkSpeedMps, stepsFactor));
  return byKey.get(key)!;
}

function buildTransit(
  city: CompiledCity,
  walkSpeedMps: number,
  stepsFactor: number,
): TransitNetwork | null {
  const rail = city.rail;
  if (!rail) return null;
  const table = railTimetable(rail);
  const ids = [...new Set(table.routes.flatMap((r) => r.stops.map((s) => s.platform)))].sort();
  if (!ids.length) return null;
  const walk = city.walk;
  const stops: TransitStop[] = ids.map((id) => {
    const { name, layer, station, shape, centre } = stopShape(rail, id);
    const kind = id.startsWith('ts:') ? 'tram' : 'sbahn';
    const access =
      kind === 'tram'
        ? tramAccess(walk, centre, layer)
        : (walk.places.get(station ?? '') ?? []).map((node) => ({
            position: { node },
            point: walk.nodes[node]!.pos,
            platformM: distance(walk.nodes[node]!.pos, centre) * PLATFORM_DETOUR,
          }));
    return { id, name, kind, layer, station, shape, centre, access };
  });
  const index = new Map(ids.map((id, i) => [id, i]));
  const lines: TransitLine[] = table.routes.flatMap((route, i) => {
    if (route.kind === 'mainline' || !route.stops.length) return [];
    const from = rail.nodes[route.from]!.pos,
      to = rail.nodes[route.terminal ?? route.to]!.pos;
    const heading = Math.atan2(to.y - from.y, to.x - from.x);
    const direction = compass[((Math.round(heading / (Math.PI / 4)) % 8) + 8) % 8]!;
    const visits = route.stops
      .map((s) => ({ stop: index.get(s.platform)!, arrivalS: s.arrivalS }))
      .sort((a, b) => a.arrivalS - b.arrivalS);
    const names = [...new Set(visits.map((v) => stops[v.stop]!.name))];
    return [
      {
        route: i,
        kind: route.kind,
        name:
          route.kind === 'tram'
            ? `Tram ${direction}bound to ${names.at(-1)}`
            : `S-Bahn ${direction}bound via ${names.join(', ')}`,
        visits,
      },
    ];
  });
  const walkS: Float64Array[] = [],
    via: Uint8Array[] = [];
  for (const stop of stops) {
    const table = walkCostsFrom(
      walk,
      stop.access.map((a) => ({ position: a.position, costS: a.platformM / walkSpeedMps })),
      walkSpeedMps,
      stepsFactor,
    );
    walkS.push(table.costS);
    via.push(table.via);
  }
  const transfers = stops.map((_, a) =>
    stops.flatMap((other, b) => {
      if (a === b || !other.access.length) return [];
      const seconds = Math.min(
        ...other.access.map(
          (x) => costAt(walk, walkS[a]!, x.position, walkSpeedMps) + x.platformM / walkSpeedMps,
        ),
      );
      return seconds <= MAX_TRANSFER_WALK_S ? [{ stop: b, walkS: seconds }] : [];
    }),
  );

  // Events, three per run and visit: the arrival (index % 3 = 0), the departure of riders staying
  // on board through the dwell (1), and the departure of riders boarding from the platform (2), so
  // nobody leaves a vehicle by the platform's wait arcs without paying for the transfer.
  const time: number[] = [],
    stopOf: number[] = [],
    runOf: number[] = [],
    last: boolean[] = [];
  const runs: { line: number; departure: number; cycle: number }[] = [];
  lines.forEach((line, l) => {
    const route = table.routes[line.route]!,
      dwellS = serviceDwellS(route.kind);
    table.departures.forEach((departure, d) => {
      if (departure.route !== line.route) return;
      const k0 = Math.ceil((-route.durationS - departure.timeS) / table.periodS);
      for (let k = k0; departure.timeS + k * table.periodS <= HORIZON_S; k++) {
        const start = departure.timeS + k * table.periodS;
        runs.push({ line: l, departure: d, cycle: k });
        line.visits.forEach((visit, j) => {
          for (const extra of [0, dwellS, dwellS]) {
            time.push(start + visit.arrivalS + extra);
            stopOf.push(visit.stop);
            runOf.push(runs.length - 1);
            last.push(j === line.visits.length - 1);
          }
        });
      }
    });
  });
  const nodeCount = time.length;
  const byTime = (a: number, b: number) => time[a]! - time[b]! || a - b;
  const order = Int32Array.from({ length: nodeCount }, (_, i) => i).sort(byTime);
  const departures: number[][] = stops.map(() => []);
  for (const n of order) if (n % 3 === 2 && !last[n]) departures[stopOf[n]!]!.push(n);
  /** The index of the first platform departure at a stop at or after `t`, or -1. */
  const firstAt = (stop: number, t: number) => {
    const list = departures[stop]!;
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (time[list[mid]!]! < t) lo = mid + 1;
      else hi = mid;
    }
    return lo < list.length ? lo : -1;
  };
  const position = new Int32Array(nodeCount);
  departures.forEach((list) => list.forEach((n, i) => (position[n] = i)));

  const cost = new Float64Array(nodeCount);
  const pred = new Int32Array(nodeCount);
  const stamp = new Int32Array(nodeCount);
  let query = 0;
  const places = new Map<string, { walkS: Float64Array; via: Uint8Array }>();

  return {
    stops,
    lines,
    table,
    walkSpeedMps,
    walkS,
    via,
    transfers,
    index,
    nodeCount,
    placeAccess(placeId) {
      let found = places.get(placeId);
      if (!found) {
        const anchors = walk.places.get(placeId) ?? [];
        const seconds = new Float64Array(stops.length).fill(Infinity);
        const access = new Uint8Array(stops.length);
        stops.forEach((_, s) => {
          for (const node of anchors)
            if (walkS[s]![node]! < seconds[s]!) {
              seconds[s] = walkS[s]![node]!;
              access[s] = via[s]![node]!;
            }
        });
        places.set(placeId, (found = { walkS: seconds, via: access }));
      }
      return found;
    },
    route({ departS, accessS, egressS }, weights) {
      query++;
      const relax = (node: number, value: number, from: number) => {
        if (stamp[node] === query && cost[node]! <= value) return;
        stamp[node] = query;
        cost[node] = value;
        pred[node] = from;
      };
      let earliest = Infinity;
      for (let s = 0; s < stops.length; s++) {
        const walkToS = accessS[s]!;
        if (!(walkToS <= MAX_ACCESS_S)) continue;
        const i = firstAt(s, departS + walkToS);
        if (i === -1) continue;
        const n = departures[s]![i]!;
        relax(n, walkToS + weights.wait * (time[n]! - departS - walkToS), -1 - s);
        earliest = Math.min(earliest, time[n]!);
      }
      if (earliest === Infinity) return null;
      let lo = 0,
        hi = nodeCount;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (time[order[mid]!]! < earliest) lo = mid + 1;
        else hi = mid;
      }
      let best = Infinity,
        bestNode = -1;
      for (let o = lo; o < nodeCount; o++) {
        const n = order[o]!,
          t = time[n]!;
        if (t > departS + MAX_TRIP_S) break;
        if (stamp[n] !== query || cost[n]! >= best) continue;
        const c = cost[n]!,
          stop = stopOf[n]!,
          kind = n % 3;
        if (kind === 2) {
          // On the platform: board and ride to the next arrival, or wait for the next departure.
          relax(n + 1, c + weights.ride * (time[n + 1]! - t), n);
          const next = departures[stop]![position[n]! + 1];
          if (next !== undefined) relax(next, c + weights.wait * (time[next]! - t), n);
        } else if (kind === 1) relax(n + 2, c + weights.ride * (time[n + 2]! - t), n);
        else {
          const egress = egressS[stop]!;
          if (egress <= MAX_ACCESS_S && c + egress < best) {
            best = c + egress;
            bestNode = n;
          }
          if (!last[n]) relax(n + 1, c + weights.ride * (time[n + 1]! - t), n);
          const board = (to: number, walkToS: number) => {
            const i = firstAt(to, t + walkToS);
            if (i === -1) return;
            const d = departures[to]![i]!;
            if (runOf[d] === runOf[n]) return;
            relax(d, c + weights.transferS + walkToS + weights.wait * (time[d]! - t - walkToS), n);
          };
          board(stop, SAME_STOP_TRANSFER_S);
          for (const transfer of transfers[stop]!) board(transfer.stop, transfer.walkS);
        }
      }
      if (bestNode === -1) return null;
      const path: number[] = [];
      for (let n = bestNode; n >= 0; n = pred[n]!) path.push(n);
      path.reverse();
      const accessStop = -1 - pred[path[0]!]!;
      const rides: TransitRide[] = [];
      const transferWalksS: number[] = [];
      let rideS = 0;
      for (let i = 0; i < path.length;) {
        let j = i;
        while (j + 1 < path.length && runOf[path[j + 1]!] === runOf[path[i]!]) j++;
        // A lone platform departure is a wait for a later vehicle at the same stop.
        if (j > i) {
          const n = path[i]!,
            end = path[j]!,
            run = runs[runOf[n]!]!;
          if (rides.length) {
            const before = rides.at(-1)!;
            transferWalksS.push(
              before.toStop === stopOf[n]
                ? 0
                : transfers[before.toStop]!.find((x) => x.stop === stopOf[n])!.walkS,
            );
          }
          rides.push({
            route: lines[run.line]!.route,
            departure: run.departure,
            cycle: run.cycle,
            fromStop: stopOf[n]!,
            toStop: stopOf[end]!,
            boardS: time[n]!,
            alightS: time[end]!,
          });
          rideS += time[end]! - time[n]!;
        }
        i = j + 1;
      }
      const accessWalkS = accessS[accessStop]!,
        egressWalkS = egressS[stopOf[bestNode]!]!;
      const arriveS = time[bestNode]! + egressWalkS;
      const walked = accessWalkS + egressWalkS + transferWalksS.reduce((a, b) => a + b, 0);
      return {
        accessStop,
        rides,
        transferWalksS,
        egressStop: stopOf[bestNode]!,
        accessS: accessWalkS,
        egressS: egressWalkS,
        waitS: arriveS - departS - walked - rideS,
        rideS,
        arriveS,
        costS: best,
      };
    },
  };
}
