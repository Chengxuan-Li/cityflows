import type { Graphics } from 'pixi.js';
import {
  clipOutside,
  cumulativeLengths,
  distance,
  headingAtDistance,
  parallelOffset,
  pointAtDistance,
  pointInPolygon,
  preparePolygon,
  segmentDistance,
  segmentIntersection,
  trimPolyline,
  nearestOnPolyline,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CLane, CMovement, CNode, CompiledCity, CRoad, Turn } from '../../network';
import { junctionCorners, SETBACK_CAP_M } from '../../network/junctions';
import type { City } from '../../schema';
import { roadStyle, style } from '../style';

/** The canonical roads, which carry the crossing overrides (TASK-091). */
type CrossingSource = { roads?: City['roads'] };

const DASH_M = 2.7;
/** Gap between a crossing and the lane lines that end at it (TASK-091). */
const LINE_CLEAR_M = 0.5;
const GAP_M = 3.1;

function fadeAtZoom(graphics: Graphics, from: number, to: number) {
  graphics.onRender ??= () => {
    const zoom = graphics.parent!.worldTransform.a;
    graphics.alpha = Math.max(0, Math.min(1, (zoom - from) / (to - from)));
  };
}

export function drawRoad(
  surface: Graphics,
  markings: Graphics,
  city: CompiledCity,
  road: CRoad,
  roadClasses = false,
  controls: Graphics = markings,
  source?: CrossingSource,
): void {
  const { color, vergeM } = roadStyle(road, roadClasses);
  surface
    .poly(road.surface)
    .fill(color)
    .stroke({ color, width: vergeM * 2, join: 'round' });
  fadeAtZoom(markings, 0.7, 2.2);
  const medianOnRight = city.drivingSide === 'left';
  const tapered = road.lanes.some((i) => city.lanes[i]!.taperStartM || city.lanes[i]!.taperEndM);
  // TASK-079: a line runs to its lane's stop position. Where the junction surface covers the end
  // of the approach, that stretch is drawn above it (with the stop line); only other roads'
  // surfaces in the junction mouth clip it there.
  const junction = city.nodes[road.to]!.outline;
  const clips = [
    ...nodeClips(city, road, road.from, true),
    ...nodeClips(city, road, road.to, false),
  ];
  const draw = (lines: Vec2[][], alpha: number, belowJunction = true) => {
    const below: Vec2[][] = [],
      above: Vec2[][] = [];
    for (const line of lines)
      for (const piece of clipOutside(line, clips, 0.05)) {
        const parts = splitAtRing(piece, junction);
        if (belowJunction) below.push(...parts.outside);
        above.push(...parts.inside);
      }
    strokeLines(markings, below, alpha);
    strokeLines(controls, above, alpha);
  };
  // B46 (TASK-091): a centre line ends at the junction mouth, also where the outline reaches back
  // over the end of the approach: no centre line inside a junction polygon, and no piece shorter
  // than a dash left between two (a stub road inside a junction, Munich r:1172 at n:182).
  const centreClips = junction.length ? [...clips, junction] : clips;
  const drawCentre = (lines: Vec2[][]) =>
    strokeLines(
      markings,
      lines
        .flatMap((line) => clipOutside(line, centreClips, 0))
        .filter((piece) => cumulativeLengths(piece).at(-1)! >= DASH_M),
      0.85,
    );
  // TASK-091: lines and arrows keep behind a crossing (the far edge from the cut, 0 for none).
  const [startFarM, endFarM] = [false, true].map((atEnd) => {
    if (!crossingEnabled(city, road, atEnd, source)) return 0;
    const placement = crossingPlacement(city, road, atEnd);
    return placement.stripes.length ? placement.farM : 0;
  }) as [number, number];
  const partners =
    road.streetGroupId === null && road.corridorId !== null
      ? city.roads
          .filter((r) => r !== road && r.corridorId === road.corridorId && r.streetGroupId === null)
          .map((r) => [...r.surface, r.surface[0]!])
      : [];
  for (const index of road.lanes) {
    const lane = city.lanes[index]!;
    const along = trimPolyline(
      lane.polyline,
      startFarM && startFarM + LINE_CLEAR_M,
      Math.max(lane.lengthM - lane.stopM, endFarM && endFarM + LINE_CLEAR_M),
    );
    // On a road with a tapering lane `drawTransitions` draws the dividers, dashed from the road's
    // start and below the junction surface; here only their stretch under it, in their phase.
    if (lane.right >= 0)
      draw(dashes(parallelOffset(along, lane.widthM / 2), !tapered), 0.78, !tapered);
    if (road.streetGroupId !== null && (medianOnRight ? lane.right : lane.left) < 0)
      drawCentre([parallelOffset(along, ((medianOnRight ? 1 : -1) * lane.widthM) / 2)]);
    // TASK-089: a carriageway beside another of its corridor (a separated or side-by-side pair)
    // draws its median edge solid where that one runs within 1.5 m: two lines, a double line;
    // the strip between them is paved (no hairline of verge-less median between the lines).
    else if (partners.length && (medianOnRight ? lane.right : lane.left) < 0) {
      const runs = besidePartners(
        parallelOffset(along, ((medianOnRight ? 1 : -1) * lane.widthM) / 2),
        partners,
      );
      for (const run of runs) {
        const facing = run.map(
          (p) =>
            partners
              .map((ring) => nearestOnPolyline(ring, p))
              .reduce((a, b) => (b.away < a.away ? b : a)).point,
        );
        surface.poly([...run, ...facing.reverse()]).fill(color);
      }
      drawCentre(runs);
    }
    drawApproachMarkings(controls, city, lane, endFarM);
  }
}

