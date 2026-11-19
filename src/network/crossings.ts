import {
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineCrossings,
  polylineLength,
  preparePolygon,
  segmentDistance,
  segmentIntersection,
  trimPolyline,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City } from '../schema';
import { junctionCorners } from './junctions';
import type { CLane, CompiledCity, CNode, CRoad } from './types';

// Pedestrian crossings (TASK-091, TASK-094): which road ends have one, where its stripes lie, and
// the span it covers along each lane, shared by the renderer and the stop positions.

/** The canonical roads, which carry the crossing overrides (TASK-091), and the mapped walk
 * network, whose crossing ways keep a trunk road's crossing (TASK-215). */
export type CrossingSource = { roads?: City['roads']; walk?: City['walk'] };

/** The surface edges of a road end, outward from the node. */
export function endEdges(road: CRoad, atEnd: boolean): [Vec2[], Vec2[]] {
  const half = road.surface.length / 2;
  const left = road.surface.slice(0, half),
    right = road.surface.slice(half).reverse();
  return atEnd ? [right.reverse(), left.reverse()] : [left, right];
}

/** A road end's outward direction over its first few metres. */
export function endDirection(road: CRoad, atEnd: boolean): Vec2 {
  const [left, right] = endEdges(road, atEnd);
  const ahead = (edge: Vec2[]) =>
    edge.find((p) => Math.hypot(p.x - edge[0]!.x, p.y - edge[0]!.y) >= 3) ?? edge.at(-1)!;
  const dx = (ahead(left).x + ahead(right).x - left[0]!.x - right[0]!.x) / 2,
    dy = (ahead(left).y + ahead(right).y - left[0]!.y - right[0]!.y) / 2;
  const length = Math.hypot(dx, dy);
  return { x: dx / length, y: dy / length };
}

/** A road end at a node, with its outward direction (away from the node). */
interface RoadEnd {
  road: CRoad;
  atEnd: boolean;
  direction: Vec2;
}

const topology = new WeakMap<CompiledCity, { incident: CRoad[][]; ring: Set<number> }>();

/** Incident roads by node and the roads of roundabout rings, per compiled city. A ring is a
 * closed chain of one-way roads (no opposite road in their street group) in which every road
 * continues into the next within 30 degrees, so the ring turns inside its roads, not at nodes:
 * an imported `junction=roundabout` way or an authored roundabout, never a block of one-way
 * streets. */
function cityTopology(city: CompiledCity) {
  let cached = topology.get(city);
  if (cached) return cached;
  const incident = city.nodes.map((): CRoad[] => []);
  for (const road of city.roads) {
    incident[road.from]!.push(road);
    if (road.to !== road.from) incident[road.to]!.push(road);
  }
  const groups = new Map<string, number>();
  for (const road of city.roads)
    if (road.streetGroupId !== null)
      groups.set(road.streetGroupId, (groups.get(road.streetGroupId) ?? 0) + 1);
  const oneWay = (road: CRoad) =>
    road.streetGroupId === null || groups.get(road.streetGroupId) === 1;
  const ring = new Set<number>();
  const along = Math.cos(Math.PI / 6);
  for (const road of city.roads) {
    if (ring.has(road.idx) || !oneWay(road)) continue;
    const chain = [road];
    for (let step = 0; step < 24; step++) {
      const last = chain.at(-1)!;
      const heading = endDirection(last, true);
      const next = incident[last.to]!.filter((r) => {
        if (r.from !== last.to || r === last || !oneWay(r)) return false;
        const d = endDirection(r, false);
        return -(d.x * heading.x + d.y * heading.y) > along;
      });
      if (next.length !== 1 || chain.includes(next[0]!)) {
        if (next[0] === road) for (const r of chain) ring.add(r.idx);
        break;
      }
      chain.push(next[0]!);
    }
  }
  cached = { incident, ring };
  topology.set(city, cached);
  return cached;
}

/** A node's arms (TASK-091): its road ends, where ends within 20 degrees of each other form one
 * arm if they are of one corridor or run in opposite directions (the two directions of a street,
 * a divided pair, carriageways the importer did not pair, as Munich r:476 and r:984 at n:1181). */
