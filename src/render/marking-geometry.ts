import {
  booleanOpD,
  ClipType,
  FillRule,
  inflatePathsD,
  JoinType,
  EndType,
  areaD,
  triangulateD,
} from 'clipper2-ts';
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
  nearestOnPolyline,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CLane, CMovement, CNode, CompiledCity, CRoad, Turn } from '../network';
import {
  crossingEnabled,
  crossingPlacement,
  crossingSpan,
  endDirection,
  endEdges,
  type CrossingSource,
} from '../network/crossings';
import { SETBACK_CAP_M, junctionCorners } from '../network/junctions';
import { markingTheme, type MarkingRole, type ArrowKind } from './style';

import { defaultSlice, orderBranches } from '../network/continuity';
import { laneEdges } from '../network/lanes';

const LINE_CLEAR_M = 0.5;

export type MarkingShape = {
  gore?: PaintedGore;
  role: MarkingRole;
  points: Vec2[];
  alpha: number;
} & ({ kind: 'line'; widthM: number; dash?: readonly [number, number] } | { kind: 'polygon' });
function lineShape(road: CRoad, role: MarkingRole, points: Vec2[], alpha = 1): MarkingShape {
  return {
    kind: 'line',
    role,
    points,
    alpha,
    widthM: markingTheme.classes[road.roadClass][role].widthM,
    ...(role === 'lane' ? { dash: markingTheme.classes[road.roadClass].lane.dash } : {}),
  };
}
const fillShape = (role: MarkingRole, points: Vec2[], alpha = 1): MarkingShape => ({
  kind: 'polygon',
  role,
  points,
  alpha,
});

// Stencil glyphs in driver coordinates: top forward, B on the driver's left.
const busGlyphs = [
  ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
];
export function busLabels(city: CompiledCity, road: CRoad, source?: CrossingSource) {
  const labels: { lane: number; stationM: number; shapes: MarkingShape[] }[] = [];
  for (const index of road.lanes) {
    const lane = city.lanes[index]!;
    if (lane.allowed.length !== 1 || lane.allowed[0] !== 'bus') continue;
    const start = crossingSpan(city, lane, false, source)?.farM ?? 0;
    const end = Math.min(lane.stopM, crossingSpan(city, lane, true, source)?.farM ?? lane.lengthM);
    const length = Math.min(4, Math.max(0.2, end - start - 1));
    const first = Math.min(start + 12, (start + end) / 2);
    for (
      let stationM = first;
      stationM <= Math.max(first, end - length / 2 - 0.5);
      stationM += 50
    ) {
      const shapes: MarkingShape[] = [];
      const width = lane.widthM * 0.76,
        cell = width / 17;
      const world = (f: number, l: number) => {
        const at = Math.max(0, Math.min(lane.lengthM, stationM + f));
        const p = pointAtDistance(lane.polyline, lane.cumulative, at),
          h = headingAtDistance(lane.polyline, lane.cumulative, at);
        return { x: p.x - Math.sin(h) * l, y: p.y + Math.cos(h) * l };
      };
      busGlyphs.forEach((glyph, letter) =>
        glyph.forEach((row, y) => {
          for (let x = 0; x < 5; x++) {
            if (row[x] !== '1') continue;
            const left = -width / 2 + (letter * 6 + x) * cell;
            const top = length / 2 - (y * length) / 7;
            shapes.push(
              fillShape(
                'bus',
                [
                  world(top, left),
                  world(top, left + cell),
                  world(top - length / 7, left + cell),
                  world(top - length / 7, left),
                ],
                0.9,
              ),
            );
          }
        }),
      );
      labels.push({ lane: index, stationM, shapes });
    }
  }
  return labels;
}
export function roadMarkingGeometry(city: CompiledCity, road: CRoad, source?: CrossingSource) {
  const belowShapes: MarkingShape[] = [],
    aboveShapes: MarkingShape[] = [],
    pavement: Vec2[][] = [];
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
    belowShapes.push(...below.map((points) => lineShape(road, 'lane', points, alpha)));
    aboveShapes.push(...above.map((points) => lineShape(road, 'lane', points, alpha)));
  };
  // B46 (TASK-091): a centre line ends at the junction mouth, also where the outline reaches back
  // over the end of the approach: no centre line inside a junction polygon, and no piece shorter
  // than a dash left between two (a stub road inside a junction, Munich r:1172 at n:182).
  const centreClips = junction.length ? [...clips, junction] : clips;
  const drawCentre = (lines: Vec2[][]) =>
    belowShapes.push(
      ...lines
        .flatMap((line) => clipOutside(line, centreClips, 0))
        .filter((piece) => cumulativeLengths(piece).at(-1)! >= 2.7)
        .map((points) => lineShape(road, 'centre', points, 0.85)),
    );
  const partners =
    road.streetGroupId === null && road.corridorId !== null
      ? city.roads
          .filter((r) => r !== road && r.corridorId === road.corridorId && r.streetGroupId === null)
          .map((r) => [...r.surface, r.surface[0]!])
      : [];
  for (const index of road.lanes) {
    const lane = city.lanes[index]!;
    // TASK-091: lines and arrows keep behind a crossing; `endFarM` is its far edge from the cut.
    const startSpan = crossingSpan(city, lane, false, source);
    const endSpan = crossingSpan(city, lane, true, source);
    const endFarM = endSpan ? lane.lengthM - endSpan.farM : 0;
    const along = trimPolyline(
      lane.polyline,
      startSpan ? startSpan.farM + LINE_CLEAR_M : 0,
      Math.max(lane.lengthM - lane.stopM, endSpan ? endFarM + LINE_CLEAR_M : 0),
    );
    // On a road with a tapering lane `drawTransitions` draws the dividers, dashed from the road's
    // start and below the junction surface; here only their stretch under it, in their phase.
    if (lane.right >= 0)
      draw(
        roadDashes(
          parallelOffset(along, lane.widthM / 2),
          !tapered,
          markingTheme.classes[road.roadClass].lane.dash!,
        ),
        0.78,
        !tapered,
      );
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
        pavement.push([...run, ...facing.reverse()]);
      }
      drawCentre(runs);
    }
    aboveShapes.push(...approachShapes(city, lane, endFarM));
  }
  belowShapes.push(...busLabels(city, road, source).flatMap((label) => label.shapes));
  return { below: belowShapes, above: aboveShapes, pavement };
}