/** The runs of `line` whose points lie within 1.5 m of one of the closed `rings`. */
function besidePartners(line: Vec2[], rings: Vec2[][]): Vec2[][] {
  const runs: Vec2[][] = [];
  let run: Vec2[] = [];
  for (const p of line) {
    if (rings.some((ring) => nearestOnPolyline(ring, p).away <= 1.5)) run.push(p);
    else if (run.length) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** TASK-074: a road's dividers and centre lines stay out of its nodes' outlines and out of
 * another road's surface within that road's junction mouth (its first `SETBACK_CAP_M` past its
 * cut). Roads running the same way at the node (the opposite direction of the street, a
 * coincident or overlapping carriageway) never clip each other. TASK-079: `drawRoad` draws the
 * stretch of an approach under its junction's outline above the node area instead. */
export function markingClips(city: CompiledCity, road: CRoad): Vec2[][] {
  return [road.from, road.to].flatMap((node) => nodeClips(city, road, node, true));
}

function nodeClips(city: CompiledCity, road: CRoad, node: number, withOutline: boolean) {
  const outline = city.nodes[node]!.outline;
  if (!outline.length) return [];
  const rings = withOutline ? [outline] : [];
  const own = endDirection(road, road.to === node);
  for (const other of city.roads) {
    if (other === road || (other.from !== node && other.to !== node)) continue;
    if (other.streetGroupId !== null && other.streetGroupId === road.streetGroupId) continue;
    const atEnd = other.to === node;
    const d = endDirection(other, atEnd);
    if (d.x * own.x + d.y * own.y > Math.cos(Math.PI / 6)) continue;
    rings.push(mouthPiece(other, atEnd));
  }
  return rings;
}

/** `line` cut where it crosses the closed `ring`, into the pieces inside and outside it. */
function splitAtRing(line: Vec2[], ring: Vec2[]) {
  const inside: Vec2[][] = [],
    outside: Vec2[][] = [];
  if (!ring.length) return { inside, outside: [line] };
  let current: Vec2[] = [],
    within = false;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    const ts = [0, 1];
    for (let j = 1; j < ring.length; j++) {
      const hit = segmentIntersection(a, b, ring[j - 1]!, ring[j]!);
      if (hit) ts.push(distance(a, hit) / Math.max(distance(a, b), 1e-12));
    }
    ts.sort((x, y) => x - y);
    for (let k = 1; k < ts.length; k++) {
      if (ts[k]! - ts[k - 1]! < 1e-9) continue;
      const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const side = pointInPolygon(at((ts[k - 1]! + ts[k]!) / 2), ring, 0);
      if (current.length && side !== within) {
        (within ? inside : outside).push(current);
        current = [];
      }
      within = side;
      if (!current.length) current.push(at(ts[k - 1]!));
      current.push(at(ts[k]!));
    }
  }
  if (current.length) (within ? inside : outside).push(current);
  return { inside, outside };
}

/** Dashes of a divider: anchored so the last dash ends at the line's end, or as
 * `drawTransitions` lays them, from its start. */
function dashes(line: Vec2[], fromEnd: boolean): Vec2[][] {
  const lengths = cumulativeLengths(line);
  const total = lengths.at(-1)!;
  const period = DASH_M + GAP_M;
  const result: Vec2[][] = [];
  for (let start = fromEnd ? total - DASH_M : 0; fromEnd ? start > -DASH_M : start < total;) {
    const from = Math.max(0, start),
      to = Math.min(total, start + DASH_M);
    if (to - from > 1e-6) {
      const between = line.filter((_, i) => lengths[i]! > from && lengths[i]! < to);
      result.push([
        pointAtDistance(line, lengths, from),
        ...between,
        pointAtDistance(line, lengths, to),
      ]);
    }
    start += fromEnd ? -period : period;
  }
  return result;
}

function strokeLines(graphics: Graphics, lines: Vec2[][], alpha: number): void {
  if (!lines.length) return;
  for (const line of lines) {
    graphics.moveTo(line[0]!.x, line[0]!.y);
    for (const p of line.slice(1)) graphics.lineTo(p.x, p.y);
  }
  graphics.stroke({ color: style.marking, width: style.dividerWidthM, alpha });
}

/** The surface edges of a road end, outward from the node. */
function endEdges(road: CRoad, atEnd: boolean): [Vec2[], Vec2[]] {
  const half = road.surface.length / 2;
  const left = road.surface.slice(0, half),
    right = road.surface.slice(half).reverse();
  return atEnd ? [right.reverse(), left.reverse()] : [left, right];
}

/** A road end's outward direction over its first few metres. */
function endDirection(road: CRoad, atEnd: boolean): Vec2 {
  const [left, right] = endEdges(road, atEnd);
  const ahead = (edge: Vec2[]) =>
    edge.find((p) => Math.hypot(p.x - edge[0]!.x, p.y - edge[0]!.y) >= 3) ?? edge.at(-1)!;
  const dx = (ahead(left).x + ahead(right).x - left[0]!.x - right[0]!.x) / 2,
    dy = (ahead(left).y + ahead(right).y - left[0]!.y - right[0]!.y) / 2;
  const length = Math.hypot(dx, dy);
  return { x: dx / length, y: dy / length };
}

/** A road end's surface from its cut out to `SETBACK_CAP_M`, as a closed ring. */
function mouthPiece(road: CRoad, atEnd: boolean): Vec2[] {
  const sides = endEdges(road, atEnd).map((edge) => {
    const lengths = cumulativeLengths(edge);
    const kept: Vec2[] = [edge[0]!];
    for (let i = 1; i < edge.length; i++) {
      if (lengths[i]! < SETBACK_CAP_M) {
        kept.push(edge[i]!);
        continue;
      }
      const t = (SETBACK_CAP_M - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]!);
      const a = edge[i - 1]!,
        b = edge[i]!;
      kept.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      break;
    }
    return kept;
  });
  return [...sides[0]!, ...sides[1]!.reverse(), sides[0]![0]!];
}

