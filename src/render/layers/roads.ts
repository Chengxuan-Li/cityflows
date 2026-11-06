import type { Graphics } from 'pixi.js';
import {
  clipOutside,
  cumulativeLengths,
  distance,
  headingAtDistance,
  parallelOffset,
  pointAtDistance,
  pointInPolygon,
  segmentDistance,
  segmentIntersection,
  trimPolyline,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CLane, CMovement, CompiledCity, CRoad, Turn } from '../../network';
import { SETBACK_CAP_M } from '../../network/junctions';
import { roadStyle, style } from '../style';

const DASH_M = 2.7;
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
  for (const index of road.lanes) {
    const lane = city.lanes[index]!;
    const along = trimPolyline(lane.polyline, 0, lane.lengthM - lane.stopM);
    // On a road with a tapering lane `drawTransitions` draws the dividers, dashed from the road's
    // start and below the junction surface; here only their stretch under it, in their phase.
    if (lane.right >= 0)
      draw(dashes(parallelOffset(along, lane.widthM / 2), !tapered), 0.78, !tapered);
    if (road.streetGroupId !== null && (medianOnRight ? lane.right : lane.left) < 0)
      draw([parallelOffset(along, ((medianOnRight ? 1 : -1) * lane.widthM) / 2)], 0.85);
    drawApproachMarkings(controls, city, lane);
  }
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

export function approachMarkings(city: CompiledCity, lane: CLane) {
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
  return {
    stop: controlled && (node.signal !== null || (node.control === 'stop' && minor)),
    yield: controlled && node.control === 'yield' && minor,
    crossingEnd: controlled && node.signal !== null,
    crossingStart:
      city.nodes[road.from]!.signal !== null &&
      lane.in.some((index) => !city.movements[index]!.neverGreen),
    turns: differ && lane.lengthM >= ARROW_MIN_LANE_M && !onOtherRoad(city, lane) ? turns : [],
  };
}

/** Arrows are centred this far before the stop position, and need a lane this long. */
const ARROW_BEFORE_STOP_M = 7.5;
const ARROW_MIN_LANE_M = 12;

/** The arrow position lies on the surface of a road running the other way at one of this
 * road's nodes: two carriageways drawn on top of each other (B34, Munich r:368 and r:480),
 * where the arrows of both directions would share one pair of lanes. */
function onOtherRoad(city: CompiledCity, lane: CLane): boolean {
  const road = city.roads[lane.road]!;
  const at = lane.stopM - ARROW_BEFORE_STOP_M;
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
function drawApproachMarkings(controls: Graphics, city: CompiledCity, lane: CLane): void {
  const marks = approachMarkings(city, lane);
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
    local(lane.stopM - ARROW_BEFORE_STOP_M, forward * scale, side * scale);
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

/** Zebra stripes follow the road surface between the stop line and junction. */
export function crossingStripes(city: CompiledCity, road: CRoad, atEnd: boolean): Vec2[][] {
  const node = city.nodes[atEnd ? road.to : road.from]!;
  if (!node.signal || !node.outline.length) return [];
  const lanes = road.lanes.map((index) => city.lanes[index]!);
  const served = lanes.some((lane) => {
    const marks = approachMarkings(city, lane);
    return atEnd ? marks.crossingEnd : marks.crossingStart;
  });
  if (!served) return [];
  const width = lanes.reduce((sum, lane) => sum + lane.widthM, 0);
  const local = (along: number, side: number): Vec2 => {
    let edge = 0;
    const lane = lanes.find((lane) => {
      if (side <= edge + lane.widthM) return true;
      edge += lane.widthM;
      return false;
    })!;
    const distance = atEnd ? lane.stopM + along : along;
    const point = pointAtDistance(lane.polyline, lane.cumulative, distance);
    const heading = headingAtDistance(lane.polyline, lane.cumulative, distance);
    const offset = side - edge - lane.widthM / 2;
    return { x: point.x - Math.sin(heading) * offset, y: point.y + Math.cos(heading) * offset };
  };
  const stripes: Vec2[][] = [];
  for (let side = 0.225; side + 0.45 <= width; side += 0.9) {
    let edge = 0;
    const short = lanes.some((lane) => {
      const overlaps = side < edge + lane.widthM && side + 0.45 > edge;
      edge += lane.widthM;
      return overlaps && lane.lengthM < 10;
    });
    if (short) continue;
    const stripe = [
      local(0.25, side),
      local(2.75, side),
      local(2.75, side + 0.45),
      local(0.25, side + 0.45),
    ];
    if (
      stripe.every(
        (p) =>
          pointInPolygon(p, [...road.surface, road.surface[0]!]) &&
          !pointInPolygon(p, node.outline),
      )
    )
      stripes.push(stripe);
  }
  return stripes;
}

export function drawCrossings(graphics: Graphics, city: CompiledCity, road: CRoad): void {
  fadeAtZoom(graphics, 0.7, 2.2);
  for (const atEnd of [false, true])
    for (const stripe of crossingStripes(city, road, atEnd))
      graphics.poly(stripe).fill(style.marking);
}
