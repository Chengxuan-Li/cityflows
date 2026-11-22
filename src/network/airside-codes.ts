import Flatbush from 'flatbush';
import {
  cumulativeLengths,
  distance,
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineLength,
  segmentDistance,
  segmentsIntersect,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import { aircraftCodes, codeSpanLimitM as codeSpanM, type AircraftCode } from '../schema/aircraft';
import type { AirsideEdgeKind, Airport } from '../schema/airport';
import type { City } from '../schema/city';

// TASK-295's airside code rules (architecture sections 4 and 13), shared by the OSM import and
// the editor (TASK-305), which re-runs them where an edit changes geometry. The figures are ICAO
// Annex 14 Vol. I (8th edition, 2018): taxiway widths (3.9.3), separations (Table 3-1), runway
// widths (3.1.9) and stand clearances (3.13.6), by aerodrome reference code letter.
type Codes = Record<AircraftCode, number>;
export const airsideRules = {
  taxiwayWidthM: { A: 7.5, B: 10.5, C: 15, D: 18, E: 23, F: 25 } as Codes,
  /** Taxiway centre line to taxiway centre line; also a taxiway to a parallel runway. */
  taxiwaySeparationM: { A: 21.5, B: 31.5, C: 44, D: 63, E: 76, F: 91 } as Codes,
  /** Aircraft stand taxilane to stand taxilane. */
  taxilaneSeparationM: { A: 19.5, B: 28.5, C: 40.5, D: 59.5, E: 72.5, F: 87.5 } as Codes,
  taxiwayObjectM: { A: 15.5, B: 20, C: 26, D: 37, E: 43.5, F: 51 } as Codes,
  taxilaneObjectM: { A: 12, B: 16.5, C: 22.5, D: 33.5, E: 40, F: 47.5 } as Codes,
  runwayWidthM: { A: 18, B: 23, C: 30, D: 45, E: 45, F: 45 } as Codes,
  standClearanceM: { A: 3, B: 3, C: 4.5, D: 7.5, E: 7.5, F: 7.5 } as Codes,
  /** An unmapped runway's width by its length (the code numbers 4, 3, 2, 1). */
  runwayWidthByLength: [
    [1800, 45],
    [1200, 30],
    [800, 23],
    [0, 18],
  ] as const,
  /** Parallel neighbours are aligned within 20 degrees. A short graph detour marks a junction
   * unless the lanes run side by side for at least 20 m. */
  parallelDeg: 20,
  parallelJoinM: 120,
  parallelOverlapM: 20,
  sampleM: 5,
  taxiGapM: 5,
  /** A stand or hold off the graph joins the nearest taxi edge within these. */
  standJoinM: 150,
  holdJoinM: 20,
  /** A `parking_position` node is the stop of a lead-in way of its `ref` (or of none) ending
   * this near. */
  standMatchM: 30,
  gateM: 250,
  hangarM: 60,
  terminalGroupM: 30,
  aidM: 1500,
  /** Runway ways within this of a straight line at a shared end are one runway. */
  runwayJoinDeg: 15,
  holdSearchM: 1000,
  untypedHoldM: 300,
};
const rules = airsideRules;

// ICAO Doc 9157 Part 2, Table 1-4. Nearly straight taxiways can use the wingspan and
// fixed-object buffer alone because aircraft track the centreline. Keep the lateral
// allowance on bends, where a wingtip can sweep beyond that envelope.
const taxiwayTrackingAllowanceM: Codes = { A: 1.5, B: 2.25, C: 3, D: 4, E: 4, F: 4 };

const descending = [...aircraftCodes].reverse();
/** The largest code that `fits`, or null. */
export const largestCode = (fits: (code: AircraftCode) => boolean): AircraftCode | null =>
  descending.find(fits) ?? null;
const largest = largestCode;
export const lowerCode = (a: AircraftCode | null, b: AircraftCode | null) =>
  a === null || b === null ? null : aircraftCodes.indexOf(a) < aircraftCodes.indexOf(b) ? a : b;
const lower = lowerCode;
const close = (ring: Vec2[]) => [...ring, ring[0]!];
const heading = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);
const angleBetween = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};