export function crossingArms(city: CompiledCity, node: CNode): RoadEnd[][] {
  const arms: RoadEnd[][] = [];
  const close = Math.cos(Math.PI / 9);
  for (const road of cityTopology(city).incident[node.idx]!)
    for (const atEnd of [false, true]) {
      if ((atEnd ? road.to : road.from) !== node.idx) continue;
      const end = { road, atEnd, direction: endDirection(road, atEnd) };
      const arm = arms.find(
        (ends) =>
          ends.some(
            (e) =>
              e.atEnd !== atEnd ||
              (road.corridorId !== null && e.road.corridorId === road.corridorId),
          ) &&
          ends.every(
            (e) => e.direction.x * end.direction.x + e.direction.y * end.direction.y > close,
          ),
      );
      if (arm) arm.push(end);
      else arms.push([end]);
    }
  return arms;
}

const noAisles = new Set<number>();
const aisleSets = new WeakMap<object, Set<number>>();
/** Compiled indices of lot aisle roads, cached by the compiled lot list. */
function aisleRoads(city: CompiledCity): Set<number> {
  if (!city.lots) return noAisles;
  let set = aisleSets.get(city.lots);
  if (!set) {
    set = new Set<number>();
    for (const lot of city.lots)
      for (const id of lot.aisles) {
        const idx = city.index.road.get(id);
        if (idx !== undefined) set.add(idx);
      }
    aisleSets.set(city.lots, set);
  }
  return set;
}

const expressway = (road: CRoad) => road.roadClass === 'motorway' || road.roadClass === 'ramp';

/** The default (architecture section 11, TASK-091): a road end at a node of three or more arms,
 * or at a signalized node, has a crossing, unless the road is a motorway or a ramp (`_link`
 * roads and slip lanes; TASK-217: a ramp only where OSM maps none over it), every arm of the
 * node is (a motorway merge or diverge), or the road is part of a roundabout ring. TASK-104: lot aisles get none and are not arms. TASK-215 (M3): nor
 * a trunk road (the B 31 at its ramps and T-nodes in Freiburg, Munich's at its ramps) unless OSM
 * maps a crossing over the end (`mappedOver`). TASK-217: TASK-215's doubled-crossing rule (M4:
 * one of two crossings under 7.5 m apart on a road) is dropped. Its doubled stripes were default
 * crossings at nodes without signals, which are no longer painted where nothing is mapped
 * (`crossingStyle`), and the walk crossings it removed cost Munich 4 to 5% of mean delay. */
export function crossingDefault(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): boolean {
  const node = city.nodes[atEnd ? road.to : road.from]!;
  // TASK-131: no crossing on a junction group's inner road; crossings stand at its entries.
  if (road.group !== undefined) return false;
  const aisles = aisleRoads(city);
  if (
    road.roadClass === 'motorway' ||
    aisles.has(road.idx) ||
    cityTopology(city).ring.has(road.idx)
  )
    return false;
  // TASK-217 (D1): a ramp as a trunk road, where a mapped crossing way crosses it (Freiburg's
  // zebras over the `secondary_link` roads at Stefan-Meier-Straße and Zur Unterführung).
  if ((road.roadClass === 'trunk' || road.roadClass === 'ramp') && !mappedOver(road, atEnd, source))
    return false;
  const arms = streetArms(city, node);
  return (
    (arms.length >= 3 || node.signal !== null) &&
    !arms.every((arm) => arm.every((e) => expressway(e.road)))
  );
}

/** TASK-104: lot aisles are driveways, not arms; a lot entry adds no crossing to its street. */
function streetArms(city: CompiledCity, node: CNode) {
  const aisles = aisleRoads(city);
  return crossingArms(city, node).filter((arm) => !arm.every((e) => aisles.has(e.road.idx)));
}

/** TASK-215 (M3): how far from a road end's cut a mapped crossing way still crosses that end
 * (TASK-140's reach for re-anchoring one onto the stripes). */
export const MAPPED_M = 12;

