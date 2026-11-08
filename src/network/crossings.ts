import {
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
  preparePolygon,
  segmentDistance,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City } from '../schema';
import { junctionCorners } from './junctions';
import type { CLane, CompiledCity, CNode, CRoad } from './types';

// Pedestrian crossings (TASK-091, TASK-094): which road ends have one, where its stripes lie, and
// the span it covers along each lane, shared by the renderer and the stop positions.

/** The canonical roads, which carry the crossing overrides (TASK-091). */
export type CrossingSource = { roads?: City['roads'] };

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
 * roads and slip lanes), every arm of the node is (a motorway merge or diverge), or the road is
 * part of a roundabout ring. TASK-104: lot aisles get none and are not arms. */
export function crossingDefault(city: CompiledCity, road: CRoad, atEnd: boolean): boolean {
  const node = city.nodes[atEnd ? road.to : road.from]!;
  const aisles = aisleRoads(city);
  if (expressway(road) || aisles.has(road.idx) || cityTopology(city).ring.has(road.idx))
    return false;
  // TASK-104: lot aisles are driveways, not arms; a lot entry adds no crossing to its street.
  const arms = crossingArms(city, node).filter((arm) => !arm.every((e) => aisles.has(e.road.idx)));
  return (
    (arms.length >= 3 || node.signal !== null) &&
    !arms.every((arm) => arm.every((e) => expressway(e.road)))
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
    crossingDefault(city, road, atEnd)
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
 * measured along each road, and no stripe comes within 1 m of a curb return; TASK-089: where the
 * outline reaches over the road the crossing moves out, all stripes together, to the first place
 * that keeps the most stripes clear (up to 6 m); lanes shorter than the near edge plus 9.75 m
 * carry no stripes. TASK-094 (B53): signalized approaches set back from the curb return too, but
 * do not move out (their stop line follows the crossing, and each metre out is a metre less
 * storage and a longer start at green: Munich at 0.15 gridlocked 75 times with the move-out, 41
 * without); their stop line lies behind the crossing (`populateStops`), and where it would fall
 * in a lane's first half the end has no stripes and keeps TASK-072's stop.
 */
export function crossingPlacement(city: CompiledCity, road: CRoad, atEnd: boolean): Placement {
  let cached = placements.get(road);
  if (!cached) placements.set(road, (cached = []));
  const placement = (cached[+atEnd] ??= placeCrossing(city, road, atEnd));
  const clamped =
    atEnd &&
    servedSignal(city, road) &&
    road.lanes.some((i) => {
      const lane = city.lanes[i]!;
      return lane.lengthM - placement.farM - STOP_CLEAR_M < lane.lengthM / 2;
    });
  return clamped && placement.stripes.length ? { ...placement, stripes: [] } : placement;
}

interface Placement {
  stripes: Vec2[][];
  nearM: number;
  farM: number;
}

/** Placements by compiled road (static geometry: the default and overrides do not move them). */
const placements = new WeakMap<CRoad, Placement[]>();

function placeCrossing(city: CompiledCity, road: CRoad, atEnd: boolean): Placement {
  const node = city.nodes[atEnd ? road.to : road.from]!;
  if (!node.outline.length) return { stripes: [], nearM: 0, farM: 0 };
  const arm = crossingArms(city, node).find((a) =>
    a.some((e) => e.road.idx === road.idx && e.atEnd === atEnd),
  )!;
  const lanes = road.lanes.map((index) => city.lanes[index]!);
  const curbs = junctionCorners(node).filter((c) => c.kind === 'curb' && c.curve);
  let near = 0.25;
  for (const corner of curbs)
    corner.roads.forEach((index, k) => {
      if (!arm.some((e) => e.road.idx === index)) return;
      const tangent = corner.tangents![k]!;
      const nearest = lanes
        .map((lane) => ({ lane, on: nearestOnPolyline(lane.polyline, tangent) }))
        .reduce((a, b) => (b.on.away < a.on.away ? b : a));
      const fromCut = atEnd ? nearest.lane.lengthM - nearest.on.along : nearest.on.along;
      near = Math.max(near, fromCut + CURB_CLEAR_M);
    });
  const width = lanes.reduce((sum, lane) => sum + lane.widthM, 0);
  const local = (d: number, side: number): Vec2 => {
    let edge = 0;
    const lane = lanes.find((lane) => {
      if (side <= edge + lane.widthM) return true;
      edge += lane.widthM;
      return false;
    })!;
    const distance = atEnd ? lane.lengthM - d : d;
    const point = pointAtDistance(lane.polyline, lane.cumulative, distance);
    const heading = headingAtDistance(lane.polyline, lane.cumulative, distance);
    const offset = side - edge - lane.widthM / 2;
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
        return overlaps && lane.lengthM < from + CROSSING_ROAD_M;
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
  let best = { stripes: at(near), nearM: near, farM: near + CROSSING_M };
  // A served signal's approach stays where the curb return puts it (TASK-094).
  const fixed = atEnd && servedSignal(city, road);
  for (
    let offset = 0.25;
    !fixed && offset <= MOVE_OUT_M + 1e-9 && best.stripes.length < full;
    offset += 0.25
  ) {
    const stripes = at(near + offset);
    if (stripes.length > best.stripes.length)
      best = { stripes, nearM: near + offset, farM: near + offset + CROSSING_M };
  }
  return best;
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
  const { stripes, nearM, farM } = crossingPlacement(city, road, atEnd);
  if (!stripes.length) return null;
  return atEnd ? { nearM: lane.lengthM - nearM, farM: lane.lengthM - farM } : { nearM, farM };
}