/** A code's largest aircraft at a stand, nose at `pos` facing `angle`, as capsules (a segment
 * and a radius): a fuselage as long as the span (radius 5.5% of it), the wing across it 45% of
 * the length back, the tailplane (35% of the span) at the tail. */
export function standShape(pos: Vec2, angle: number, code: AircraftCode) {
  const span = codeSpanM[code];
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const at = (back: number, lateral: number) => ({
    x: pos.x - along.x * back - along.y * lateral,
    y: pos.y - along.y * back + along.x * lateral,
  });
  return [
    { a: at(0, 0), b: at(span, 0), r: 0.055 * span },
    { a: at(0.45 * span, -span / 2), b: at(0.45 * span, span / 2), r: 0 },
    { a: at(0.95 * span, -0.175 * span), b: at(0.95 * span, 0.175 * span), r: 0 },
  ];
}
type Capsule = ReturnType<typeof standShape>[number];
const segmentGap = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) =>
  segmentsIntersect(a, b, c, d)
    ? 0
    : Math.min(
        segmentDistance(a, c, d),
        segmentDistance(b, c, d),
        segmentDistance(c, a, b),
        segmentDistance(d, a, b),
      );
/** The clear distance between two aircraft shapes. */
export const shapeGap = (p: Capsule[], q: Capsule[]) =>
  Math.min(...p.flatMap((s) => q.map((t) => segmentGap(s.a, s.b, t.a, t.b) - s.r - t.r)));
/** The clear distance from an aircraft shape to an open ring, 0 where they meet. */
const ringGap = (shape: Capsule[], ring: Vec2[]) =>
  Math.min(
    ...shape.map((s) =>
      pointInPolygon(s.a, close(ring))
        ? 0
        : Math.min(...ring.map((p, i) => segmentGap(s.a, s.b, p, ring[(i + 1) % ring.length]!))) -
          s.r,
    ),
  );

const box = (points: Vec2[]) =>
  [
    Math.min(...points.map((p) => p.x)),
    Math.min(...points.map((p) => p.y)),
    Math.max(...points.map((p) => p.x)),
    Math.max(...points.map((p) => p.y)),
  ] as const;

/** Buildings as obstacles (open outer rings): every building outline, terminals and hangars
 * included. */
export function airsideObstacles(buildings: Vec2[][]) {
  const segments = buildings.flatMap((ring, owner) =>
    ring.map((a, j) => ({ a, b: ring[(j + 1) % ring.length]!, owner })),
  );
  const segmentIndex = new Flatbush(Math.max(1, segments.length));
  for (const { a, b } of segments) segmentIndex.add(...box([a, b]));
  if (!segments.length) segmentIndex.add(0, 0, 0, 0);
  segmentIndex.finish();
  const buildingIndex = new Flatbush(Math.max(1, buildings.length));
  for (const ring of buildings) buildingIndex.add(...box(ring));
  if (!buildings.length) buildingIndex.add(0, 0, 0, 0);
  buildingIndex.finish();
  return {
    buildings,
    buildingIndex,
    /** Distance to the nearest building within `limit` (Infinity beyond), 0 inside one. */
    toBuilding(p: Vec2, limit: number, skip: Set<number>) {
      for (const i of buildingIndex.search(p.x, p.y, p.x, p.y))
        if (buildings[i] && !skip.has(i) && pointInPolygon(p, close(buildings[i]!))) return 0;
      let min = Infinity;
      for (const i of segmentIndex.search(p.x - limit, p.y - limit, p.x + limit, p.y + limit)) {
        const s = segments[i];
        if (s && !skip.has(s.owner)) min = Math.min(min, segmentDistance(p, s.a, s.b));
      }
      return min;
    },
    containing: (points: Vec2[]) =>
      new Set(
        points.flatMap((p) =>
          buildingIndex
            .search(p.x, p.y, p.x, p.y)
            .filter((i) => buildings[i] && pointInPolygon(p, close(buildings[i]!))),
        ),
      ),
    crossesBuilding: (a: Vec2, b: Vec2, skip?: ReadonlySet<number>) =>
      segmentIndex.search(...box([a, b])).some((i) => {
        const s = segments[i];
        return s !== undefined && !skip?.has(s.owner) && segmentsIntersect(a, b, s.a, s.b);
      }),
  };
}
export type AirsideObstacles = ReturnType<typeof airsideObstacles>;