interface MappedCrossing {
  line: Vec2[];
  grade: number;
}
const mappedSets = new WeakMap<object, MappedCrossing[]>();
/** The mapped crossing ways of a city (walk links of kind `crossing`), with their grades. */
function mappedCrossings(source?: CrossingSource): MappedCrossing[] {
  const walk = source?.walk;
  if (!walk) return [];
  let set = mappedSets.get(walk.links);
  if (!set) {
    set = Object.values(walk.links)
      .filter((l) => l.kind === 'crossing')
      .map((l) => ({ line: l.line, grade: l.layer ?? walk.nodes[l.from]!.layer }));
    mappedSets.set(walk.links, set);
  }
  return set;
}

/** A mapped crossing way (walk link of kind `crossing`) crosses the end's surface within
 * `MAPPED_M` of its cut. */
function mappedOver(road: CRoad, atEnd: boolean, source?: CrossingSource): boolean {
  const links = mappedCrossings(source);
  if (!links.length) return false;
  const [left, right] = endEdges(road, atEnd).map((edge) =>
    trimPolyline(edge, 0, Math.max(0, polylineLength(edge) - MAPPED_M)),
  );
  const ring = [...left!, ...right!.reverse(), left![0]!];
  return links.some(({ line }) =>
    line.some(
      (p, i) =>
        pointInPolygon(p, ring, 0) ||
        (i > 0 &&
          ring.some((q, j) => j > 0 && segmentIntersection(line[i - 1]!, p, ring[j - 1]!, q))),
    ),
  );
}

/**
 * TASK-217 (D1): where a mapped crossing way crosses an arm, along the arm's axis from the node:
 * the mean of the points where it crosses the lane centrelines of the arm's road ends, each
 * within `MAPPED_M` of its cut and in the half of its lane nearer the node (so a crossing on a
 * short road belongs to one of its ends). Of several, the one nearest the node; null for none.
 */
function mappedAt(
  city: CompiledCity,
  node: CNode,
  arm: RoadEnd[],
  axis: Vec2,
  source?: CrossingSource,
): number | null {
  let best: number | null = null;
  for (const link of mappedCrossings(source)) {
    const along: number[] = [];
    for (const e of arm) {
      if (link.grade !== e.road.grade) continue;
      for (const i of e.road.lanes) {
        const lane = city.lanes[i]!;
        for (const hit of polylineCrossings(link.line, lane.polyline)) {
          const s = e.atEnd ? lane.lengthM - hit.alongB : hit.alongB;
          if (s > MAPPED_M || s > lane.lengthM / 2) continue;
          along.push((hit.point.x - node.pos.x) * axis.x + (hit.point.y - node.pos.y) * axis.y);
        }
      }
    }
    if (!along.length) continue;
    const t = along.reduce((a, b) => a + b, 0) / along.length;
    if (best === null || t < best) best = t;
  }
  return best;
}

/** TASK-217 (D1): how a road end's crossing is painted. `signal`: at a signalized node, the
 * two dashed lines of a signalised crossing (German practice: no zebra under signals), also where
 * a mapped crossing leads the arm within `SIGNAL_NEAR_M` of a signalized node; `zebra`: where
 * a mapped crossing way leads the arm (`crossingPlacement`), where an edit turned the
 * crossing on, and at the default crossings of roads drawn by hand; `none`: a default crossing
 * of an imported road where OSM maps none near the arm (TASK-216's D1: 155 of 167 drawn crossings
 * at the Hauptbahnhof lay over 4 m from any mapped one; a mapped city maps its marked crossings).
 * An unpainted crossing still exists: walkers cross there and cars stop and yield as before. */
export type CrossingStyle = 'zebra' | 'signal' | 'none';
export function crossingStyle(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): CrossingStyle {
  const node = city.nodes[atEnd ? road.to : road.from]!;
  if (node.signal !== null) return 'signal';
  const placement = crossingPlacement(city, road, atEnd, source);
  if (placement.mapped) {
    const points = placement.stripes.flat();
    const centre = points.length
      ? {
          x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
          y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
        }
      : node.pos;
    return nearSignal(city, centre) ? 'signal' : 'zebra';
  }
  const canonical = source?.roads?.[road.id];
  if (canonical?.crossings?.[atEnd ? 'end' : 'start'] === true) return 'zebra';
  return canonical?.provenance.source === 'osm' ? 'none' : 'zebra';
}