function approachShapes(city: CompiledCity, lane: CLane, crossingFarM: number): MarkingShape[] {
  const marks = approachMarkings(city, lane, crossingFarM);
  const road = city.roads[lane.road]!;
  const shapes: MarkingShape[] = [];
  const local = (at: number, forward: number, side: number) => {
    const p = pointAtDistance(lane.polyline, lane.cumulative, at),
      h = headingAtDistance(lane.polyline, lane.cumulative, at);
    return {
      x: p.x + Math.cos(h) * forward - Math.sin(h) * side,
      y: p.y + Math.sin(h) * forward + Math.cos(h) * side,
    };
  };
  const half = lane.widthM * 0.44;
  if (marks.stop)
    shapes.push(lineShape(road, 'stop', [local(lane.stopM, 0, -half), local(lane.stopM, 0, half)]));
  if (marks.yield)
    for (let side = -half + 0.4; side <= half - 0.2; side += 0.85)
      shapes.push(
        fillShape('stop', [
          local(lane.stopM, 0, side),
          local(lane.stopM, -1, side - 0.3),
          local(lane.stopM, -1, side + 0.3),
        ]),
      );
  const turns = marks.turns;
  if (turns.length) {
    const key: ArrowKind = turns.includes('through')
      ? turns.includes('left')
        ? 'through-left'
        : turns.includes('right')
          ? 'through-right'
          : 'through'
      : turns.includes('left') && turns.includes('right')
        ? 'left-right'
        : turns.includes('left')
          ? 'left'
          : 'right';
    const scale =
      (lane.speedLimitMps >= 70 / 3.6 ? markingTheme.fastArrowLengthM : markingTheme.arrowLengthM) /
      5;
    // Keep the existing centre unless the longer glyph needs more space behind the crossing.
    const at = Math.min(marks.arrowAt, lane.lengthM - crossingFarM - ARROW_CLEAR_M - 2.5 * scale);
    for (const polygon of turns.length === 3
      ? [...markingTheme.arrows.through, ...markingTheme.arrows['left-right']]
      : markingTheme.arrows[key])
      shapes.push(
        fillShape(
          'arrow',
          polygon.map((p) => local(Math.max(0, at + p.x * scale), 0, p.y)),
        ),
      );
  }
  return shapes;
}

export function movementMarkings(movement: CMovement): MarkingShape[] {
  const { polyline, cumulative, lengthM } = movement;
  const start = lengthM * 0.13,
    end = lengthM * 0.84;
  const line = trimPolyline(polyline, start, lengthM - end);
  const tip = pointAtDistance(polyline, cumulative, end),
    h = headingAtDistance(polyline, cumulative, end);
  const glyph = markingTheme.movementArrow;
  const size = Math.min(glyph.maxSizeM, lengthM / glyph.lengthDivisor);
  return [
    { kind: 'line', role: 'arrow', points: line, widthM: glyph.widthM, alpha: 0.56 },
    fillShape(
      'arrow',
      glyph.head.map((p) => ({
        x: tip.x + size * (Math.cos(h) * p.x - Math.sin(h) * p.y),
        y: tip.y + size * (Math.sin(h) * p.x + Math.cos(h) * p.y),
      })),
      0.9,
    ),
  ];
}

