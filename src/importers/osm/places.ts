import type { Vec2 } from '../../geo/vec2';
import {
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineCrossings,
} from '../../geo/polyline';
import { carService } from '../../network/car-service';
import { isLaneDrop } from '../../network/lane-drop';
import { reachableLanes } from '../../network/lane-reach';
import { parkingEgress } from '../../network/parking-egress';
import { compileVisibleParking } from '../../network/parking';
import { lonLatToLocal } from '../../geo/projection';
import type { CLane, CompiledCity, Diagnostic } from '../../network';
import { allocateId, vehicleClasses, type City, type Place, type RoadClass } from '../../schema';
import { contains, type Bounds } from './clip';
import type { OsmData, OsmTags } from './parse';
import type { OsmRoad } from './roads';

/** The router's default `laneChangeDistanceM` (`SimParams`). */
const laneChangeM = 30;

const gatewayDemand: Record<RoadClass, number> = {
  motorway: 400,
  trunk: 300,
  primary: 200,
  secondary: 120,
  tertiary: 80,
  residential: 40,
  service: 20,
  ramp: 80,
};

// Place access uses actual movement paths, not a road-level approximation that can require
// an impossible lane change on a short section. Keep disconnected roads, but do not seed
// unreachable demand on them. Boundary lanes need only reach (or leave) the main component.
// TASK-270: `carOnly` keeps only what some car trip may drive, as the router does: car lanes, no
// lane drops. TASK-283: destination and private roads count too (a trip may start or end in
// their zone), so a pocket of public streets behind them keeps its gateways (Lübeck's south loop
// by Wallstraße; the exits of Cambridge's north-east, which cars enter past its bus gates but leave
// only by them); demand then gives such a gateway only the trips a car can drive (`carService`).
// `laneChanges`: `none`; `long` on roads whose every lane is long enough for all of them;
// `every` on every road (TASK-270's polygon rule); `router` as the router makes them (TASK-286:
// `reachableLanes`, the lane search's edges): a lane entered at its road's start leaves by the
// movements of every lane it can change to within the road's length less 10 m, each change 30 m.
// TASK-270 counted a change on every road, so York's Layerthorpe gateway left on a lane that
// reaches the core only by changing lanes on roads of 5 to 22.6 m, and every route from it failed.
// `leaves` and `arrives` judge a gateway's connector by the router's origin and destination
// budgets.
export function networkAccess(
  compiled: CompiledCity,
  laneChanges: 'none' | 'long' | 'every' | 'router',
  carOnly = false,
) {
  const car = vehicleClasses.indexOf('car');
  const open = compiled.lanes.map((lane) => {
    const access = compiled.roads[lane.road]!.access[car];
    return (
      !carOnly ||
      (lane.allowed.includes('car') &&
        (access === 'yes' || access === 'destination' || access === 'private'))
    );
  });
  const out = compiled.lanes.map((): number[] => []);
  const incoming = compiled.lanes.map((): number[] => []);
  for (const m of compiled.movements) {
    if (m.neverGreen || !open[m.fromLane] || !open[m.toLane]) continue;
    if (carOnly && isLaneDrop(compiled, m)) continue;
    out[m.fromLane]!.push(m.toLane);
    incoming[m.toLane]!.push(m.fromLane);
  }
  const moves = out.map((next) => [...next]);
  if (laneChanges === 'router')
    for (const lane of compiled.lanes) {
      const endM = Math.max(0, compiled.roads[lane.road]!.lengthM - 10);
      for (const { lane: from, changes } of reachableLanes(
        compiled,
        open,
        lane.idx,
        endM,
        laneChangeM,
      ))
        for (const to of changes ? moves[from]! : []) {
          out[lane.idx]!.push(to);
          incoming[to]!.push(lane.idx);
        }
    }
  else
    for (const road of laneChanges === 'none' ? [] : compiled.roads) {
      const lanes = road.lanes.map((i) => compiled.lanes[i]!);
      if (lanes.some((l) => !open[l.idx])) continue;
      if (
        laneChanges === 'long' &&
        lanes.some((l) => l.lengthM < (lanes.length - 1) * laneChangeM + 10)
      )
        continue;
      for (const lane of lanes)
        for (const other of lanes) {
          if (lane.idx === other.idx) continue;
          out[lane.idx]!.push(other.idx);
          incoming[other.idx]!.push(lane.idx);
        }
    }
  const seen = new Set<number>(),
    order: number[] = [];
  for (const lane of compiled.lanes) {
    if (seen.has(lane.idx)) continue;
    const stack: [number, boolean][] = [[lane.idx, false]];
    while (stack.length) {
      const [id, finish] = stack.pop()!;
      if (finish) {
        order.push(id);
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push([id, true]);
      for (const next of out[id]!) if (!seen.has(next)) stack.push([next, false]);
    }
  }
  seen.clear();
  let core: number[] = [];
  for (const id of order.reverse()) {
    if (seen.has(id)) continue;
    const group = [id];
    seen.add(id);
    for (const lane of group)
      for (const next of incoming[lane]!) {
        if (seen.has(next)) continue;
        seen.add(next);
        group.push(next);
      }
    if (group.length > core.length) core = group;
  }
  // A simple clipped corridor has no cycle and still has valid directional portals.
  if (new Set(core.map((i) => compiled.lanes[i]!.road)).size <= 1)
    core = compiled.lanes.map((lane) => lane.idx);
  const reach = (edges: number[][]) => {
    const result = new Set(core),
      queue = [...core];
    for (const lane of queue)
      for (const next of edges[lane]!) {
        if (result.has(next)) continue;
        result.add(next);
        queue.push(next);
      }
    return result;
  };
  const coreSet = new Set(core),
    fromCore = reach(out),
    toCore = reach(incoming);
  /** A car starting on `lane` at `fromM` reaches the core (the router's origin budget is the
   * lane's length). */
  const leaves = (lane: number, fromM: number) => {
    const { lengthM } = compiled.lanes[lane]!;
    for (const { lane: from } of reachableLanes(compiled, open, lane, lengthM, laneChangeM, fromM))
      if (coreSet.has(from) || moves[from]!.some((to) => toCore.has(to))) return true;
    return false;
  };
  /** A car from the core can stop on `lane` at `atM`: it enters the road on a lane it can change
   * from to `lane` within `atM` (the router's destination budget). */
  const arrives = (lane: number, atM: number) =>
    compiled.roads[compiled.lanes[lane]!.road]!.lanes.some(
      (entry) =>
        fromCore.has(entry) &&
        [...reachableLanes(compiled, open, entry, atM, laneChangeM)].some((r) => r.lane === lane),
    );
  return { core: coreSet, fromCore, toCore, leaves, arrives };
}

export function addPlace(
  city: City,
  kind: Place['kind'],
  name: string,
  shape: Place['shape'],
  provenance: Place['provenance'],
  demand = 0,
): Place {
  const id = allocateId(city, 'p');
  const place: Place = {
    id,
    kind,
    name,
    shape,
    population: demand,
    jobs: demand,
    attraction: 1,
    capacity: null,
    connectors: [],
    profile: null,
    events: [],
    provenance,
  };
  city.places[id] = place;
  return place;
}

export function addGateways(city: City, roads: OsmRoad[], compiled: CompiledCity): void {
  const polygon = Boolean(city.geo!.boundary);
  // TASK-270: a polygon import's gateway connector is made only on a car lane that reaches the
  // network (out) or is reached from it (in): a cut end whose lanes lead nowhere had connectors
  // anyway. TASK-283: through destination streets too (see `networkAccess`).
  const access = networkAccess(compiled, polygon ? 'router' : 'long', polygon);
  const reach = polygon ? networkAccess(compiled, 'every', true) : access;
  const inset = (lengthM: number) => Math.min(5, lengthM / 2);
  const [west, south, east, north] = city.geo!.bbox;
  const nw = lonLatToLocal(city.geo!, { lon: west, lat: north });
  const se = lonLatToLocal(city.geo!, { lon: east, lat: south });
  const ends = roads.flatMap((source) => {
    const { road } = source;
    return (['start', 'end'] as const).flatMap((end) => {
      if (!(end === 'start' ? source.cutStart : source.cutEnd)) return [];
      const lanes = compiled.roads[compiled.index.road.get(road.id)!]!.lanes.map(
        (i) => compiled.lanes[i]!,
      );
      // TASK-286: a polygon's connector lane is one the router can leave (out) or reach (in) from
      // the connector's own position; of several, the driving side's outer one as before (York's
      // Layerthorpe `r:3638`: lane 1, not lane 0, which reaches the core only by lane changes on
      // roads under 30 m). Where no lane passes, TASK-270's reach decides, as before: Freiburg's
      // curation makes Stefan-Meier-Straße's way in usable after the import (lead, 2026-11-21).
      const reaches = (l: CLane) => (end === 'start' ? reach.toCore : reach.fromCore).has(l.idx);
      let candidates = polygon
        ? lanes.filter((l) =>
            end === 'start'
              ? access.leaves(l.idx, inset(l.lengthM))
              : access.arrives(l.idx, l.lengthM - inset(l.lengthM)),
          )
        : lanes.filter(reaches);
      if (polygon && !candidates.length) candidates = lanes.filter(reaches);
      if (
        !polygon &&
        !candidates.length &&
        ['motorway', 'trunk', 'primary', 'secondary'].includes(road.roadClass)
      )
        candidates = lanes;
      if (!candidates.length) return [];
      const lane = city.drivingSide === 'right' ? candidates.at(-1)! : candidates[0]!;
      const node = city.nodes[end === 'start' ? road.from : road.to]!;
      const distances = [
        Math.abs(node.pos.x - nw.x),
        Math.abs(node.pos.x - se.x),
        Math.abs(node.pos.y - nw.y),
        Math.abs(node.pos.y - se.y),
      ];
      const edge = polygon ? 0 : distances.indexOf(Math.min(...distances));
      return [{ source, end, lane, node, edge }];
    });
  });
  type End = (typeof ends)[number];
  const groups: End[][] = [];
  for (const end of ends) {
    const existing = groups.find((group) => group[0]!.node.id === end.node.id);
    if (existing) existing.push(end);
    else groups.push([end]);
  }
  const gap = (a: End[], b: End[]) =>
    Math.hypot(a[0]!.node.pos.x - b[0]!.node.pos.x, a[0]!.node.pos.y - b[0]!.node.pos.y);
  const has = (group: End[], direction: End['end']) => group.some((e) => e.end === direction);
  const complementary = (a: End[], b: End[]) =>
    (!has(a, 'start') && has(b, 'start')) || (!has(a, 'end') && has(b, 'end'));
  // First pair named carriageways; then pair nearby one-way streets serving the same edge.
  const pair = (named: boolean, maxM: number) => {
    for (const group of groups) {
      if (!group.length || (has(group, 'start') && has(group, 'end'))) continue;
      const first = group[0]!;
      const candidates = groups
        .filter(
          (other) =>
            other !== group &&
            other.length &&
            complementary(group, other) &&
            first.edge === other[0]!.edge &&
            gap(group, other) <= maxM &&
            (!named ||
              (first.source.road.name !== null &&
                other[0]!.source.road.name === first.source.road.name &&
                other[0]!.source.road.roadClass === first.source.road.roadClass)),
        )
        .sort((a, b) => gap(group, a) - gap(group, b));
      if (candidates[0]) group.push(...candidates[0].splice(0));
    }
  };
  // A clipped link belongs to its nearby parent gateway, and contributes no extra demand.
  const attachLinks = (parents: readonly RoadClass[], maxM: number) => {
    for (const group of groups) {
      if (!group.length || !group.every((e) => e.source.road.roadClass === 'ramp')) continue;
      const parent = groups
        .filter(
          (other) =>
            other !== group &&
            other.some((e) => parents.includes(e.source.road.roadClass)) &&
            other[0]!.edge === group[0]!.edge &&
            gap(group, other) < maxM,
        )
        .sort((a, b) => gap(group, a) - gap(group, b))[0];
      if (parent) parent.push(...group.splice(0));
    }
  };
  if (polygon) {
    // TASK-198: a ring has no box sides. Links join the carriageway of their own interchange
    // before one-way carriageways pair, so a named link street further off keeps its gateway.
    pair(true, 150);
    attachLinks(['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], 80);
    pair(false, 150);
  } else {
    pair(true, 150);
    pair(false, 300);
    attachLinks(['motorway', 'trunk', 'primary', 'secondary'], 300);
  }
  for (const group of groups) {
    if (!group.length) continue;
    const place = addPlace(
      city,
      'gateway',
      'Gateway',
      { kind: 'point', pos: group[0]!.node.pos },
      {
        source: 'osm',
        osmIds: [...new Set(group.map((e) => e.source.wayId))],
        inferred: ['population', 'jobs', 'attraction', 'throughputPerMin', 'gatewayPairing'],
      },
    );
    const main = group.filter((e) => e.source.road.roadClass !== 'ramp');
    const demandEnds = main.length ? main : group;
    place.population = Math.max(
      0,
      ...demandEnds
        .filter((e) => e.end === 'start')
        .map((e) => gatewayDemand[e.source.road.roadClass] * e.source.road.lanes.length),
    );
    place.jobs = Math.max(
      0,
      ...demandEnds
        .filter((e) => e.end === 'end')
        .map((e) => gatewayDemand[e.source.road.roadClass] * e.source.road.lanes.length),
    );
    for (const { source, lane, end } of group) {
      place.connectors.push({
        id: allocateId(city, 'c'),
        roadId: source.road.id,
        lane: lane.lane,
        positionM: end === 'start' ? inset(lane.lengthM) : lane.lengthM - inset(lane.lengthM),
        direction: end === 'start' ? 'out' : 'in',
        throughputPerMin: 30 * source.road.lanes.length,
      });
    }
  }
}

/**
 * TASK-155: demand generates no trip with a gateway end that no car can serve. Say which
 * gateways the crop left with nothing, or nothing in one direction, to serve.
 */
export function gatewayDiagnostics(compiled: CompiledCity): Diagnostic[] {
  const gateways = compiled.places.filter((p) => p.kind === 'gateway');
  if (!gateways.length) return [];
  const locals = compiled.places.filter((p) => p.kind !== 'gateway');
  const { served } = carService(compiled);
  return gateways.flatMap((gateway): Diagnostic[] => {
    const enters = locals.some((p) => served(gateway.idx, p.idx));
    const leaves = locals.some((p) => served(p.idx, gateway.idx));
    if (enters && leaves) return [];
    const others = gateways
      .filter((g) => g !== gateway && (served(gateway.idx, g.idx) || served(g.idx, gateway.idx)))
      .map((g) => g.id);
    const message =
      enters || leaves
        ? enters
          ? `No local place can reach gateway ${gateway.id}, so no trips leave through it`
          : `Cars entering at gateway ${gateway.id} reach no local parking, so no trips start there`
        : `Gateway ${gateway.id} reaches no local place or parking, so it ${others.length ? `only serves trips with ${others.join(', ')}` : 'generates no trips'}`;
    return [{ severity: 'info', code: 'gateway_unserved', refs: [gateway.id, ...others], message }];
  });
}

function placeKind(tag: OsmTags): Place['kind'] | undefined {
  if (tag.amenity === 'parking') return 'parking';
  if (tag.amenity === 'school') return 'school';
  if (tag.railway === 'station') return 'station';
  if (tag.aeroway === 'aerodrome') return 'airport';
  if (tag.shop === 'mall') return 'retail';
  return undefined;
}

export function polygonCenter(ring: Vec2[]): Vec2 | undefined {
  const origin = ring[0]!;
  let area = 0,
    x = 0,
    y = 0;
  for (let i = 1; i < ring.length - 1; i++) {
    const a = ring[i]!,
      b = ring[i + 1]!;
    const ax = a.x - origin.x,
      ay = a.y - origin.y;
    const bx = b.x - origin.x,
      by = b.y - origin.y;
    const cross = ax * by - ay * bx;
    area += cross;
    x += (ax + bx) * cross;
    y += (ay + by) * cross;
  }
  if (area !== 0) return { x: origin.x + x / (3 * area), y: origin.y + y / (3 * area) };
}

// Preserve the original layout and ID allocation while generating fixed roadside strips.
export function layoutConnector(city: City, compiled: CompiledCity, parking = false) {
  const { core } = networkAccess(compiled, 'none');
  const segments = compiled.lanes
    .filter((lane) => {
      if ((!parking && !core.has(lane.idx)) || !lane.allowed.includes('car')) return false;
      const road = city.roads[compiled.roads[lane.road]!.id]!;
      const access = road.access?.car ?? road.access?.all ?? 'yes';
      return !parking || (access !== 'no' && access !== 'delivery');
    })
    .flatMap((lane) =>
      lane.polyline.slice(1).map((b, i) => ({ lane, a: lane.polyline[i]!, b, i })),
    );
  function snap(index: number, point: Vec2) {
    const { lane, a, b, i } = segments[index]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    return {
      lane,
      positionM: lane.cumulative[i]! + t * (lane.cumulative[i + 1]! - lane.cumulative[i]!),
      distance: Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy),
    };
  }
  return (point: Vec2): Place['connectors'][number] => {
    let best = snap(0, point);
    for (let i = 1; i < segments.length; i++) {
      const candidate = snap(i, point);
      if (candidate.distance < best.distance) best = candidate;
    }
    const inset = Math.min(10, best.lane.lengthM / 2);
    return {
      id: allocateId(city, 'c'),
      roadId: compiled.roads[best.lane.road]!.id,
      lane: best.lane.lane,
      positionM: Math.max(inset, Math.min(best.lane.lengthM - inset, best.positionM)),
      direction: 'both',
      throughputPerMin: 30,
    };
  };
}

// Mapped facilities get a short inferred driveway, never an invented street connection.
export const PARKING_SNAP_LIMIT_M = 30;

/** Snap a mapped node to its street's nearest reachable edge lane. */
export function parkingEntranceConnector(city: City, compiled: CompiledCity) {
  const access = parkingEgress(compiled, 30);
  const candidates = compiled.lanes.map((lane) => {
    const compiledRoad = compiled.roads[lane.road]!;
    const road = city.roads[compiledRoad.id]!;
    return {
      lane,
      road,
      usable:
        lane.allowed.includes('car') &&
        !['motorway', 'trunk', 'ramp'].includes(road.roadClass) &&
        (lane.lane === 0 || lane.lane === compiledRoad.lanes.length - 1),
    };
  });
  return (
    entrance: {
      point: Vec2;
      layer?: number;
      roads: ReadonlySet<number>;
      direction: Place['connectors'][number]['direction'];
    },
    excluded?: ReadonlySet<string>,
  ): Omit<Place['connectors'][number], 'id'> | undefined => {
    let best:
      | { roadId: string; lane: number; positionM: number; distance: number; mapped: boolean }
      | undefined;
    let mappedNearby = false;
    for (const { lane, road, usable } of candidates) {
      const mapped = road.provenance.osmIds?.some((id) => entrance.roads.has(id)) ?? false;
      if (excluded?.has(road.id) || (!usable && !mapped)) continue;
      const layer = entrance.layer ?? (mapped ? (road.layer ?? 0) : 0);
      if ((road.layer ?? 0) !== layer) continue;
      const hit = nearestOnPolyline(lane.polyline, entrance.point);
      if (hit.away > PARKING_SNAP_LIMIT_M) continue;
      mappedNearby ||= mapped;
      if (!usable || (!mapped && road.provenance.inferred?.includes('lotAccess'))) continue;
      if (entrance.direction !== 'out' && hit.along + 1e-9 < access.earliestArrival(lane.idx))
        continue;
      if (entrance.direction !== 'in' && hit.along > access.latestDeparture(lane.idx) + 1e-9)
        continue;
      if (!best || (mapped && !best.mapped) || (mapped === best.mapped && hit.away < best.distance))
        best = {
          roadId: road.id,
          lane: lane.lane,
          positionM: hit.along,
          distance: hit.away,
          mapped,
        };
    }
    // A nearby street cannot supply access when the mapped approach cannot carry it.
    if (mappedNearby && !best?.mapped) return;
    return (
      best && {
        roadId: best.roadId,
        lane: best.lane,
        positionM: best.positionM,
        direction: entrance.direction,
        throughputPerMin: 30,
      }
    );
  };
}

export function placeConnector(
  city: City,
  compiled: CompiledCity,
  parking = false,
  departureOnly = false,
) {
  const access = parkingEgress(compiled, 30);
  const bays = compiled.lanes.map((): number[] => []);
  for (const space of compiled.parkingSpaces ?? [])
    if (compiled.parking[space.parking]!.kind === 'roadside')
      bays[space.lane]!.push(space.positionM);
  const candidates = compiled.lanes.flatMap((lane) => {
    // Lead (TASK-124 review): a new portal is a driveway on the curb lane of an at-grade
    // street, never in a tunnel, on a bridge, on a motorway, trunk or ramp, or on an inner lane.
    const road = compiled.roads[lane.road]!,
      source = city.roads[road.id]!;
    if (
      (source.layer ?? 0) !== 0 ||
      ['motorway', 'trunk', 'ramp'].includes(source.roadClass) ||
      lane.lane !== (city.drivingSide === 'left' ? 0 : road.lanes.length - 1)
    )
      return [];
    const inset = Math.min(10, lane.lengthM / 2);
    const last = Math.min(lane.lengthM - inset, access.latestDeparture(lane.idx));
    if (last < inset) return [];
    const first = departureOnly ? inset : Math.max(inset, access.earliestArrival(lane.idx));
    if (first > last) return [];
    let ranges: [number, number][] = [[first, last]];
    // New portals fit between existing bays; the strips and their slots do not move.
    for (const positionM of bays[lane.idx]!) {
      const lo = positionM - 3.000001,
        hi = positionM + 3.000001;
      ranges = ranges.flatMap(([a, b]) =>
        hi <= a || lo >= b
          ? [[a, b] as [number, number]]
          : [
              ...(lo >= a ? [[a, lo] as [number, number]] : []),
              ...(hi <= b ? [[hi, b] as [number, number]] : []),
            ],
      );
    }
    return ranges.map(([first, last]) => ({
      lane,
      first,
      line: [
        pointAtDistance(lane.polyline, lane.cumulative, first),
        ...lane.polyline.filter(
          (_, i) => lane.cumulative[i]! > first && lane.cumulative[i]! < last,
        ),
        pointAtDistance(lane.polyline, lane.cumulative, last),
      ],
    }));
  });
  return (
    point: Vec2,
    footprints: Vec2[][] = [],
    mappedEntrance = false,
    existingId?: string,
  ): Place['connectors'][number] | undefined => {
    // Keep allocation stable even when a mapped facility has no entry within the limit.
    const id = existingId ?? allocateId(city, 'c');
    const rings = footprints.map((ring) => [...ring, ring[0]!]);
    const extent = rings.length ? rings.flat() : [point];
    const minX = Math.min(...extent.map((p) => p.x)) - PARKING_SNAP_LIMIT_M;
    const maxX = Math.max(...extent.map((p) => p.x)) + PARKING_SNAP_LIMIT_M;
    const minY = Math.min(...extent.map((p) => p.y)) - PARKING_SNAP_LIMIT_M;
    const maxY = Math.max(...extent.map((p) => p.y)) + PARKING_SNAP_LIMIT_M;
    const distanceToFootprint = (p: Vec2) =>
      rings.length
        ? Math.min(
            ...rings.map((ring) => (pointInPolygon(p, ring) ? 0 : nearestOnPolyline(ring, p).away)),
          )
        : Math.hypot(p.x - point.x, p.y - point.y);
    let best:
      { lane: (typeof compiled.lanes)[number]; positionM: number; rank: number } | undefined;
    for (const { lane, first, line } of candidates) {
      if (
        parking &&
        (line.every((p) => p.x < minX) ||
          line.every((p) => p.x > maxX) ||
          line.every((p) => p.y < minY) ||
          line.every((p) => p.y > maxY))
      )
        continue;
      let hit = nearestOnPolyline(line, point);
      if (line[0]!.x === line.at(-1)!.x && line[0]!.y === line.at(-1)!.y && line.length === 2)
        hit = {
          ...hit,
          point: line[0]!,
          away: Math.hypot(line[0]!.x - point.x, line[0]!.y - point.y),
        };
      let distance = distanceToFootprint(hit.point);
      if (rings.length && !mappedEntrance) {
        const options = rings.flatMap((ring) => [
          ...ring.map((p) => nearestOnPolyline(line, p)),
          ...line.map((p) => ({ ...nearestOnPolyline(line, p), away: distanceToFootprint(p) })),
          ...polylineCrossings(line, ring).map((c) => ({
            ...nearestOnPolyline(line, c.point),
            away: 0,
          })),
        ]);
        for (const option of options) {
          const away = distanceToFootprint(option.point);
          if (
            away < distance ||
            (away === distance &&
              Math.hypot(option.point.x - point.x, option.point.y - point.y) <
                Math.hypot(hit.point.x - point.x, hit.point.y - point.y))
          ) {
            hit = option;
            distance = away;
          }
        }
      }
      if (parking && distance > PARKING_SNAP_LIMIT_M) continue;
      const rank = rings.length && !mappedEntrance ? distance : hit.away;
      if (!best || rank < best.rank) best = { lane, positionM: first + hit.along, rank };
    }
    return (
      best && {
        id,
        roadId: compiled.roads[best.lane.road]!.id,
        lane: best.lane.lane,
        positionM: best.positionM,
        direction: departureOnly ? 'out' : 'both',
        throughputPerMin: 30,
      }
    );
  };
}

/** Final import pass: keep the mapped vehicle/parking layout, repair only trapped portals. */
export function connectCarExits(
  city: City,
  compiled: CompiledCity,
  garageFootprints?: ReadonlyMap<string, Vec2[][]>,
  refreshLots?: ReadonlySet<string>,
): boolean {
  const exits = parkingEgress(compiled, 30);
  // Reuse the finished car graph and the parking compiler, without compiling the walk graph
  // or vehicle geometry again. Lots appended by mapped-strip fallback add no vehicle roads.
  const layout: CompiledCity = {
    ...compiled,
    lanes: compiled.lanes.map((lane) => ({ ...lane, connectors: [] })),
    connectors: [],
    parking: [],
    parkingSpaces: [],
    strips: [],
    index: { ...compiled.index, connector: new Map(), parking: new Map() },
  };
  const parkingCity = refreshLots
    ? {
        ...city,
        parking: Object.fromEntries(
          Object.entries(city.parking ?? {}).filter(([id]) => refreshLots.has(id)),
        ),
      }
    : city;
  compileVisibleParking(parkingCity, layout, (shape) =>
    shape.kind === 'point' ? shape.pos : (polygonCenter(shape.ring) ?? null),
  );
  const ordinary: ReturnType<typeof placeConnector>[] = [];
  const parking: ReturnType<typeof placeConnector>[] = [];
  let changed = false;
  const repair = (
    entry: Place['connectors'][number],
    entries: Place['connectors'],
    footprints: Vec2[][],
    mapped: boolean,
    anchor?: Vec2,
  ) => {
    if (entry.direction === 'in') return false;
    const road = compiled.roads[compiled.index.road.get(entry.roadId)!]!;
    const lane = compiled.lanes[road.lanes[entry.lane]!]!;
    if (entry.positionM <= exits.latestDeparture(lane.idx) + 1e-9) return false;
    const reachableArrival =
      entry.direction !== 'out' && entry.positionM + 1e-9 >= exits.earliestArrival(lane.idx);
    const departureOnly = reachableArrival || entry.direction === 'out';
    const point = anchor ?? pointAtDistance(lane.polyline, lane.cumulative, entry.positionM);
    const factories = mapped ? parking : ordinary;
    const snap = (factories[Number(departureOnly)] ??= placeConnector(
      city,
      layout,
      mapped,
      departureOnly,
    ));
    const candidate = snap(point, footprints, false, entry.id);
    if (!candidate) return false;
    if (reachableArrival) {
      entry.direction = 'in';
      entries.push({
        ...candidate,
        id: allocateId(city, 'c'),
        direction: 'out',
        throughputPerMin: entry.throughputPerMin,
      });
    } else {
      Object.assign(entry, candidate, {
        direction: entry.direction,
        throughputPerMin: entry.throughputPerMin,
      });
    }
    changed = true;
    return true;
  };
  for (const place of Object.values(city.places)) {
    if (refreshLots) break;
    if (place.kind === 'gateway') continue;
    const anchor =
      place.shape.kind === 'point' ? place.shape.pos : polygonCenter(place.shape.ring)!;
    for (const entry of [...place.connectors]) repair(entry, place.connectors, [], false, anchor);
  }
  for (const source of Object.values(city.parking ?? {})) {
    if (refreshLots && !refreshLots.has(source.id)) continue;
    if (source.kind === 'roadside' || source.provenance.inferred?.includes('implicitGarage'))
      continue;
    const facilityIndex = layout.index.parking.get(source.id);
    const facility = facilityIndex === undefined ? undefined : layout.parking[facilityIndex];
    const footprints =
      garageFootprints?.get(source.id) ??
      (source.shape?.kind === 'polygon' ? [source.shape.ring] : []);
    const entries = source.connectors.length
      ? source.connectors
      : [...new Set([...(facility?.connectorsIn ?? []), ...(facility?.connectorsOut ?? [])])].map(
          (i) => {
            const c = layout.connectors[i]!,
              lane = layout.lanes[c.lane]!;
            return {
              id: c.id,
              roadId: compiled.roads[lane.road]!.id,
              lane: lane.lane,
              positionM: c.positionM,
              direction: c.direction,
              throughputPerMin: c.throughputPerMin,
            };
          },
        );
    let moved = false;
    const anchor = source.shape?.kind === 'point' ? source.shape.pos : undefined;
    for (const entry of [...entries])
      moved = repair(entry, entries, footprints, true, anchor) || moved;
    if (moved || (refreshLots && source.kind === 'lot')) {
      if (
        !source.connectors.length &&
        !source.provenance.inferred?.includes('materializedAisleEntries')
      )
        (source.provenance.inferred ??= []).push('materializedAisleEntries');
      source.connectors = entries.map((entry) =>
        /^c:\d+$/.test(entry.id) ? entry : { ...entry, id: allocateId(city, 'c') },
      );
    }
  }
  return changed;
}

export function addOsmPlaces(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  compiled: CompiledCity,
): void {
  const connector = layoutConnector(city, compiled);
  function add(id: number, tag: OsmTags, kind: Place['kind'], shape: Place['shape'], point: Vec2) {
    if (!contains(bounds, point)) return;
    const place = addPlace(city, kind, tag.name ?? kind, shape, {
      source: 'osm',
      osmIds: [id],
      inferred: ['population', 'jobs', 'attraction', 'throughputPerMin'],
    });
    place.connectors.push(connector(point));
  }

  for (const { id, tag } of data.node) {
    const kind = placeKind(tag);
    if (!kind || kind === 'parking') continue;
    const pos = positions.get(id)!;
    add(id, tag, kind, { kind: 'point', pos }, pos);
  }
  for (const { id, nd, tag } of data.way) {
    const kind = placeKind(tag);
    if (!kind) continue;
    const points = nd.map((ref) => positions.get(ref)).filter((pos) => pos !== undefined);
    if (points.length === 0 || points.length !== nd.length) continue;
    const ring = nd[0] === nd.at(-1) ? points.slice(0, -1) : [];
    const center = ring.length >= 3 ? polygonCenter(ring) : undefined;
    if (center) add(id, tag, kind, { kind: 'polygon', ring }, center);
    else if (kind !== 'parking') add(id, tag, kind, { kind: 'point', pos: points[0]! }, points[0]!);
  }
}