/** TASK-217 (D1): a mapped crossing this close to a signalized node is a signalised crossing,
 * whose own signal the importer moved to the junction (TASK-216's D4: `controlTransferred`
 * leaves the crossing node uncontrolled); German practice puts no zebra at a signalised junction. */
export const SIGNAL_NEAR_M = 12;
export function nearSignal(city: CompiledCity, p: Vec2): boolean {
  return city.nodes.some(
    (n) => n.signal !== null && Math.hypot(n.pos.x - p.x, n.pos.y - p.y) < SIGNAL_NEAR_M,
  );
}

/** Whether a road end has a crossing: its override in the canonical road, else the default. */
export function crossingEnabled(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): boolean {
  return (
    source?.roads?.[road.id]?.crossings?.[atEnd ? 'end' : 'start'] ??
    crossingDefault(city, road, atEnd, source)
  );
}

const STRIPE_M = 0.45;
const STRIPE_PITCH_M = 0.9;
const CROSSING_M = 2.5;
/** TASK-091: the near edge lies this far beyond the point where the curb return meets the road
 * edge, and no stripe comes closer to a curb return. */
const CURB_CLEAR_M = 1;
/** A crossing needs this much of its lanes beyond its near edge (TASK-072's 10 m lane, whose
 * crossing started 0.25 m from the cut). */
const CROSSING_ROAD_M = 9.75;
/** TASK-089: how far a crossing may move out along the road to clear the junction outline. */
const MOVE_OUT_M = 6;

/**
 * Where a road end's crossing lies: its stripes and the distances from the cut to its edges,
 * whether or not the end has one (`crossingStripes` asks). TASK-091: its near edge lies 1 m
 * beyond the farthest point where a curb return of the node meets a road edge of the arm,
 * and no stripe comes within 1 m of a curb return; TASK-089: where the outline reaches over the
 * road the crossing moves out, all stripes together, to the first place that keeps the most
 * stripes clear (up to 6 m); lanes shorter than the near edge plus 9.75 m carry no stripes.
 * TASK-094 (B53): signalized approaches set back from the curb return too, but do not move out
 * (their stop line follows the crossing, and each metre out is a metre less storage and a longer
 * start at green: Munich at 0.15 gridlocked 75 times with the move-out, 41 without); their stop
 * line lies behind the crossing (`populateStops`), and where it would fall in a lane's first half
 * the end has no stripes and keeps TASK-072's stop.
 *
 * TASK-215 (M5): the crossing is one straight band across the arm, square to the arm's axis (the
 * mean outward direction of its road ends), at the same place for every road end of the arm and
 * no nearer the node than 0.25 m beyond the farthest lane cut of the arm. Each lane's span is
 * where its centreline crosses the band, so on a lane cut obliquely (Freiburg r:460 at n:403, 5.5
 * m between its lanes' cuts) or a direction cut farther out (n:11, 4.1 m) the stripes no longer
 * step lane by lane. `nearM` and `farM` are the means of the lanes' spans.
 */
export function crossingPlacement(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): Placement {
  const key = source?.walk?.links ?? noMapped;
  let cache = placements.get(key);
  if (!cache) placements.set(key, (cache = new WeakMap()));
  if (!cache.get(road)?.[+atEnd]) placeArm(city, road, atEnd, source, cache);
  const placement = cache.get(road)![+atEnd]!;
  return placement.stripes.length && stopInFirstHalf(city, road, atEnd, placement)
    ? { ...placement, stripes: [] }
    : placement;
}

/** TASK-094: a served signal's stop line behind the crossing would fall in a lane's first half. */
function stopInFirstHalf(city: CompiledCity, road: CRoad, atEnd: boolean, placement: Placement) {
  return (
    atEnd &&
    servedSignal(city, road) &&
    road.lanes.some((i, k) => {
      const lane = city.lanes[i]!;
      return lane.lengthM - placement.lanes[k]!.farM - STOP_CLEAR_M < lane.lengthM / 2;
    })
  );
}