/** World-space paint footprints, shared by the 3D mesh and containment audits. */
export function markingPolygons(shape: MarkingShape): Vec2[][] {
  if (shape.kind === 'polygon') return [shape.points];
  const left = parallelOffset(shape.points, -shape.widthM / 2),
    right = parallelOffset(shape.points, shape.widthM / 2);
  return left.slice(1).map((p, i) => [left[i]!, p, right[i + 1]!, right[i]!]);
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
function roadDashes(line: Vec2[], fromEnd: boolean, pattern: readonly [number, number]): Vec2[][] {
  const lengths = cumulativeLengths(line);
  const total = lengths.at(-1)!;
  const [DASH_M, GAP_M] = pattern;
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

export interface Guide {
  kind: 'divider' | 'centre' | 'edge';
  line: Vec2[];
  dashes: Vec2[][];
  /** A split junction's divider (TASK-088): the two lined-up movements it runs between. */
  between?: [CMovement, CMovement];
}

const SAMPLE_M = 0.5;
const PARALLEL = Math.cos(Math.PI / 6);

/**
 * The through groups of a node's major road (architecture section 11, TASK-075), one group
 * per approach, each sorted from the median to the curb. Empty when the node is signalized,
 * has no outline, or no approach's through movements outrank every movement of the others.
 */
export function majorThroughs(city: CompiledCity, node: CNode): CMovement[][] {
  if (node.control === 'signal' || !node.outline.length) return [];
  const movements = node.movements.map((i) => city.movements[i]!).filter((m) => !m.neverGreen);
  const roadOf = (m: CMovement) => city.lanes[m.fromLane]!.road;
  const throughs = movements.filter((m) => m.turn === 'through');
  if (!throughs.length) return [];
  const top = Math.max(...throughs.map((m) => m.priority));
  const approaches = [...new Set(throughs.filter((m) => m.priority === top).map(roadOf))].sort(
    (a, b) => a - b,
  );
  if (
    approaches.length > 2 ||
    movements.some((m) => !approaches.includes(roadOf(m)) && m.priority >= top)
  )
    return [];
  const key = (lane: number) => (city.drivingSide === 'right' ? 1 : -1) * city.lanes[lane]!.lane;
  const groups = approaches.map((road) =>
    throughs
      .filter((m) => roadOf(m) === road)
      .sort((a, b) => key(a.fromLane) - key(b.fromLane) || key(a.toLane) - key(b.toLane)),
  );
  // Two groups must be the two directions of one road, side by side: the other direction's
  // innermost path starts on the median side of this one's (imported carriageways with
  // coincident centerlines overlap instead). A lone group must be a one-way road, so no
  // other approach arrives against the direction it leaves in.
  const inner = groups[0]![0]!;
  const exit = endHeading(inner.polyline);
  const major =
    groups.length === 2
      ? opposed(exit, startHeading(groups[1]![0]!.polyline)) &&
        medianOffset(city, inner, groups[1]![0]!.polyline[0]!) >=
          (city.lanes[inner.toLane]!.widthM + city.lanes[groups[1]![0]!.fromLane]!.widthM) / 4
      : !city.roads.some(
          (road) =>
            road.to === node.idx &&
            road.idx !== approaches[0] &&
            opposed(exit, endHeading(city.lanes[road.lanes[0]!]!.polyline)),
        );
  return major ? groups : [];
}

const startHeading = (line: Vec2[]) => Math.atan2(line[1]!.y - line[0]!.y, line[1]!.x - line[0]!.x);
const endHeading = (line: Vec2[]) =>
  Math.atan2(line.at(-1)!.y - line.at(-2)!.y, line.at(-1)!.x - line.at(-2)!.x);
const opposed = (a: number, b: number) => Math.cos(a - b) <= -PARALLEL;

/** How far `point` lies to the median side of the end of `m`. */
function medianOffset(city: CompiledCity, m: CMovement, point: Vec2) {
  const end = m.polyline.at(-1)!;
  const heading = endHeading(m.polyline);
  const right = (point.x - end.x) * -Math.sin(heading) + (point.y - end.y) * Math.cos(heading);
  return city.drivingSide === 'right' ? -right : right;
}

function samples(m: CMovement) {
  const count = Math.max(1, Math.ceil(m.lengthM / SAMPLE_M));
  return Array.from({ length: count + 1 }, (_, i) => {
    const s = (m.lengthM * i) / count;
    return {
      s,
      point: pointAtDistance(m.polyline, m.cumulative, s),
      heading: headingAtDistance(m.polyline, m.cumulative, s),
    };
  });
}

function nearest(point: Vec2, line: Vec2[]) {
  let best = { point: line[0]!, heading: 0, distance: Infinity };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    if (!length2) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = Math.hypot(point.x - q.x, point.y - q.y);
    if (distance < best.distance) best = { point: q, heading: Math.atan2(dy, dx), distance };
  }
  return best;
}

/** Runs of midpoints between two paths, kept where they are within 30 degrees of parallel
 * (anti-parallel when `opposite`). Given `apart` (two paths that start and end side by side), only
 * where they are no farther apart, and the first and last midpoints are those of their ends. */
function midway(a: CMovement, b: CMovement, opposite: boolean, apart?: number): Vec2[][] {
  const runs: Vec2[][] = [[]];
  const all = samples(a);
  for (const [i, { point, heading }] of all.entries()) {
    const q = nearest(point, b.polyline);
    if (apart !== undefined && (i === 0 || i === all.length - 1))
      q.point = i ? b.polyline.at(-1)! : b.polyline[0]!;
    if (
      Math.cos(heading - q.heading) * (opposite ? -1 : 1) >= PARALLEL &&
      q.distance <= (apart ?? Infinity)
    )
      runs.at(-1)!.push({ x: (point.x + q.point.x) / 2, y: (point.y + q.point.y) / 2 });
    else if (runs.at(-1)!.length) runs.push([]);
  }
  return runs.filter((run) => run.length > 1);
}

/** The edge of a path on `side` (1 right, -1 left), its width blending from the entry to the
 * exit lane. */
function edge(city: CompiledCity, m: CMovement, side: number): Vec2[] {
  const from = city.lanes[m.fromLane]!.widthM;
  const to = city.lanes[m.toLane]!.widthM;
  return samples(m).map(({ s, point, heading }) => {
    const offset = (side * (from + ((to - from) * s) / m.lengthM)) / 2;
    return { x: point.x - Math.sin(heading) * offset, y: point.y + Math.cos(heading) * offset };
  });
}

/** True when a road outside the major road meets the node on `side` of `m`. */
function mouth(city: CompiledCity, node: CNode, m: CMovement, major: Set<number>, side: number) {
  const a = m.polyline[0]!;
  const b = m.polyline.at(-1)!;
  return city.roads.some((road) => {
    if (major.has(road.idx) || (road.from !== node.idx && road.to !== node.idx)) return false;
    const ends = [road.lanes[0]!, road.lanes.at(-1)!].map((i) => {
      const line = city.lanes[i]!.polyline;
      return road.to === node.idx ? line.at(-1)! : line[0]!;
    });
    const p = { x: (ends[0]!.x + ends[1]!.x) / 2, y: (ends[0]!.y + ends[1]!.y) / 2 };
    return side * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) > 0;
  });
}

function guideDashes(line: Vec2[]): Vec2[][] {
  const total = cumulativeLengths(line).at(-1)!;
  const period = markingTheme.guide.dash![0] + markingTheme.guide.dash![1];
  const count = Math.floor((total + markingTheme.guide.dash![1]) / period);
  const start = (total - count * period + markingTheme.guide.dash![1]) / 2;
  return Array.from({ length: count }, (_, i) =>
    trimPolyline(
      line,
      start + i * period,
      total - start - i * period - markingTheme.guide.dash![0],
    ),
  );
}