/** The turns a lane's arrow shows: its usable movements, without u-turns and turns into
 * service roads. */
function arrowTurns(city: CompiledCity, lane: CLane): Turn[] {
  const turns = new Set<Turn>();
  for (const index of lane.out) {
    const movement = city.movements[index]!;
    if (movement.neverGreen || movement.turn === 'uturn') continue;
    if (movement.turn === 'merge' || movement.turn === 'diverge') continue;
    if (city.roads[city.lanes[movement.toLane]!.road]!.roadClass === 'service') continue;
    turns.add(movement.turn);
  }
  return [...turns];
}

/** `crossingFarM`: the far edge of the crossing at the lane's end, from the cut (0 for none);
 * TASK-091: an arrow stays behind it. */
export function approachMarkings(city: CompiledCity, lane: CLane, crossingFarM = 0) {
  const road = city.roads[lane.road]!;
  const node = city.nodes[road.to]!;
  const legal = lane.out.map((index) => city.movements[index]!).filter((m) => !m.neverGreen);
  const minor = legal.some((movement) => movement.priority < 10);
  const controlled = legal.length > 0;
  // TASK-079: arrows only where the road's lanes differ in the turns they allow (u-turns and
  // service-road turns aside), on lanes of 12 m or more, and not on another road's surface.
  const turns = arrowTurns(city, lane);
  const key = (turns: Turn[]) => [...turns].sort().join();
  const differ = road.lanes.some(
    (index) => key(arrowTurns(city, city.lanes[index]!)) !== key(turns),
  );
  const scale = Math.min(1, lane.lengthM / 18);
  const arrowAt = Math.min(
    lane.stopM - ARROW_BEFORE_STOP_M,
    lane.lengthM - crossingFarM - ARROW_CLEAR_M - ARROW_HALF_M * scale,
  );
  return {
    stop: controlled && (node.signal !== null || (node.control === 'stop' && minor)),
    yield: controlled && node.control === 'yield' && minor,
    arrowAt,
    turns:
      differ &&
      lane.lengthM >= ARROW_MIN_LANE_M &&
      arrowAt >= ARROW_HALF_M * scale &&
      !onOtherRoad(city, lane, arrowAt)
        ? turns
        : [],
  };
}