interface Placement {
  stripes: Vec2[][];
  nearM: number;
  farM: number;
  /** Each lane's span from the cut, in `road.lanes` order. */
  lanes: { nearM: number; farM: number }[];
  /** TASK-217 (D1): a mapped crossing way leads the arm (`mappedAt`). */
  mapped: boolean;
}

/** Placements by mapped walk links and compiled road (static geometry: the default and overrides
 * do not move them). */
const placements = new WeakMap<object, WeakMap<CRoad, Placement[]>>();
const noMapped = {};

/** Places the crossings of the arm of a road end and caches them by road end. TASK-091's
 * placement (`cutFrame`) stays unless its stripes step by more than `STEP_M` along the arm's
 * axis, across an end's lanes or between its ends; then one band across the arm (`bandFrame`),
 * unless that leaves an end fewer stripes (Freiburg r:1448 at n:552, too short for a band clear
 * of the far curb). */
function placeArm(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source: CrossingSource | undefined,
  cache: WeakMap<CRoad, Placement[]>,
) {
  const node = city.nodes[atEnd ? road.to : road.from]!;
  const arm = crossingArms(city, node).find((a) =>
    a.some((e) => e.road.idx === road.idx && e.atEnd === atEnd),
  )!;
  const curbs = junctionCorners(node).filter((c) => c.kind === 'curb' && c.curve);
  const sum = arm.reduce((s, e) => ({ x: s.x + e.direction.x, y: s.y + e.direction.y }), {
    x: 0,
    y: 0,
  });
  const axis = { x: sum.x / Math.hypot(sum.x, sum.y), y: sum.y / Math.hypot(sum.x, sum.y) };
  const drawn = (p: Placement, k: number) =>
    stopInFirstHalf(city, arm[k]!.road, arm[k]!.atEnd, p) ? 0 : p.stripes.length;
  let chosen = arm.map((e) => placeCrossing(city, node, e, curbs, cutFrame(city, arm, e, curbs)));
  // Where each drawn end's lanes reach the near edge, along the axis.
  const near = chosen.flatMap((p, k) => {
    if (!drawn(p, k)) return [];
    return arm[k]!.road.lanes.map((i, j) => {
      const lane = city.lanes[i]!;
      const d = arm[k]!.atEnd ? lane.lengthM - p.lanes[j]!.nearM : p.lanes[j]!.nearM;
      const q = pointAtDistance(lane.polyline, lane.cumulative, d);
      return (q.x - node.pos.x) * axis.x + (q.y - node.pos.y) * axis.y;
    });
  });
  if (near.length && Math.max(...near) - Math.min(...near) > STEP_M) {
    const band = arm.map((e) =>
      placeCrossing(city, node, e, curbs, bandFrame(city, node, arm, e, curbs, axis)),
    );
    if (band.every((p, k) => drawn(p, k) >= drawn(chosen[k]!, k))) chosen = band;
  }
  // TASK-217 (D1): at a node without signals a mapped crossing way leads the arm's style
  // (`crossingStyle`); the band stays where the rules above put it. (The variant that moved the
  // band to the mapped crossing cost Munich 3.7 to 4.6% of mean delay in fixed time.)
  const mapped = node.signal === null ? mappedAt(city, node, arm, axis, source) : null;
  arm.forEach((e, k) => {
    let cached = cache.get(e.road);
    if (!cached) cache.set(e.road, (cached = []));
    cached[+e.atEnd] = { ...chosen[k]!, mapped: mapped !== null };
  });
}

/** TASK-215 (M5): how far TASK-091's crossing may step across the road before it is redrawn as
 * one band (Freiburg's steps: 1.3 to 5.5 m; square ends of the grid and town: none). */
const STEP_M = 0.25;

/** Where a crossing may start (`near`), and how far from its cut a lane reaches position `t` of
 * the frame on its centreline, or `offset` metres to its right. */
interface Frame {
  near: number;
  station: (lane: CLane, t: number, offset?: number) => number;
}

type Curb = ReturnType<typeof junctionCorners>[number];