const continuing = (m: CMovement) =>
  m.turn === 'through' || m.turn === 'merge' || m.turn === 'diverge';

/**
 * TASK-085's lined-up movements at a split junction, or null when the node is none: a split,
 * merge, narrowing or widening as TASK-071 classifies it (uncontrolled, every movement through,
 * merge or diverge, every road end within 30 degrees of one axis) that keeps a junction polygon.
 * The pairs are TASK-071's default slice (`continuity.ts`), the branches ordered by the headings
 * of their reference lines at the node, as `generateMovements` orders them by their centerlines.
 */
export function splitLinedUp(city: CompiledCity, node: CNode): CMovement[] | null {
  if (node.control !== 'uncontrolled' || !node.outline.length || !node.movements.length)
    return null;
  if (node.movements.some((i) => !continuing(city.movements[i]!))) return null;
  const headings: { start: number; end: number }[] = [];
  const ends = city.roads.flatMap((road) => {
    if (road.from !== node.idx && road.to !== node.idx) return [];
    const line = road.reference;
    headings[road.idx] = { start: startHeading(line), end: endHeading(line) };
    return [
      ...(road.to === node.idx ? [{ road, entering: true, heading: headings[road.idx]!.end }] : []),
      ...(road.from === node.idx
        ? [{ road, entering: false, heading: headings[road.idx]!.start }]
        : []),
    ];
  });
  if (ends.some((end) => Math.abs(Math.cos(end.heading - ends[0]!.heading)) < PARALLEL - 1e-9))
    return null;
  const lined: CMovement[] = [];
  let axis: number | undefined;
  for (const forward of [true, false]) {
    const group = ends.filter((end) => Math.cos(end.heading - ends[0]!.heading) > 0 === forward);
    const into = group.filter((end) => end.entering).map((end) => end.road);
    const out = group.filter((end) => !end.entering).map((end) => end.road);
    if (!into.length || !out.length || (into.length > 1 && out.length > 1)) continue;
    const split =
      into.length === 1 && (out.length > 1 || into[0]!.lanes.length >= out[0]!.lanes.length);
    const trunk = (split ? into : out)[0]!;
    const trunkHeading = headings[trunk.idx]![split ? 'end' : 'start'];
    axis ??= trunkHeading;
    const heading = axis + (Math.cos(trunkHeading - axis) < 0 ? Math.PI : 0);
    const ordered = orderBranches(split ? out : into, headings, heading, split);
    let cursor = 0;
    for (const [position, branch] of ordered.entries()) {
      const slice = defaultSlice(
        trunk.lanes.length,
        ordered.map((road) => road.lanes.length),
        position,
        cursor,
        city.drivingSide,
      );
      if (slice.length) cursor = slice.at(-1)![0] + 1;
      for (const [t, b] of slice) {
        const from = city.lanes[(split ? trunk : branch).lanes[split ? t : b]!]!;
        const to = (split ? branch : trunk).lanes[split ? b : t]!;
        const movement = from.out.map((i) => city.movements[i]!).find((m) => m.toLane === to);
        if (movement) lined.push(movement);
      }
    }
  }
  return lined;
}

/** How far two neighbouring paths may be from a lane width apart and still run side by side. */
const SIDE_BY_SIDE_M = 0.2;

/** TASK-088 (B44): the dividers across a split junction, between neighbouring lined-up
 * movements: two that leave and arrive side by side on the same side, a lane width apart (within
 * `SIDE_BY_SIDE_M`), in different lanes. The divider runs midway between them except where they
 * part by more than a lane width (a gore); paths into branches of different headings may pinch
 * closer in between (0.6 m at Munich n:312) and keep it. Paths converging into one lane get none.
 * Every road draws its lane dividers dashed, so these are dashed too. */
function splitDividers(city: CompiledCity, lined: CMovement[]): Omit<Guide, 'dashes'>[] {
  /** How far `to` lies to the right of `from`, across lane `index` at its node end. */
  const lateral = (from: Vec2, index: number, atEnd: boolean, to: Vec2) => {
    const lane = city.lanes[index]!;
    const h = headingAtDistance(lane.polyline, lane.cumulative, atEnd ? lane.lengthM : 0);
    return -(to.x - from.x) * Math.sin(h) + (to.y - from.y) * Math.cos(h);
  };
  const width = (a: number, b: number) => (city.lanes[a]!.widthM + city.lanes[b]!.widthM) / 2;
  const lines: Omit<Guide, 'dashes'>[] = [];
  for (const [i, a] of lined.entries())
    for (const b of lined.slice(i + 1)) {
      if (a.fromLane === b.fromLane || a.toLane === b.toLane) continue;
      const start = lateral(a.polyline[0]!, a.fromLane, true, b.polyline[0]!);
      const end = lateral(a.polyline.at(-1)!, a.toLane, false, b.polyline.at(-1)!);
      if (
        Math.sign(start) !== Math.sign(end) ||
        Math.abs(Math.abs(start) - width(a.fromLane, b.fromLane)) > SIDE_BY_SIDE_M ||
        Math.abs(Math.abs(end) - width(a.toLane, b.toLane)) > SIDE_BY_SIDE_M
      )
        continue;
      const apart = Math.max(width(a.fromLane, b.fromLane), width(a.toLane, b.toLane));
      for (const line of midway(a, b, false, apart + SIDE_BY_SIDE_M))
        lines.push({ kind: 'divider', line, between: [a, b] });
    }
  return lines;
}