/** Stands so close that even code A aircraft could not stand on both are alternatives (a
 * multiple-aircraft ramp's positions, TASK-302): neither limits the other's code, and aircraft
 * keep apart by their parked bodies and push sweeps (architecture section 8). */
const alternatives = (a: { pos: Vec2; heading: number }, b: { pos: Vec2; heading: number }) =>
  shapeGap(standShape(a.pos, a.heading, 'A'), standShape(b.pos, b.heading, 'A')) <
  rules.standClearanceM.A;

/** A stand's code: the largest whose aircraft (`standShape`) keeps the stand clearance from the
 * same code's aircraft on every other stand but its alternatives and from every building but one
 * it stands in. */
export function standCode(
  stand: { pos: Vec2; heading: number },
  stands: readonly { pos: Vec2; heading: number }[],
  obstacles: AirsideObstacles,
): AircraftCode | null {
  const { buildings, buildingIndex } = obstacles;
  const skip = obstacles.containing([stand.pos]);
  return largest((code) => {
    const shape = standShape(stand.pos, stand.heading, code);
    const clearance = rules.standClearanceM[code];
    const reachM = codeSpanM[code] + clearance;
    const { x, y } = stand.pos;
    if (
      buildingIndex
        .search(x - reachM, y - reachM, x + reachM, y + reachM)
        .some((i) => buildings[i] && !skip.has(i) && ringGap(shape, buildings[i]!) < clearance)
    )
      return false;
    return stands.every(
      (other) =>
        other === stand ||
        distance(other.pos, stand.pos) > 2 * reachM ||
        alternatives(stand, other) ||
        shapeGap(shape, standShape(other.pos, other.heading, code)) >= clearance,
    );
  });
}
/** How far apart two stands can be and still limit each other's code. */
export const standReachM = 2 * (codeSpanM.F + airsideRules.standClearanceM.F);

export interface CodeEdge {
  from: string;
  to: string;
  line: Vec2[];
  kind: AirsideEdgeKind;
  layer: number;
  /** A mapped width; without one the code starts at `startCode`. */
  mappedWidthM?: number;
  /** A runway edge's runway (any value identifying it). */
  runway?: unknown;
}
/** How far from a changed line a taxi edge's code can change: the widest separation plus the
 * graph detour that marks a junction. */
export const taxiReachM = airsideRules.taxiwaySeparationM.F + airsideRules.parallelJoinM;

/** Taxi edges' codes (the edges of `targets`, taxiways and taxilanes): the lower of what a
 * mapped width allows (else `startCode`) and the largest code whose separations hold at every
 * 5 m along it: from parallel taxi edges and runways (the taxiway column; two taxilanes the
 * taxilane column) and from buildings (the object columns), but a building the edge enters. */