/** TASK-091's frame: distances from each lane's own cut; the near edge 1 m beyond the farthest
 * curb return of the arm, measured along the road's nearest lane, and at least 0.25 m out. */
function cutFrame(city: CompiledCity, arm: RoadEnd[], end: RoadEnd, curbs: Curb[]): Frame {
  const lanes = end.road.lanes.map((index) => city.lanes[index]!);
  let near = 0.25;
  for (const corner of curbs)
    corner.roads.forEach((index, k) => {
      if (!arm.some((e) => e.road.idx === index)) return;
      const tangent = corner.tangents![k]!;
      const nearest = lanes
        .map((lane) => ({ lane, on: nearestOnPolyline(lane.polyline, tangent) }))
        .reduce((a, b) => (b.on.away < a.on.away ? b : a));
      const fromCut = end.atEnd ? nearest.lane.lengthM - nearest.on.along : nearest.on.along;
      near = Math.max(near, fromCut + CURB_CLEAR_M);
    });
  return { near, station: (_, t) => t };
}

/** TASK-215 (M5): positions along the arm's axis (the mean outward direction of its ends) from
 * the node; the near edge 0.25 m beyond the farthest lane cut of the arm and 1 m beyond its
 * farthest curb return, along the axis. */
function bandFrame(
  city: CompiledCity,
  node: CNode,
  arm: RoadEnd[],
  end: RoadEnd,
  curbs: Curb[],
  axis: Vec2,
): Frame {
  const along = (p: Vec2) => (p.x - node.pos.x) * axis.x + (p.y - node.pos.y) * axis.y;
  let near =
    Math.max(
      ...arm.flatMap((e) =>
        e.road.lanes.map((i) => {
          const line = city.lanes[i]!.polyline;
          return along(e.atEnd ? line.at(-1)! : line[0]!);
        }),
      ),
    ) + 0.25;
  for (const corner of curbs)
    corner.roads.forEach((index, k) => {
      if (arm.some((e) => e.road.idx === index))
        near = Math.max(near, along(corner.tangents![k]!) + CURB_CLEAR_M);
    });
  /** Along the lane outward from the node, to where it first reaches `t` (along its first or
   * last segment's direction before the cut or past its far end). */
  const centre = (lane: CLane, t: number) => {
    const line = end.atEnd ? lane.polyline.toReversed() : lane.polyline;
    let s = 0,
      before = along(line[0]!);
    if (t <= before) return t - before;
    for (let i = 1; i < line.length; i++) {
      const after = along(line[i]!),
        length = Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y);
      if (after >= t) return s + (length * (t - before)) / (after - before);
      s += length;
      before = after;
    }
    return s + t - before;
  };
  // A point `offset` to the right of a lane lies `offset` times its normal's share of the axis
  // farther along: taken back, so the band's edges are straight across lanes oblique to the axis.
  const station = (lane: CLane, t: number, offset = 0) => {
    const d = centre(lane, t);
    const h = headingAtDistance(lane.polyline, lane.cumulative, end.atEnd ? lane.lengthM - d : d);
    return centre(lane, t - offset * (-Math.sin(h) * axis.x + Math.cos(h) * axis.y));
  };
  return { near, station };
}