export function junctionGuides(city: CompiledCity, node: CNode): Guide[] {
  const lined = splitLinedUp(city, node);
  const groups = majorThroughs(city, node);
  if (!groups.length && !lined) return [];
  const lines = lined ? splitDividers(city, lined) : [];
  const major = new Set(
    groups.flat().flatMap((m) => [city.lanes[m.fromLane]!.road, city.lanes[m.toLane]!.road]),
  );
  const curb = city.drivingSide === 'right' ? 1 : -1;
  for (const group of groups) {
    // At a split junction the dividers are the lined-up movements' (above).
    for (let i = 1; i < group.length && !lined; i++) {
      const [a, b] = [group[i - 1]!, group[i]!];
      if (a.fromLane === b.fromLane || a.toLane === b.toLane) continue;
      for (const line of midway(a, b, false)) lines.push({ kind: 'divider', line });
    }
    const outer = group.at(-1)!;
    if (mouth(city, node, outer, major, curb))
      lines.push({ kind: 'edge', line: edge(city, outer, curb) });
  }
  // A one-way road has a curb on its median side too.
  const inner = groups[0]?.[0];
  if (inner && groups.length === 1 && mouth(city, node, inner, major, -curb))
    lines.push({ kind: 'edge', line: edge(city, inner, -curb) });
  if (groups.length === 2)
    for (const line of midway(groups[0]![0]!, groups[1]![0]!, true))
      lines.push({ kind: 'centre', line });
  // The junction outline may stop short of a capped road end (TASK-074); keep only the parts
  // of each dash that lie on the junction or on one of its roads.
  const rings = [
    node.outline,
    ...city.roads
      .filter((road) => road.from === node.idx || road.to === node.idx)
      .map((road) => road.surface),
  ]
    .filter((ring) => ring.length > 2)
    .map((ring) => [...ring, ring[0]!]);
  const inside = (p: Vec2) => rings.some((ring) => pointInPolygon(p, ring, 0.05));
  return lines.map((guide) => ({
    ...guide,
    dashes: guideDashes(guide.line).flatMap((dash) => keepInside(dash, inside)),
  }));
}

/** The runs of a dash whose sampled points all lie inside; runs under 0.5 m are dropped. */
function keepInside(dash: Vec2[], inside: (p: Vec2) => boolean): Vec2[][] {
  if (dash.every(inside)) return [dash];
  const cumulative = cumulativeLengths(dash);
  const total = cumulative.at(-1)!;
  const step = 0.1;
  const runs: Vec2[][] = [];
  let run: Vec2[] = [];
  for (let s = 0; s <= total + 1e-9; s += step) {
    const p = pointAtDistance(dash, cumulative, Math.min(s, total));
    if (inside(p)) run.push(p);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 1 && (r.length - 1) * step >= 0.5);
}

export function transitionGeometry(city: CompiledCity, road: CRoad) {
  const roadLanes = road.lanes.map((i) => city.lanes[i]!);
  const lanes = roadLanes.map((lane) => {
    const edges = laneEdges(lane, roadLanes);
    return { lane: lane.idx, ...edges };
  });
  // Dividers run to the lane's stop position, like every other road's (TASK-079), on the lane
  // edges, which keep their offset through curves (TASK-082).
  const dividers = roadLanes.slice(0, -1).map((lane, i) => toStop(lane, lanes[i]!.right));
  return { lanes, dividers };
}

/** The part of one of a lane's edges up to the lane's stop position. */
function toStop(lane: CLane, edge: Vec2[]): Vec2[] {
  const total = cumulativeLengths(edge).at(-1)!;
  return trimPolyline(edge, 0, total * (1 - lane.stopM / lane.lengthM));
}

const laneOfSegment = new WeakMap<CompiledCity, Int32Array>();

/** The lane each `laneSpatial` segment ordinal belongs to. */
function segmentLanes(city: CompiledCity): Int32Array {
  let lanes = laneOfSegment.get(city);
  if (lanes) return lanes;
  lanes = new Int32Array(city.lanes.reduce((sum, l) => sum + l.polyline.length - 1, 0));
  let k = 0;
  for (const lane of city.lanes)
    for (let i = 1; i < lane.polyline.length; i++) lanes[k++] = lane.idx;
  laneOfSegment.set(city, lanes);
  return lanes;
}