export function taxiEdgeCodes<E extends CodeEdge>(
  edges: readonly E[],
  obstacles: AirsideObstacles,
  startCode: AircraftCode,
  targets: Iterable<E>,
): Map<E, AircraftCode | null> {
  const nodeEdges = new Map<string, E[]>();
  for (const edge of edges)
    for (const key of [edge.from, edge.to])
      nodeEdges.set(key, [...(nodeEdges.get(key) ?? []), edge]);
  const network = edges.filter((e) => e.kind !== 'lead_in');
  const lineSegments = network.flatMap((edge) =>
    edge.line.slice(1).map((b, i) => {
      const a = edge.line[i]!;
      return { edge, a, b, heading: heading(a, b), length: distance(a, b) };
    }),
  );
  const lineIndex = new Flatbush(Math.max(1, lineSegments.length));
  for (const { a, b } of lineSegments) lineIndex.add(...box([a, b]));
  if (!lineSegments.length) lineIndex.add(0, 0, 0, 0);
  lineIndex.finish();
  const runwayNodes = new Map<unknown, Set<string>>();
  for (const edge of edges)
    if (edge.kind === 'runway') {
      const nodes = runwayNodes.get(edge.runway) ?? new Set<string>();
      nodes.add(edge.from).add(edge.to);
      runwayNodes.set(edge.runway, nodes);
    }
  const reach = rules.taxiwaySeparationM.F;
  const parallelAngle = (rules.parallelDeg * Math.PI) / 180;
  const overlap = rules.parallelOverlapM;
  const sustainedParallel = (
    edge: E,
    lengths: Float64Array,
    s: number,
    segment: (typeof lineSegments)[number],
  ) => {
    const length = lengths.at(-1)!;
    if (length < overlap || segment.length < overlap) return false;
    const start = Math.max(0, Math.min(s - overlap / 2, length - overlap));
    const a = pointAtDistance(edge.line, lengths, start);
    const b = pointAtDistance(edge.line, lengths, start + overlap);
    const station = (p: Vec2) =>
      ((p.x - segment.a.x) * (segment.b.x - segment.a.x) +
        (p.y - segment.a.y) * (segment.b.y - segment.a.y)) /
      segment.length;
    const first = station(a),
      last = station(b);
    return (
      Math.min(first, last) >= 0 &&
      Math.max(first, last) <= segment.length &&
      Math.abs(last - first) >= overlap * Math.cos(parallelAngle)
    );
  };
  const travel = new Map<string, Map<string, number>>();
  /** Graph distances from `key` over the taxi network, up to what `joined` can ask. */
  const distances = (key: string) => {
    let found = travel.get(key);
    if (found) return found;
    found = new Map([[key, 0]]);
    const queue = [key];
    while (queue.length) {
      queue.sort((a, b) => found!.get(b)! - found!.get(a)!);
      const at = queue.pop()!;
      for (const edge of nodeEdges.get(at) ?? []) {
        if (edge.kind === 'lead_in') continue;
        const next = edge.from === at ? edge.to : edge.from;
        const d = found.get(at)! + polylineLength(edge.line);
        if (d > reach + rules.parallelJoinM || d >= (found.get(next) ?? Infinity)) continue;
        found.set(next, d);
        queue.push(next);
      }
    }
    travel.set(key, found);
    return found;
  };
  const joined = (e: E, a: number, f: E, b: number, budget: number) => {
    const el = polylineLength(e.line),
      fl = polylineLength(f.line);
    for (const [u, du] of [
      [e.from, a],
      [e.to, el - a],
    ] as const)
      for (const [v, dv] of [
        [f.from, b],
        [f.to, fl - b],
      ] as const) {
        const between = distances(u).get(v);
        if (between !== undefined && du + between + dv <= budget) return true;
      }
    return false;
  };
  const codes = new Map<E, AircraftCode | null>();
  for (const edge of targets) {
    if (edge.kind === 'runway' || edge.kind === 'lead_in') continue;
    const mapped = edge.mappedWidthM;
    let code = mapped === undefined ? startCode : largest((c) => rules.taxiwayWidthM[c] <= mapped);
    const skip = obstacles.containing(edge.line);
    const lengths = cumulativeLengths(edge.line);
    const length = lengths.at(-1)!;
    const objects = edge.kind === 'taxilane' ? rules.taxilaneObjectM : rules.taxiwayObjectM;
    const chordHeading = heading(edge.line[0]!, edge.line.at(-1)!);
    const straightTaxiway =
      edge.kind === 'taxiway' &&
      edge.line
        .slice(1)
        .every((p, i) => angleBetween(chordHeading, heading(edge.line[i]!, p)) <= parallelAngle);
    for (let s = 0; s <= length && code !== null; s += rules.sampleM) {
      const p = pointAtDistance(edge.line, lengths, s);
      const direction = heading(
        pointAtDistance(edge.line, lengths, Math.max(0, s - 1)),
        pointAtDistance(edge.line, lengths, Math.min(length, s + 1)),
      );
      if (edge.layer === 0) {
        const wall = obstacles.toBuilding(p, objects.F, skip);
        code = lower(
          code,
          largest((c) => objects[c] - (straightTaxiway ? taxiwayTrackingAllowanceM[c] : 0) <= wall),
        );
      }
      for (const i of lineIndex.search(p.x - reach, p.y - reach, p.x + reach, p.y + reach)) {
        const segment = lineSegments[i];
        if (!segment || segment.edge === edge || segment.edge.layer !== edge.layer) continue;
        // TASK-302: an exit or entry runs close to the runway it meets; the runway separation is
        // for parallel taxiways (Annex 14 Table 3-1), not for the taxiways joining it.
        if (segment.edge.kind === 'runway') {
          const meets = runwayNodes.get(segment.edge.runway)!;
          if (meets.has(edge.from) || meets.has(edge.to)) continue;
        }
        const away = segmentDistance(p, segment.a, segment.b);
        const turn = angleBetween(segment.heading, direction);
        if (away > reach || Math.min(turn, Math.PI - turn) > parallelAngle) continue;
        const separation =
          edge.kind === 'taxilane' && segment.edge.kind === 'taxilane'
            ? rules.taxilaneSeparationM
            : rules.taxiwaySeparationM;
        if (code === null || away >= separation[code]) continue;
        // A short cross-link does not give a pair of parallel taxi lanes more clearance.
        const separateLanes =
          segment.edge.kind !== 'runway' &&
          away >= separation.A &&
          sustainedParallel(edge, lengths, s, segment);
        if (
          !separateLanes &&
          joined(
            edge,
            s,
            segment.edge,
            nearestOnPolyline(segment.edge.line, p).along,
            away + rules.parallelJoinM,
          )
        )
          continue;
        code = lower(
          code,
          largest((c) => separation[c] <= away),
        );
      }
    }
    codes.set(edge, code);
  }
  return codes;
}

