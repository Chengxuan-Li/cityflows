import {
  boxesMeet,
  boxOf,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
  polylineCrossings,
  preparePolygon,
  segmentDistance,
} from '../geo/polyline';
import type { Box } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City, CrossingMarking } from '../schema';
import { isSignalCrossing, junctionCorners } from './junctions';
import type { CLane, CompiledCity, CNode, CRoad } from './types';

// Pedestrian crossings (TASK-091, TASK-094): which road ends have one, where its stripes lie, and
// the span it covers along each lane, shared by the renderer and the stop positions.

/** The canonical roads, which carry the crossing overrides (TASK-091), and the mapped walk
 * network, whose crossing links guide placement (TASK-265) and paint (TASK-217). */
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

/** TASK-287: the roads meeting a node, in compiled order (`city.roads.filter` by node, which the
 * renderer ran per road end). */
export function nodeRoads(city: CompiledCity, node: CNode): CRoad[] {
  return cityTopology(city).incident[node.idx]!;
}

/** A node's arms (TASK-091): its road ends, where ends within 20 degrees of each other form one
 * arm if they are of one corridor or run in opposite directions (the two directions of a street,
 * a divided pair, carriageways the importer did not pair, as Munich r:476 and r:984 at n:1181). */
export function crossingArms(city: CompiledCity, node: CNode): RoadEnd[][] {
  // TASK-287: per compiled city and node; callers read the arms, never change them (York's first
  // frame asked for them 15,000 times for 1,096 nodes, each time for every incident road end).
  let byNode = armSets.get(city);
  if (!byNode) armSets.set(city, (byNode = []));
  return (byNode[node.idx] ??= nodeArms(city, node));
}
const armSets = new WeakMap<CompiledCity, RoadEnd[][][]>();
function nodeArms(city: CompiledCity, node: CNode): RoadEnd[][] {
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
  // TASK-131: no crossing on a junction group's inner road; crossings stand at its entries.
  if (road.group !== undefined) return false;
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

/** TASK-217 (D1): how far from a road end's cut a mapped crossing way still leads that end's
 * crossing (TASK-140's reach for re-anchoring one onto the stripes). */
export const MAPPED_M = 12;

interface MappedCrossing {
  line: Vec2[];
  box: Box;
  grade: number;
  /** TASK-265: a crossing mapped only as a node of the road (TASK-239's `addNodeCrossings`): the
   * link and both its end nodes carry that one node's OSM id. */
  node: boolean;
  marking?: CrossingMarking;
}
const mappedSets = new WeakMap<CompiledCity, WeakMap<object, MappedCrossing[]>>();
/** The mapped crossing ways of a city (walk links of kind `crossing`), with their grades. Cached
 * per compiled city (TASK-265): the importer compiles the city before it adds the node crossings
 * to the same walk links (TASK-239's `addNodeCrossings`), so a list cached by the links alone left
 * them out of every later compile in that process, and a fresh import placed and painted
 * differently from a cached one. */
function mappedCrossings(city: CompiledCity, source?: CrossingSource): MappedCrossing[] {
  const walk = source?.walk;
  if (!walk) return [];
  let byLinks = mappedSets.get(city);
  if (!byLinks) mappedSets.set(city, (byLinks = new WeakMap()));
  let set = byLinks.get(walk.links);
  if (!set) {
    set = Object.values(walk.links)
      .filter((l) => l.kind === 'crossing')
      .map((l) => {
        const osm = l.provenance.osmIds;
        return {
          line: l.line,
          box: boxOf(l.line),
          ...(l.marking ? { marking: l.marking } : {}),
          grade: l.layer ?? walk.nodes[l.from]!.layer,
          node:
            osm?.length === 1 &&
            [l.from, l.to].every((id) => walk.nodes[id]!.provenance.osmIds?.[0] === osm[0]),
        };
      });
    byLinks.set(walk.links, set);
  }
  return set;
}

/**
 * TASK-265: where OSM maps a crossing node on a road end, in metres from its cut: the link the
 * importer makes of a crossing mapped only as a node of the road (TASK-239), at the mean of the
 * points where it meets the end's lane centrelines within `MAPPED_M` of the cut and in the half
 * of the lane nearer the node (as `mappedArm`); of several, the one nearest the cut. Null where
 * OSM maps none there. Crossing ways keep TASK-140's anchoring onto the curb rule's band: moving
 * the band onto them too (the first version) moved 98 Munich zebra ends, most of them about 4 m
 * nearer the junction, into the drawn curb returns, and Munich 0.15 seed 1 (choice off) lost about
 * 10% in both signal modes.
 */
function mappedCentreM(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): number | null {
  let best: number | null = null;
  for (const link of mappedCrossings(city, source)) {
    if (!link.node || link.grade !== road.grade) continue;
    const along: number[] = [];
    for (const i of road.lanes) {
      const lane = city.lanes[i]!;
      if (!boxesMeet(link.box, laneBox(lane))) continue;
      for (const hit of polylineCrossings(link.line, lane.polyline)) {
        const s = atEnd ? lane.lengthM - hit.alongB : hit.alongB;
        if (s <= MAPPED_M && s <= lane.lengthM / 2) along.push(s);
      }
    }
    if (!along.length) continue;
    const s = along.reduce((sum, a) => sum + a, 0) / along.length;
    if (best === null || s < best) best = s;
  }
  return best;
}

const laneBoxes = new WeakMap<readonly Vec2[], Box>();
function laneBox(lane: CLane): Box {
  let box = laneBoxes.get(lane.polyline);
  if (!box) laneBoxes.set(lane.polyline, (box = boxOf(lane.polyline)));
  return box;
}

/** TASK-217 (D1): the mapped crossing ways that cross a lane centreline of the arm of a road end
 * within `MAPPED_M` of its cut, in the half of the lane nearer the node (so a crossing on a short
 * road belongs to one of its ends). */
function mappedArm(city: CompiledCity, road: CRoad, atEnd: boolean, source?: CrossingSource) {
  const links = mappedCrossings(city, source);
  if (!links.length) return [];
  const node = city.nodes[atEnd ? road.to : road.from]!;
  const arm = crossingArms(city, node).find((a) =>
    a.some((e) => e.road.idx === road.idx && e.atEnd === atEnd),
  )!;
  return links.filter((link) =>
    arm.some(
      (e) =>
        link.grade === e.road.grade &&
        e.road.lanes.some((i) => {
          const lane = city.lanes[i]!;
          // TASK-277: lines whose boxes do not meet cannot cross (Philadelphia: 4.8 s of the first
          // frame and again of the 3D build went to testing every mapped crossing against every lane).
          if (!boxesMeet(link.box, laneBox(lane))) return false;
          return polylineCrossings(link.line, lane.polyline).some((hit) => {
            const s = e.atEnd ? lane.lengthM - hit.alongB : hit.alongB;
            return s <= MAPPED_M && s <= lane.lengthM / 2;
          });
        }),
    ),
  );
}

/** TASK-217 (D1): how a road end's crossing is painted; it changes nothing else (place, span,
 * stop line, walk link). `signal`: at a signalized node the two broken lines of a signalised
 * crossing (German practice: no zebra under signals), also where a mapped crossing leads the arm
 * within `SIGNAL_NEAR_M` of a signalized node, or (TASK-257) where every painted one leading it
 * is marked with lines; `zebra`: where a mapped crossing way leads the arm (`mappedArm`), where
 * an edit turned the crossing on, and at the default crossings of roads drawn by hand; `none`: a
 * default crossing of an imported road where OSM maps none near the arm (TASK-216's D1: 155 of
 * 167 drawn crossings at the Hauptbahnhof lay over 4 m from any mapped one; a mapped city maps
 * its marked crossings), and (TASK-257) one away from a signalized node whose mapped crossings
 * all say unmarked (`marking: 'none'`), unless an edit turned it on. */
export type CrossingStyle = 'zebra' | 'signal' | 'none';
export function crossingStyle(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): CrossingStyle {
  // TASK-287: per compiled city, source and road end; the renderer asks once per lane and paint
  // (UK zig-zags, stripes, lane lines), and a city and its source are not changed once compiled.
  let bySource = styles.get(city);
  if (!bySource) styles.set(city, (bySource = new WeakMap()));
  let byRoad = bySource.get(source ?? noSource);
  if (!byRoad) bySource.set(source ?? noSource, (byRoad = new WeakMap()));
  let ends = byRoad.get(road);
  if (!ends) byRoad.set(road, (ends = []));
  return (ends[+atEnd] ??= endStyle(city, road, atEnd, source));
}
const styles = new WeakMap<CompiledCity, WeakMap<object, WeakMap<CRoad, CrossingStyle[]>>>();
const noSource = {};
function endStyle(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): CrossingStyle {
  const node = city.nodes[atEnd ? road.to : road.from]!;
  // The walk lights stand at its ends (TASK-111): a signalised crossing whatever OSM paints.
  if (node.signal !== null) return 'signal';
  const leading = mappedArm(city, road, atEnd, source);
  const painted = leading.filter((link) => link.marking !== 'none');
  const canonical = source?.roads?.[road.id];
  const edited = canonical?.crossings?.[atEnd ? 'end' : 'start'] === true;
  const unmarked = leading.length > 0 && !painted.length && !edited;
  if (painted.length) {
    if (painted.every((link) => link.marking === 'lines')) return 'signal';
    const points = crossingPlacement(city, road, atEnd, source).stripes.flat();
    const centre = points.length
      ? {
          x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
          y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
        }
      : node.pos;
    return nearSignal(city, centre) ? 'signal' : 'zebra';
  }
  if (edited) return 'zebra';
  return unmarked || canonical?.provenance.source === 'osm' ? 'none' : 'zebra';
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

const STRIPE_M = 0.45;
const STRIPE_PITCH_M = 0.9;
const CROSSING_M = 2.5;
/** TASK-091: the near edge lies this far beyond the point where the curb return meets the road
 * edge, and no stripe comes closer to a curb return. */
const CURB_CLEAR_M = 1;
/** TASK-265: at a mapped crossing a stripe keeps this far from a drawn curb return, just under
 * its 0.225 m inset from the straight kerb, so the band may run up to a curb that starts to curve,
 * as the ground zebra at Freiburg n:211 does. */
const MAPPED_CURB_CLEAR_M = 0.2;
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
 * in a lane's first half the end has no stripes and keeps TASK-072's stop. TASK-265: where OSM
 * maps a crossing node within the curb clearance of an outlined junction's end
 * (`mappedCentreM`), the band is centred on that node (no nearer than 0.25 m from the cut,
 * no move-out), so the stripes, walk link
 * (`crossingCentreM`), walker conflict zone and stop line stand where it is mapped. A node inside
 * the drawn curb returns keeps the band there, its stripes only 0.2 m clear of the curb. Where
 * that leaves no stripe, or a served signal's stop line in a lane's first half, the curb rule
 * places the band.
 */
export function crossingPlacement(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): Placement {
  const key = source?.walk?.links ?? noMapped;
  let byRoad = placements.get(key);
  if (!byRoad) placements.set(key, (byRoad = new WeakMap()));
  let cached = byRoad.get(road);
  if (!cached) byRoad.set(road, (cached = []));
  const placement = (cached[+atEnd] ??= placeCrossing(city, road, atEnd, source));
  return placement.stripes.length &&
    stopInFirstHalf(city, road, atEnd, placement.nearM, placement.farM)
    ? { ...placement, stripes: [] }
    : placement;
}

/** TASK-094: whether a served signal's stop line, 0.5 m behind a crossing whose far edge lies
 * `farM` from the cut, would fall in the first half of one of the approach's lanes. */
function stopInFirstHalf(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  nearM: number,
  farM: number,
) {
  return (
    atEnd &&
    servedSignal(city, road) &&
    road.lanes.some((i) => {
      const lane = city.lanes[i]!;
      // TASK-348: at a plain signalised crossing, half of the lane before its stripes' floor.
      const before = lane.lengthM - (city.nodes[road.to]!.outline.length ? 0 : nearM - 0.25);
      return lane.lengthM - farM - STOP_CLEAR_M < before / 2;
    })
  );
}

interface Placement {
  stripes: Vec2[][];
  nearM: number;
  farM: number;
}

/** Placements by mapped walk links and compiled road (static geometry: the default and overrides
 * do not move them). */
const placements = new WeakMap<object, WeakMap<CRoad, Placement[]>>();
const noMapped = {};

function placeCrossing(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): Placement {
  const node = city.nodes[atEnd ? road.to : road.from]!;
  // TASK-348: a signalised crossing laid out as a plain node keeps its crossing.
  if (!node.outline.length && !isSignalCrossing(node)) return { stripes: [], nearM: 0, farM: 0 };
  const arm = crossingArms(city, node).find((a) =>
    a.some((e) => e.road.idx === road.idx && e.atEnd === atEnd),
  )!;
  const lanes = road.lanes.map((index) => city.lanes[index]!);
  const curbs = junctionCorners(node).filter((c) => c.kind === 'curb' && c.curve);
  const width = lanes.reduce((sum, lane) => sum + lane.widthM, 0);
  // TASK-348: at a signalised crossing laid out as a plain node the stripes stay where its junction
  // floor (half the road plus 1 m) put them, over the mapped walkway (Freiburg n:31's stood 4.5 m
  // past them when they started at the node).
  let near = node.outline.length ? 0.25 : width / 2 + 1.25;
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
  // TASK-287: a curb return whose box lies over the clearance (and a micrometre) away passes
  // without its segments.
  const curbBoxes = curbs.map((c) => boxOf(c.curve!));
  const clearOfCurbs = (p: Vec2, clear: number) =>
    curbs.every((c, k) => {
      const box = curbBoxes[k]!;
      const dx = Math.max(box.minX - p.x, 0, p.x - box.maxX),
        dy = Math.max(box.minY - p.y, 0, p.y - box.maxY);
      return (
        dx * dx + dy * dy > (clear + 1e-6) ** 2 ||
        c.curve!.every((q, i) => i === 0 || segmentDistance(p, c.curve![i - 1]!, q) >= clear)
      );
    });
  const at = (from: number, clear = CURB_CLEAR_M) => {
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
      if (stripe.every((p) => onSurface(p) && outside(p) && clearOfCurbs(p, clear)))
        stripes.push(stripe);
    }
    return stripes;
  };
  // Keep TASK-348's crossing floor and approach storage at a plain signalised crossing.
  const mapped = node.outline.length ? mappedCentreM(city, road, atEnd, source) : null;
  const from = mapped === null ? near : Math.max(0.25, mapped - CROSSING_M / 2);
  // Only correct crossings that the curb-clearance rule would push away from the junction.
  if (from < near) {
    const stripes = at(from, MAPPED_CURB_CLEAR_M);
    if (stripes.length && !stopInFirstHalf(city, road, atEnd, from, from + CROSSING_M))
      return { stripes, nearM: from, farM: from + CROSSING_M };
  }
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
  const { stripes, nearM, farM } = crossingPlacement(city, road, atEnd, source);
  if (!stripes.length) return null;
  return atEnd ? { nearM: lane.lengthM - nearM, farM: lane.lengthM - farM } : { nearM, farM };
}

/** TASK-072's crossing, 0.25 to 2.75 m from the cut, which a served signal's stop line keeps
 * clear where its end draws no stripes (`populateStops`: lengthM - 3 on lanes of 10 m or more). */
export const UNMARKED_CENTRE_M = 1.5;

/**
 * TASK-140 (B59): where a crossing walk link crosses a road end, in metres from the cut. Where
 * the end draws stripes, the centre of the stripes, so the walk link, its walk lights at the
 * link's ends and the walker conflict zone (the link's spans) lie where the stripes are drawn,
 * with the stop line behind them; at a served signal that draws none, the centre of TASK-072's
 * crossing in front of the stop line. Null elsewhere, where an unmarked crossing keeps its own
 * position; a junction group's inner road has neither (TASK-131).
 */
export function crossingCentreM(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): number | null {
  if (road.group !== undefined) return null;
  if (crossingEnabled(city, road, atEnd, source)) {
    const { stripes, nearM, farM } = crossingPlacement(city, road, atEnd, source);
    if (stripes.length) return (nearM + farM) / 2;
  }
  return atEnd && servedSignal(city, road) && road.lanes.every((i) => city.lanes[i]!.lengthM >= 10)
    ? UNMARKED_CENTRE_M
    : null;
}

/** A road end crossed at `atM` metres from its cut. */
export interface CrossedEnd {
  road: CRoad;
  atEnd: boolean;
  atM: number;
}

/**
 * TASK-140: the line a crossing walk link follows over road ends: across each end's lanes at
 * `atM` from the cut (measured along each lane, as `crossingSpan` does), through every lane's
 * left and right edges, so the link meets each lane's centreline at `atM` in the middle of a
 * segment; the ends in order across, joined where they meet or across a median.
 */
export function crossingLine(city: CompiledCity, ends: CrossedEnd[]): Vec2[] {
  const pieces = ends.map(({ road, atEnd, atM }) => {
    const points: Vec2[] = [];
    for (const index of road.lanes) {
      const lane = city.lanes[index]!;
      const s = Math.min(lane.lengthM, Math.max(0, atEnd ? lane.lengthM - atM : atM));
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