function lineDistance(p: Vec2, line: Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

const seamCache = new WeakMap<CompiledCity, Map<number, Vec2[][]>>();

/** TASK-080: where a road's lanes run side by side with another road's in the same direction
 * (the branches of a split or merge drawn as one block, at a continuation or not), the seams
 * between the two along this road's right edge, up to where they part. */
export function seams(city: CompiledCity, road: CRoad): Vec2[][] {
  let cached = seamCache.get(city);
  if (!cached) seamCache.set(city, (cached = new Map()));
  const hit = cached.get(road.idx);
  if (hit) return hit;
  const roadLanes = road.lanes.map((i) => city.lanes[i]!);
  const edge = toStop(roadLanes.at(-1)!, laneEdges(roadLanes.at(-1)!, roadLanes).right);
  const lengths = cumulativeLengths(edge);
  const owner = segmentLanes(city);
  const candidates = new Set<number>();
  for (let s = 0; ; s = Math.min(lengths.at(-1)!, s + 4)) {
    const p = pointAtDistance(edge, lengths, s);
    for (const k of city.laneSpatial.search(p.x - 3, p.y - 3, p.x + 3, p.y + 3)) {
      const lane = city.lanes[owner[k]!]!;
      if (lane.road !== road.idx && lane.left < 0) candidates.add(lane.idx);
    }
    if (s === lengths.at(-1)!) break;
  }
  const found: Vec2[][] = [];
  for (const index of candidates) {
    const lane = city.lanes[index]!;
    const other = city.roads[lane.road]!;
    const left = laneEdges(
      lane,
      other.lanes.map((i) => city.lanes[i]!),
    ).left;
    let run: Vec2[] = [];
    const close = () => {
      if (run.length > 1 && cumulativeLengths(run).at(-1)! >= 1 && sameWay(run, left))
        found.push(run);
      run = [];
    };
    for (const q of edge) {
      const d = lineDistance(q, left);
      if (d <= (run.length ? 0.25 : 0.1)) run.push(q);
      else close();
    }
    close();
  }
  cached.set(road.idx, found);
  return found;
}

/** The run of this road's right edge heads the same way as the neighbour's left edge. */
function sameWay(run: Vec2[], left: Vec2[]): boolean {
  const a = run[0]!,
    b = run[1]!;
  let closest = 1;
  for (let i = 2; i < left.length; i++)
    if (
      lineDistance(a, [left[i - 1]!, left[i]!]) <
      lineDistance(a, [left[closest - 1]!, left[closest]!])
    )
      closest = i;
  const c = left[closest - 1]!,
    d = left[closest]!;
  return (b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y) > 0;
}

const highway = (road: CRoad) => ['motorway', 'trunk', 'ramp'].includes(road.roadClass);
const intersect = (subject: Vec2[][], clip: Vec2[][]) =>
  booleanOpD(ClipType.Intersection, subject, clip, FillRule.NonZero, 3);
const subtract = (subject: Vec2[][], clip: Vec2[][]) =>
  booleanOpD(ClipType.Difference, subject, clip, FillRule.NonZero, 3);
const offsetRings = (rings: Vec2[][], delta: number) =>
  inflatePathsD(rings, delta, JoinType.Miter, EndType.Polygon, 2, 3);
const unionRings = (rings: Vec2[][]) =>
  booleanOpD(ClipType.Union, rings, null, FillRule.NonZero, 3);
function protectedLanes(city: CompiledCity, roads: CRoad[], node: CNode): Vec2[][] {
  return [
    ...roads.flatMap((road) => {
      const lanes = road.lanes.map((i) => city.lanes[i]!);
      return lanes.map((lane) => {
        const e = laneEdges(lane, lanes);
        return [...e.left, ...e.right.reverse()];
      });
    }),
    ...node.movements.flatMap((i) => {
      const m = city.movements[i]!;
      return inflatePathsD(
        [m.polyline],
        Math.min(city.lanes[m.fromLane]!.widthM, city.lanes[m.toLane]!.widthM) / 2,
        JoinType.Miter,
        EndType.Butt,
        2,
        3,
      );
    }),
  ];
}

/** Preserve boolean holes when turning compound regions into fillable paint polygons. */
function filledParts(rings: Vec2[][]): Vec2[][] {
  if (!rings.some((r) => areaD(r) < -0.000001)) return rings.filter((r) => areaD(r) > 0.000001);
  const result = triangulateD(rings, 3);
  if (result.result !== 0) throw new Error('Cannot triangulate marking region');
  return result.solution;
}

const laneMarginCache = new WeakMap<CompiledCity, number>();
/** Include complete lane edges in the centreline index's broadphase, including mitred joins. */
function laneSurfaceMargin(city: CompiledCity): number {
  const hit = laneMarginCache.get(city);
  if (hit !== undefined) return hit;
  let margin = 0.15;
  for (const road of city.roads) {
    const lanes = road.lanes.map((i) => city.lanes[i]!);
    for (const lane of lanes) {
      const edges = laneEdges(lane, lanes);
      for (let i = 0; i < lane.polyline.length; i++)
        margin = Math.max(
          margin,
          distance(lane.polyline[i]!, edges.left[i]!),
          distance(lane.polyline[i]!, edges.right[i]!),
        );
    }
  }
  laneMarginCache.set(city, margin);
  return margin;
}

/** Clip paint at every nearby lane centre, including source roads crossing a taper. */
function clearCentrelines(city: CompiledCity, rings: Vec2[][], fullLanes = false): Vec2[][] {
  if (!rings.length) return rings;
  const points = rings.flat(),
    xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const owner = segmentLanes(city);
  const padding = fullLanes ? laneSurfaceMargin(city) : 0.15;
  const lanes = new Set(
    city.laneSpatial
      .search(
        Math.min(...xs) - padding,
        Math.min(...ys) - padding,
        Math.max(...xs) + padding,
        Math.max(...ys) + padding,
      )
      .map((i) => owner[i]!),
  );
  return subtract(
    rings,
    [...lanes].flatMap((i) => {
      const lane = city.lanes[i]!;
      if (!fullLanes)
        return inflatePathsD([lane.polyline], 0.15, JoinType.Miter, EndType.Butt, 2, 3);
      const e = laneEdges(
        lane,
        city.roads[lane.road]!.lanes.map((k) => city.lanes[k]!),
      );
      return [[...e.left, ...e.right.reverse()]];
    }),
  );
}

/** Chevrons have their apex upstream: in traffic coordinates f = station + |lateral|.
 * Clip filled bands, not just their centre lines, so even the stripe ends stay in the gore. */
export function hatchGeometry(
  ring: Vec2[],
  heading: number,
  road: CRoad,
  holes: Vec2[][] = [],
): MarkingShape[] {
  const region = [ring, ...holes];
  const width = markingTheme.classes[road.roadClass].channel.widthM;
  const inside = offsetRings(region, -width);
  const shapes: MarkingShape[] = [];
  for (const boundary of region)
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i]!,
        b = boundary[(i + 1) % boundary.length]!;
      const length = distance(a, b);
      if (length < 1e-6) continue;
      const normal = { x: (-(b.y - a.y) / length) * width, y: ((b.x - a.x) / length) * width };
      const strip = [
        a,
        b,
        { x: b.x + normal.x, y: b.y + normal.y },
        { x: a.x + normal.x, y: a.y + normal.y },
      ];
      for (const part of filledParts(intersect([strip], region)))
        shapes.push(fillShape('channel', part));
    }
  if (!inside.length) return shapes;
  const origin = ring[0]!,
    cos = Math.cos(heading),
    sin = Math.sin(heading);
  const local = (p: Vec2) => ({
    x: (p.x - origin.x) * cos + (p.y - origin.y) * sin,
    y: -(p.x - origin.x) * sin + (p.y - origin.y) * cos,
  });
  const world = (f: number, l: number) => ({
    x: origin.x + cos * f - sin * l,
    y: origin.y + sin * f + cos * l,
  });
  const points = ring.map(local);
  const mid = (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2;
  const span = Math.max(...points.map((p) => Math.abs(p.y - mid))) + 1;
  const lo = Math.min(...points.map((p) => p.x)) - span,
    hi = Math.max(...points.map((p) => p.x));
  const spacing = highway(road)
    ? markingTheme.hatch.highwaySpacingM
    : markingTheme.hatch.townSpacingM;
  const half = markingTheme.hatch.widthM / Math.SQRT2;
  for (let f = Math.floor(lo / spacing) * spacing; f <= hi; f += spacing)
    for (const side of [-1, 1]) {
      const band = [
        world(f - half, mid),
        world(f + span - half, mid + side * span),
        world(f + span + half, mid + side * span),
        world(f + half, mid),
      ];
      for (const part of filledParts(intersect([band], inside)))
        if (Math.abs(areaD(part)) > 0.01) shapes.push(fillShape('hatch', part));
    }
  return shapes;
}