/** The obstacles of a city's airport: its context buildings, terminals and hangars. */
export function cityAirsideObstacles(city: Pick<City, 'context'>, airport: Airport) {
  const open = (ring: Vec2[]) =>
    ring.length > 1 && distance(ring[0]!, ring.at(-1)!) === 0 ? ring.slice(0, -1) : ring;
  return airsideObstacles([
    ...(city.context?.features ?? []).flatMap((f) =>
      f.kind === 'area' && f.class === 'building' && f.rings[0] ? [open(f.rings[0])] : [],
    ),
    ...Object.values(airport.terminals).map((t) => t.rings[0]!),
    ...airport.hangars.map((h) => h.rings[0]!),
  ]);
}

/** The code by rule of each stand and taxi edge named in `stands` and `edges` whose code is
 * inferred (`provenance.inferred` holds `maxCode`): what TASK-295's import rules give it in the
 * airport as it stands. A set code is the user's and stays. */
export function derivedAirsideCodes(
  city: Pick<City, 'context'>,
  airport: Airport,
  stands: Iterable<string>,
  edges: Iterable<string>,
) {
  const inferred = (item: { provenance: { inferred?: string[] } }) =>
    item.provenance.inferred?.includes('maxCode') ?? false;
  const obstacles = cityAirsideObstacles(city, airport);
  const standList = Object.keys(airport.stands)
    .sort()
    .map((id) => airport.stands[id]!);
  const standCodes = new Map<string, AircraftCode | null>();
  for (const id of new Set(stands)) {
    const stand = airport.stands[id];
    if (stand && inferred(stand)) standCodes.set(id, standCode(stand, standList, obstacles));
  }
  const coded = Object.keys(airport.edges)
    .sort()
    .map((id) => {
      const edge = airport.edges[id]!;
      return {
        ...edge,
        mappedWidthM: edge.provenance.inferred?.includes('widthM') ? undefined : edge.widthM,
        edge,
      };
    });
  const byId = new Map(coded.map((e) => [e.id, e]));
  const startCode =
    largestCode((c) => Object.values(airport.runways).some((r) => r.maxCode === c)) ?? 'F';
  const targets = [...new Set(edges)].flatMap((id) => {
    const edge = byId.get(id);
    return edge && inferred(edge.edge) ? [edge] : [];
  });
  const edgeCodes = new Map<string, AircraftCode | null>();
  for (const [edge, code] of taxiEdgeCodes(coded, obstacles, startCode, targets))
    edgeCodes.set(edge.id, code);
  return { stands: standCodes, edges: edgeCodes };
}