/** Arrows are centred this far before the stop position, and need a lane this long. */
const ARROW_BEFORE_STOP_M = 7.5;
const ARROW_MIN_LANE_M = 12;
/** An arrow's half length, and the gap it keeps to a crossing in front of it (TASK-091). */
const ARROW_HALF_M = 2;
const ARROW_CLEAR_M = 0.5;

/** The arrow position lies on the surface of a road running the other way at one of this
 * road's nodes: two carriageways drawn on top of each other (B34, Munich r:368 and r:480),
 * where the arrows of both directions would share one pair of lanes. */
function onOtherRoad(city: CompiledCity, lane: CLane, at: number): boolean {
  const road = city.roads[lane.road]!;
  const point = pointAtDistance(lane.polyline, lane.cumulative, at);
  const heading = headingAtDistance(lane.polyline, lane.cumulative, at);
  const nodes = [road.from, road.to];
  return city.roads.some((other) => {
    if (other === road || !(nodes.includes(other.from) || nodes.includes(other.to))) return false;
    if (!pointInPolygon(point, [...other.surface, other.surface[0]!], 0)) return false;
    const line = city.lanes[other.lanes[0]!]!.polyline;
    let nearest = 1;
    for (let i = 2; i < line.length; i++)
      if (
        segmentDistance(point, line[i - 1]!, line[i]!) <
        segmentDistance(point, line[nearest - 1]!, line[nearest]!)
      )
        nearest = i;
    const a = line[nearest - 1]!,
      b = line[nearest]!;
    return (b.x - a.x) * Math.cos(heading) + (b.y - a.y) * Math.sin(heading) < 0;
  });
}

/** Stop and give-way lines and arrows, drawn above the node area: where the junction surface
 * covers the end of an approach they stay visible. */
function drawApproachMarkings(
  controls: Graphics,
  city: CompiledCity,
  lane: CLane,
  crossingFarM: number,
): void {
  const marks = approachMarkings(city, lane, crossingFarM);
  const local = (distance: number, forward: number, side: number) => {
    const point = pointAtDistance(lane.polyline, lane.cumulative, distance);
    const heading = headingAtDistance(lane.polyline, lane.cumulative, distance);
    return {
      x: point.x + Math.cos(heading) * forward - Math.sin(heading) * side,
      y: point.y + Math.sin(heading) * forward + Math.cos(heading) * side,
    };
  };
  const half = lane.widthM * 0.44;
  if (marks.stop) {
    controls
      .poly([local(lane.stopM, 0, -half), local(lane.stopM, 0, half)], false)
      .stroke({ color: style.marking, width: 0.28 });
  }
  if (marks.yield) {
    for (let side = -half + 0.4; side <= half - 0.2; side += 0.85) {
      controls
        .poly([
          local(lane.stopM, 0, side),
          local(lane.stopM, -1, side - 0.3),
          local(lane.stopM, -1, side + 0.3),
        ])
        .fill(style.marking);
    }
  }
  const scale = Math.min(1, lane.lengthM / 18);
  const arrowPoint = (forward: number, side: number) =>
    local(marks.arrowAt, forward * scale, side * scale);
  for (const turn of marks.turns) {
    const side = turn === 'left' ? -1 : 1;
    const points: [number, number][] =
      turn === 'through'
        ? [
            [-2, 0],
            [2, 0],
          ]
        : [
            [-2, 0],
            [0.5, 0],
            [0.5, side * 1.2],
          ];
    const tip = points.at(-1)!;
    const previous = points.at(-2)!;
    const heading = Math.atan2(tip[1] - previous[1], tip[0] - previous[0]);
    const back = 0.65;
    const shaft = points.map(([f, s]) => arrowPoint(f, s));
    const head = [
      arrowPoint(...tip),
      arrowPoint(
        tip[0] - Math.cos(heading) * back - Math.sin(heading) * 0.4,
        tip[1] - Math.sin(heading) * back + Math.cos(heading) * 0.4,
      ),
      arrowPoint(
        tip[0] - Math.cos(heading) * back + Math.sin(heading) * 0.4,
        tip[1] - Math.sin(heading) * back - Math.cos(heading) * 0.4,
      ),
    ];
    controls
      .poly(shaft, false)
      .stroke({ color: style.marking, width: 0.22 * scale, join: 'round' });
    controls.poly(head).fill(style.marking);
  }
}