export interface GoreSurface {
  roads: [number, number];
  edgeRoads: [number[], number[]];
  edges: [Vec2[], Vec2[]];
}
export interface PaintedGore {
  ring: Vec2[];
  holes: Vec2[][];
  heading: number;
  road: CRoad;
  surface: GoreSurface;
}
/** OSM can split a branch's boundary into tiny continuation roads before its physical nose. */
function branchEdges(city: CompiledCity, road: CRoad, atEnd: boolean) {
  const edges = endEdges(road, atEnd),
    roads = [road.idx];
  let current = road;
  while (cumulativeLengths(edges[0]).at(-1)! < 150) {
    const node = atEnd ? current.from : current.to;
    const edge = edges[0],
      a = edge.at(-2)!,
      b = edge.at(-1)!,
      length = distance(a, b);
    const next = city.roads
      .filter(
        (r) =>
          !roads.includes(r.idx) &&
          r.roadClass === road.roadClass &&
          (atEnd ? r.to : r.from) === node,
      )
      .map((r) => {
        const d = endDirection(r, atEnd);
        return { road: r, alignment: ((b.x - a.x) * d.x + (b.y - a.y) * d.y) / length };
      })
      .filter((r) => r.alignment > PARALLEL)
      .sort((a, b) => b.alignment - a.alignment || a.road.idx - b.road.idx)[0]?.road;
    if (!next) break;
    const continuation = endEdges(next, atEnd);
    edges[0].push(...continuation[0]);
    edges[1].push(...continuation[1]);
    roads.push(next.idx);
    current = next;
  }
  return { edges, roads };
}

const goreCache = new WeakMap<CompiledCity, Map<number, PaintedGore[]>>();
/** Paintable space between actual branch edges. Renderer-only pavement is authorized for
 * continuation nodes lacking a junction surface; lane and movement geometry stays frozen. */
export function paintedGores(city: CompiledCity, node: CNode): PaintedGore[] {
  let cached = goreCache.get(city);
  if (!cached) goreCache.set(city, (cached = new Map()));
  const hit = cached.get(node.idx);
  if (hit) return hit;
  const roads = city.roads.filter((r) => r.from === node.idx || r.to === node.idx);
  const corners = junctionCorners(node);
  const split =
    node.control === 'uncontrolled' &&
    node.movements.length > 0 &&
    node.movements.every((i) => continuing(city.movements[i]!));
  const candidates: { ring: Vec2[]; road: CRoad; surface: GoreSurface }[] = [];
  for (const ramp of roads.filter((r) => r.roadClass === 'ramp'))
    for (const main of roads) {
      if (
        main.roadClass === 'ramp' ||
        main.lanes.length < 2 ||
        (main.to === node.idx) !== (ramp.to === node.idx)
      )
        continue;
      const corner = corners.find(
        (c) => c.kind === 'gore' && c.roads.includes(ramp.idx) && c.roads.includes(main.idx),
      );
      if (!split && !corner) continue;
      const rampBranch = branchEdges(city, ramp, ramp.to === node.idx),
        mainBranch = branchEdges(city, main, main.to === node.idx);
      const rampEdges = rampBranch.edges,
        mainEdges = mainBranch.edges;
      const mid = (edges: [Vec2[], Vec2[]], s: number) => {
        const points = edges.map((e) => pointAtDistance(e, cumulativeLengths(e), s));
        return { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 };
      };
      const r = mid(rampEdges, 60),
        m = mid(mainEdges, 60),
        direction = endDirection(main, main.to === node.idx);
      const right = (r.x - m.x) * -direction.y + (r.y - m.y) * direction.x > 0;
      const a = rampEdges[right ? 0 : 1],
        b = mainEdges[right ? 1 : 0];
      const surface: GoreSurface = {
        roads: [ramp.idx, main.idx],
        edgeRoads: [rampBranch.roads, mainBranch.roads],
        edges: [a, b],
      };
      if (corner) candidates.push({ ring: corner.ring, road: main, surface });
      // A fillet is a raised physical nose: do not pave or hatch beyond it.
      if (corner?.fillet) continue;
      const lengths = cumulativeLengths(a),
        otherLengths = cumulativeLengths(b);
      const limit = Math.min(lengths.at(-1)!, otherLengths.at(-1)!);
      const noseWidth = city.lanes[main.lanes[0]!]!.widthM;
      let endA = limit;
      for (let along = 0.5; along <= limit; along += 0.5) {
        const point = pointAtDistance(a, lengths, along);
        if (
          nearestOnPolyline(b, point).away >= noseWidth &&
          !pointInPolygon(point, [...main.surface, main.surface[0]!], 0)
        ) {
          endA = along;
          break;
        }
      }
      const endB = nearestOnPolyline(b, pointAtDistance(a, lengths, endA)).along;
      const near = (edge: Vec2[], to: number) =>
        trimPolyline(edge, 0, cumulativeLengths(edge).at(-1)! - to);
      candidates.push({
        ring: [...near(a, endA), ...near(b, endB).reverse()],
        road: main,
        surface,
      });
    }
  const result: PaintedGore[] = [],
    used: Vec2[][] = [];
  if (candidates.length) {
    const exclusions = unionRings(protectedLanes(city, roads, node));
    for (const candidate of candidates) {
      const lane = city.lanes[candidate.road.lanes[0]!]!;
      const heading = headingAtDistance(
        lane.polyline,
        lane.cumulative,
        candidate.road.to === node.idx ? lane.lengthM : 0,
      );
      let rings = clearCentrelines(city, subtract(unionRings([candidate.ring]), exclusions), true);
      if (used.length) rings = subtract(rings, used);
      const lineWidth = markingTheme.classes[candidate.road.roadClass].channel.widthM;
      rings = intersect(offsetRings(offsetRings(rings, -lineWidth / 2), lineWidth / 2), rings);
      for (const ring of rings.filter((r) => areaD(r) > 0.15)) {
        const holes = rings.filter(
          (r) => areaD(r) < 0 && pointInPolygon(r[0]!, [...ring, ring[0]!], 0),
        );
        result.push({ ring, holes, heading, road: candidate.road, surface: candidate.surface });
        used.push(ring, ...holes);
      }
    }
  }
  cached.set(node.idx, result);
  return result;
}