/** The crossing of road end `end` in `frame`. */
function placeCrossing(
  city: CompiledCity,
  node: CNode,
  end: RoadEnd,
  curbs: Curb[],
  { near, station }: Frame,
): Placement {
  const { road, atEnd } = end;
  const lanes = road.lanes.map((index) => city.lanes[index]!);
  if (!node.outline.length)
    return {
      stripes: [],
      nearM: 0,
      farM: 0,
      lanes: lanes.map(() => ({ nearM: 0, farM: 0 })),
      mapped: false,
    };
  const width = lanes.reduce((sum, lane) => sum + lane.widthM, 0);
  const local = (t: number, side: number): Vec2 => {
    let edge = 0;
    const lane = lanes.find((lane) => {
      if (side <= edge + lane.widthM) return true;
      edge += lane.widthM;
      return false;
    })!;
    const offset = side - edge - lane.widthM / 2;
    const d = station(lane, t, offset);
    const distance = atEnd ? lane.lengthM - d : d;
    const point = pointAtDistance(lane.polyline, lane.cumulative, distance);
    const heading = headingAtDistance(lane.polyline, lane.cumulative, distance);
    return { x: point.x - Math.sin(heading) * offset, y: point.y + Math.cos(heading) * offset };
  };
  const onSurface = preparePolygon([...road.surface, road.surface[0]!]);
  // A set-back crossing on a short road must not reach under the far node's junction either.
  const far = city.nodes[atEnd ? road.from : road.to]!.outline;
  const inOwn = preparePolygon(node.outline);
  const inFar = far.length ? preparePolygon(far) : () => false;
  const outside = (p: Vec2) => !inOwn(p) && !inFar(p);
  const clearOfCurbs = (p: Vec2) =>
    curbs.every((c) =>
      c.curve!.every((q, i) => i === 0 || segmentDistance(p, c.curve![i - 1]!, q) >= CURB_CLEAR_M),
    );
  const at = (from: number) => {
    const stripes: Vec2[][] = [];
    for (let side = 0.225; side + STRIPE_M <= width; side += STRIPE_PITCH_M) {
      let edge = 0;
      const short = lanes.some((lane) => {
        const overlaps = side < edge + lane.widthM && side + STRIPE_M > edge;
        edge += lane.widthM;
        return overlaps && lane.lengthM < station(lane, from) + CROSSING_ROAD_M;
      });
      if (short) continue;
      const stripe = [
        local(from, side),
        local(from + CROSSING_M, side),
        local(from + CROSSING_M, side + STRIPE_M),
        local(from, side + STRIPE_M),
      ];
      if (stripe.every((p) => onSurface(p) && outside(p) && clearOfCurbs(p))) stripes.push(stripe);
    }
    return stripes;
  };
  const full = Math.floor((width - 0.225) / STRIPE_PITCH_M + 0.5);
  let best = { stripes: at(near), from: near };
  // A served signal's approach stays where the curb return puts it (TASK-094).
  const fixed = atEnd && servedSignal(city, road);
  for (
    let offset = 0.25;
    !fixed && offset <= MOVE_OUT_M + 1e-9 && best.stripes.length < full;
    offset += 0.25
  ) {
    const stripes = at(near + offset);
    if (stripes.length > best.stripes.length) best = { stripes, from: near + offset };
  }
  const spans = lanes.map((lane) => ({
    nearM: station(lane, best.from),
    farM: station(lane, best.from + CROSSING_M),
  }));
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  return {
    stripes: best.stripes,
    nearM: mean(spans.map((s) => s.nearM)),
    farM: mean(spans.map((s) => s.farM)),
    lanes: spans,
    mapped: false,
  };
}

/** TASK-072: a road whose end node is signalized and that has a movement there that can get
 * green: its lanes stop before the junction's crossing. */
export function servedSignal(city: CompiledCity, road: CRoad): boolean {
  return (
    city.nodes[road.to]!.signal !== null &&
    road.lanes.some((index) =>
      city.lanes[index]!.out.some((movement) => !city.movements[movement]!.neverGreen),
    )
  );
}

/** A car waiting at a served signal keeps this far short of the crossing (TASK-094). */
export const STOP_CLEAR_M = 0.5;

/**
 * The span of the crossing a road end draws, along one of its lanes, in that lane's metres:
 * `nearM` is the edge nearer the node, `farM` the edge farther from it (at the road's end
 * `farM < nearM`). Null where the end draws no crossing (off by its override or default, or no
 * stripe fits). The renderer ends lane lines and arrows at it, `populateStops` stops cars before
 * it.
 */
export function crossingSpan(
  city: CompiledCity,
  lane: CLane,
  atEnd: boolean,
  source?: CrossingSource,
): { nearM: number; farM: number } | null {
  const road = city.roads[lane.road]!;
  if (!crossingEnabled(city, road, atEnd, source)) return null;
  const { stripes, lanes } = crossingPlacement(city, road, atEnd, source);
  if (!stripes.length) return null;
  const { nearM, farM } = lanes[road.lanes.indexOf(lane.idx)]!;
  return atEnd ? { nearM: lane.lengthM - nearM, farM: lane.lengthM - farM } : { nearM, farM };
}