export function drawMovementArrow(graphics: Graphics, movement: CMovement): void {
  fadeAtZoom(graphics, 2.2, 4.2);
  const { polyline, cumulative, lengthM } = movement;
  const start = lengthM * 0.13;
  const end = lengthM * 0.84;
  const tip = pointAtDistance(polyline, cumulative, end);
  const heading = headingAtDistance(polyline, cumulative, end);
  const root = pointAtDistance(polyline, cumulative, start);
  graphics.moveTo(root.x, root.y);
  for (let i = 1; i < polyline.length - 1; i++) {
    if (cumulative[i]! > start && cumulative[i]! < end)
      graphics.lineTo(polyline[i]!.x, polyline[i]!.y);
  }
  graphics.lineTo(tip.x, tip.y).stroke({ color: style.marking, width: 0.17, alpha: 0.56 });
  const size = Math.min(1.05, lengthM / 6);
  const dx = Math.cos(heading) * size;
  const dy = Math.sin(heading) * size;
  graphics
    .poly([
      tip.x,
      tip.y,
      tip.x - dx - dy * 0.55,
      tip.y - dy + dx * 0.55,
      tip.x - dx + dy * 0.55,
      tip.y - dy - dx * 0.55,
    ])
    .fill({ color: style.marking, alpha: 0.9 });
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

const expressway = (road: CRoad) => road.roadClass === 'motorway' || road.roadClass === 'ramp';

/** The default (architecture section 11, TASK-091): a road end at a node of three or more arms,
 * or at a signalized node, has a crossing, unless the road is a motorway or a ramp (`_link`
 * roads and slip lanes), every arm of the node is (a motorway merge or diverge), or the road is
 * part of a roundabout ring. */
export function crossingDefault(city: CompiledCity, road: CRoad, atEnd: boolean): boolean {
  const node = city.nodes[atEnd ? road.to : road.from]!;
  if (expressway(road) || cityTopology(city).ring.has(road.idx)) return false;
  const arms = crossingArms(city, node);
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
 * whether or not the end has one (`crossingStripes` asks). On an arm with a signalized approach
 * the crossing keeps TASK-072's place between the stop position and the junction (0.25 to
 * 2.75 m from the cut; the simulation stops cars at `stopM` before it). Elsewhere (TASK-091) its
 * near edge lies 1 m beyond the farthest point where a curb return of the node meets a road
 * edge of the arm, measured along each road, and no stripe comes within 1 m of a curb return.
 * Either way, TASK-089: where the outline reaches over the road the crossing moves out, all
 * stripes together, to the first place that keeps the most stripes clear (up to 6 m), except a
 * signalized approach's, which stays before the junction; and lanes shorter than the near edge
 * plus 9.75 m carry no stripes.
 */
export function crossingPlacement(city: CompiledCity, road: CRoad, atEnd: boolean): Placement {
  let cached = placements.get(road);
  if (!cached) placements.set(road, (cached = []));
  return (cached[+atEnd] ??= placeCrossing(city, road, atEnd));
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
  const signalArm = arm.some(
    (e) => e.atEnd && e.road.lanes.some((i) => city.lanes[i]!.stopM < city.lanes[i]!.lengthM),
  );
  const curbs = junctionCorners(node).filter((c) => c.kind === 'curb' && c.curve);
  let near = 0.25;
  if (!signalArm)
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
    signalArm ||
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
  const fixed = signalArm && atEnd;
  let best = { stripes: at(near), nearM: near, farM: near + CROSSING_M };
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

/** Zebra stripes of a road end's crossing, empty where it has none (`crossingEnabled`). */
export function crossingStripes(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): Vec2[][] {
  return crossingEnabled(city, road, atEnd, source)
    ? crossingPlacement(city, road, atEnd).stripes
    : [];
}

export function drawCrossings(
  graphics: Graphics,
  city: CompiledCity,
  road: CRoad,
  source?: CrossingSource,
): void {
  fadeAtZoom(graphics, 0.7, 2.2);
  for (const atEnd of [false, true])
    for (const stripe of crossingStripes(city, road, atEnd, source))
      graphics.poly(stripe).fill(style.marking);
}