export function gorePavement(city: CompiledCity, road: CRoad): Vec2[][] {
  return [road.from, road.to].flatMap((i) =>
    paintedGores(city, city.nodes[i]!)
      .filter((g) => g.road.idx === road.idx)
      .flatMap((g) => filledParts([g.ring, ...g.holes])),
  );
}

export function nodeMarkingGeometry(city: CompiledCity, node: CNode): MarkingShape[] {
  const guides = junctionGuides(city, node).flatMap((g) =>
    g.dashes.map((points) => ({
      kind: 'line' as const,
      role: g.kind === 'divider' ? ('lane' as const) : g.kind,
      points,
      alpha: 0.78,
      widthM: markingTheme.guide.widthM,
      dash: markingTheme.guide.dash,
    })),
  );
  return [
    ...guides,
    ...paintedGores(city, node).flatMap((g) =>
      hatchGeometry(g.ring, g.heading, g.road, g.holes).map((shape) => ({
        ...shape,
        gore: g,
      })),
    ),
  ];
}

export function transitionMarkings(city: CompiledCity, road: CRoad): MarkingShape[] {
  const pattern = markingTheme.classes[road.roadClass].lane.dash!;
  const shapes = seams(city, road).flatMap((line) =>
    roadDashes(line, true, pattern).map((p) => lineShape(road, 'lane', p, 0.78)),
  );
  if (!road.lanes.some((i) => city.lanes[i]!.taperStartM || city.lanes[i]!.taperEndM))
    return shapes;
  const geometry = transitionGeometry(city, road);
  for (const divider of geometry.dividers)
    shapes.push(...roadDashes(divider, true, pattern).map((p) => lineShape(road, 'lane', p, 0.78)));
  for (const item of geometry.lanes) {
    const lane = city.lanes[item.lane]!;
    for (const start of [true, false]) {
      const taper = start ? lane.taperStartM : lane.taperEndM;
      if (!taper) continue;
      const others = road.lanes
        .map((i) => city.lanes[i]!)
        .filter((l) => !(start ? l.taperStartM : l.taperEndM));
      const neighbor = others.reduce((a, b) =>
        Math.abs(a.lane - lane.lane) < Math.abs(b.lane - lane.lane) ? a : b,
      );
      const side = Math.sign(lane.lane - neighbor.lane);
      const nominal = parallelOffset(lane.polyline, side * 0.15);
      const actual = side > 0 ? item.right : item.left;
      const from = start ? 0 : lane.lengthM - taper,
        to = start ? taper : lane.lengthM;
      const section = (edge: Vec2[]) => [
        pointAtDistance(edge, lane.cumulative, from),
        ...edge.filter((_, i) => lane.cumulative[i]! > from && lane.cumulative[i]! < to),
        pointAtDistance(edge, lane.cumulative, to),
      ];
      const between = [...section(nominal), ...section(actual).reverse()];
      const rings = clearCentrelines(city, intersect(unionRings([between]), [road.surface]));
      const at = start ? taper : lane.lengthM - taper;
      const h = headingAtDistance(lane.polyline, lane.cumulative, at);
      for (const ring of rings.filter((r) => areaD(r) > 0.15)) {
        const holes = rings.filter(
          (r) => areaD(r) < 0 && pointInPolygon(r[0]!, [...ring, ring[0]!], 0),
        );
        shapes.push(...hatchGeometry(ring, h, road, holes));
      }
      if (!start) {
        const centre = Math.max(3.75, lane.taperStartM, at - 7.5);
        const scale =
          (lane.speedLimitMps >= 70 / 3.6
            ? markingTheme.fastArrowLengthM
            : markingTheme.arrowLengthM) / 5;
        for (const arrow of markingTheme.arrows[side > 0 ? 'merge-left' : 'merge-right'])
          shapes.push(
            fillShape(
              'arrow',
              arrow.map((q) => {
                const at = Math.max(0, centre + q.x * scale),
                  p = pointAtDistance(lane.polyline, lane.cumulative, at),
                  h = headingAtDistance(lane.polyline, lane.cumulative, at);
                return { x: p.x - Math.sin(h) * q.y, y: p.y + Math.cos(h) * q.y };
              }),
            ),
          );
      }
    }
  }
  return shapes;
}