/** TASK-072's crossing, 0.25 to 2.75 m from the cut, which a served signal's stop line keeps
 * clear where its end draws no stripes (`populateStops`: lengthM - 3 on lanes of 10 m or more). */
export const UNMARKED_CENTRE_M = 1.5;

/**
 * TASK-140 (B59): where a crossing walk link crosses a road end, in metres from the cut along
 * each of its lanes (`road.lanes` order). Where the end draws stripes, the centre of the stripes
 * on each lane (TASK-215: they differ where the band crosses the lanes obliquely), so the walk
 * link, its walk lights at the link's ends and the walker conflict zone (the link's spans) lie
 * where the stripes are drawn, with the stop line behind them; at a served signal that draws
 * none, the centre of TASK-072's crossing in front of the stop line. Null elsewhere, where an
 * unmarked crossing keeps its own position; a junction group's inner road has neither (TASK-131).
 */
export function crossingCentres(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): number[] | null {
  if (road.group !== undefined) return null;
  if (crossingEnabled(city, road, atEnd, source)) {
    const { stripes, lanes } = crossingPlacement(city, road, atEnd, source);
    if (stripes.length) return lanes.map((span) => (span.nearM + span.farM) / 2);
  }
  return atEnd && servedSignal(city, road) && road.lanes.every((i) => city.lanes[i]!.lengthM >= 10)
    ? road.lanes.map(() => UNMARKED_CENTRE_M)
    : null;
}

/** The mean of `crossingCentres` over the end's lanes. */
export function crossingCentreM(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): number | null {
  const centres = crossingCentres(city, road, atEnd, source);
  return centres && centres.reduce((a, b) => a + b, 0) / centres.length;
}

/** A road end crossed at `atM` metres from its cut, on every lane or per lane. */
export interface CrossedEnd {
  road: CRoad;
  atEnd: boolean;
  atM: number | readonly number[];
}

/**
 * TASK-140: the line a crossing walk link follows over road ends: across each end's lanes at
 * `atM` from the cut (measured along each lane, as `crossingSpan` does, or each lane's own), through every lane's
 * left and right edges, so the link meets each lane's centreline at `atM` in the middle of a
 * segment; the ends in order across, joined where they meet or across a median.
 */
export function crossingLine(city: CompiledCity, ends: CrossedEnd[]): Vec2[] {
  const pieces = ends.map(({ road, atEnd, atM }) => {
    const points: Vec2[] = [];
    for (const [k, index] of road.lanes.entries()) {
      const lane = city.lanes[index]!;
      const m = typeof atM === 'number' ? atM : atM[k]!;
      const s = Math.min(lane.lengthM, Math.max(0, atEnd ? lane.lengthM - m : m));
      const p = pointAtDistance(lane.polyline, lane.cumulative, s);
      const h = headingAtDistance(lane.polyline, lane.cumulative, s);
      const dx = Math.sin(h) * (lane.widthM / 2),
        dy = -Math.cos(h) * (lane.widthM / 2);
      push(points, { x: p.x + dx, y: p.y + dy });
      points.push({ x: p.x - dx, y: p.y - dy });
    }
    return points;
  });
  const first = pieces[0]!;
  const axis = { x: first.at(-1)!.x - first[0]!.x, y: first.at(-1)!.y - first[0]!.y };
  const along = (p: Vec2) => p.x * axis.x + p.y * axis.y;
  const line: Vec2[] = [];
  for (const piece of pieces
    .map((p) => (along(p.at(-1)!) < along(p[0]!) ? p.toReversed() : p))
    .sort((a, b) => along(a[0]!) + along(a.at(-1)!) - along(b[0]!) - along(b.at(-1)!)))
    for (const p of piece) push(line, p);
  return line;
}

/** Appends `p`, merging it with the last point when they are within 5 cm. */
function push(line: Vec2[], p: Vec2) {
  const last = line.at(-1);
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.05)
    line[line.length - 1] = { x: (p.x + last.x) / 2, y: (p.y + last.y) / 2 };
  else line.push(p);
}
