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
  boxOf,
  boxesMeet,
  clipOutside,
  cumulativeLengths,
  distance,
  headingAtDistance,
  parallelOffset,
  offsetPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineCrossings,
  polylineNearest,
  segmentDistance,
  segmentIntersection,
  trimPolyline,
  nearestOnPolyline,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CGroup, CLane, CMovement, CNode, CompiledCity, CRoad, Turn } from '../network';
import {
  crossingEnabled,
  crossingPlacement,
  crossingSpan,
  crossingStyle,
  endDirection,
  endEdges,
  MAPPED_M,
  nearSignal,
  nodeRoads,
  type CrossingSource,
} from '../network/crossings';
import { lanesNear } from '../network/walk';
import { SETBACK_CAP_M, junctionCorners } from '../network/junctions';
import { keepClearZones, type KeepClearZone } from '../network/keep-clear';
import {
  markingTheme as defaultTheme,
  type MarkingRole,
  type ArrowKind,
  type MarkingTheme,
} from './style';

import { defaultSlice, orderBranches } from '../network/continuity';
import {
  paintedCity,
  paintedLaneEdges as laneEdges,
  transitionLanes,
  transitionAt,
} from './road-paint';

const LINE_CLEAR_M = 0.5;
/** TASK-215 (M2): an inner road's lanes carry lane lines from this length (the audit's 15 m). */
const INNER_LINES_M = 15;

export type MarkingShape = {
  color?: number;
  gore?: PaintedGore;
  role: MarkingRole;
  points: Vec2[];
  alpha: number;
} & ({ kind: 'line'; widthM: number; dash?: readonly [number, number] } | { kind: 'polygon' });
function lineShape(
  road: CRoad,
  role: MarkingRole,
  points: Vec2[],
  alpha = 1,
  markingTheme: MarkingTheme = defaultTheme,
): MarkingShape {
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
// Stencil glyphs for KEEP CLEAR, as `busGlyphs`.
const keepGlyphs: Record<string, string[]> = {
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
};
/** TASK-233: a direction of a two-way `lanes=1` way, one carriageway both directions share (the
 * importer's `sharedLane`, read from the canonical road): drawn without lane paint. */
const sharedCarriageway = (road: CRoad, source?: CrossingSource) =>
  road.lanes.length === 1 &&
  !!source?.roads?.[road.id]?.provenance.inferred?.includes('sharedLane');
/** TASK-169: the stretches of a lane its keep-clear markings cover, in lane metres: its mouth
 * zones (`keepClearZones`), cut 0.5 m clear of the lane's crossings (TASK-215, M4: Freiburg
 * n:1462, a lot mouth at two crossings), each 3 m or more; the US and UK themes' text also needs
 * glyphs of 0.8 m or more. TASK-246: a box stands on the lane at its full width, so it keeps to the
 * lane between its taper at the start (a lane gain, `taperStartM`) and its taper at the end
 * (`taperEndM`), where the lane's centre line and edges bend: Freiburg's r:1189#3 box fanned
 * across the gain at n:1169. A box that is shorter than 3 m once cut is left out. TASK-256: none
 * on a shared one-lane carriageway (`sharedCarriageway`), which has no lane of its own direction
 * to box and no lane paint: the Freiburg promenade's garage mouth (`r:225`) is plain paving. */
export function keepClearBoxes(
  city: CompiledCity,
  lane: CLane,
  markingTheme: MarkingTheme,
  source?: CrossingSource,
): KeepClearZone[] {
  if (sharedCarriageway(city.roads[lane.road]!, source)) return [];
  const crosswalks = [false, true].flatMap((atEnd) => {
    const span = crossingSpan(city, lane, atEnd, source);
    return span
      ? [
          {
            fromM: Math.min(span.nearM, span.farM) - LINE_CLEAR_M,
            toM: Math.max(span.nearM, span.farM) + LINE_CLEAR_M,
          },
        ]
      : [];
  });
  const zones = keepClearZones(city)[lane.idx]!;
  const straight = { fromM: lane.taperStartM, toM: lane.lengthM - lane.taperEndM };
  return zones
    .filter((zone) => zone.kind === 'mouth')
    .map((zone) => ({
      ...zone,
      fromM: Math.max(zone.fromM, straight.fromM),
      toM: Math.min(zone.toM, straight.toM),
    }))
    .flatMap((zone) =>
      crosswalks.reduce(
        (parts, walk) =>
          parts.flatMap((part) => [
            ...(walk.fromM > part.fromM ? [{ ...part, toM: Math.min(part.toM, walk.fromM) }] : []),
            ...(walk.toM < part.toM ? [{ ...part, fromM: Math.max(part.fromM, walk.toM) }] : []),
          ]),
        [zone],
      ),
    )
    .filter(
      (zone) =>
        zone.toM - zone.fromM >= 3 && (markingTheme.id === 'de' || keepClearGlyphM(zone) >= 0.8),
    );
}
const keepClearGlyphM = (zone: KeepClearZone) => Math.min(2.4, (zone.toM - zone.fromM - 1.5) / 2.5);

/** TASK-169: the keep-clear markings of a lane's boxes (`keepClearBoxes`), one per lane and box:
 * the German theme's hatched box (a border with diagonal stripes), the US and UK themes' KEEP
 * CLEAR text, read in travel order, KEEP first. */
export function keepClearMarkings(
  city: CompiledCity,
  road: CRoad,
  markingTheme: MarkingTheme = defaultTheme,
  source?: CrossingSource,
): MarkingShape[] {
  const shapes: MarkingShape[] = [];
  for (const index of road.lanes) {
    const lane = city.lanes[index]!;
    for (const zone of keepClearBoxes(city, lane, markingTheme, source)) {
      const half = lane.widthM / 2 - 0.15;
      // Lane coordinates: `x` along the lane from the zone's start, `y` to the driver's right.
      const world = ({ x, y }: Vec2) => {
        const at = Math.max(0, Math.min(lane.lengthM, zone.fromM + x));
        const p = pointAtDistance(lane.polyline, lane.cumulative, at),
          h = headingAtDistance(lane.polyline, lane.cumulative, at);
        return { x: p.x - Math.sin(h) * y, y: p.y + Math.cos(h) * y };
      };
      const length = zone.toM - zone.fromM;
      const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
      const push = (local: Vec2[]) => shapes.push(fillShape('hatch', local.map(world), 0.9));
      if (markingTheme.id === 'de') {
        const line = 0.12;
        push(rect(0, -half, length, -half + line));
        push(rect(0, half - line, length, half));
        push(rect(0, -half, line, half));
        push(rect(length - line, -half, length, half));
        const box = [rect(0, -half, length, half)];
        const stripe = 0.3 * Math.SQRT2;
        for (let x = -2 * half; x < length; x += 1.5)
          for (const part of filledParts(
            intersect(
              [
                [
                  { x, y: -half },
                  { x: x + stripe, y: -half },
                  { x: x + stripe + 2 * half, y: half },
                  { x: x + 2 * half, y: half },
                ],
              ],
              box,
            ),
          ))
            if (Math.abs(areaD(part)) > 0.01) push(part);
        continue;
      }
      const words = ['KEEP', 'CLEAR'];
      const cell = (2 * half) / 29;
      const glyphM = keepClearGlyphM(zone);
      words.forEach((word, line) => {
        // KEEP nearer the driver, CLEAR beyond it, centred in the zone.
        const bottom = length / 2 + (line === 0 ? -0.25 - glyphM : 0.25);
        const left = (-word.length * 6 + 1) * (cell / 2);
        [...word].forEach((letter, k) =>
          keepGlyphs[letter]!.forEach((row, y) => {
            for (let x = 0; x < 5; x++) {
              if (row[x] !== '1') continue;
              const top = bottom + glyphM - (y * glyphM) / 7;
              const l = left + (k * 6 + x) * cell;
              push(rect(top - glyphM / 7, l, top, l + cell));
            }
          }),
        );
      });
    }
  }
  return shapes;
}
/** The yellow lines of a UK kerb, as the importer read them (`kerbLines`). */
export type KerbLine = 'single' | 'double';
/** Side is relative to travel (-1 left, +1 right). */
export function kerbLine(road: CRoad, side: number, source?: CrossingSource): KerbLine | undefined {
  const prefix = `kerbLine:${side < 0 ? 'left' : 'right'}:`;
  const entry = source?.roads?.[road.id]?.provenance.inferred?.find((v) => v.startsWith(prefix));
  return entry?.slice(prefix.length) as KerbLine | undefined;
}
/** TASK-276 (D8): UK town roads carry no edge line of their own; their kerbs have the yellow
 * lines the importer read from OSM, or none. */
const ukTownRoad = (road: CRoad) =>
  ['residential', 'tertiary', 'secondary', 'primary'].includes(road.roadClass);
/** Centre-line insets from the kerb and line widths of the UK theme's single and double yellow
 * lines (TSRGD diagrams 1017 and 1018.1), drawn 0.1 m wide and 0.1 m apart. */
const KERB_LINES: Record<KerbLine, { insetsM: number[]; widthM: number }> = {
  single: { insetsM: [0.15], widthM: 0.1 },
  double: { insetsM: [0.15, 0.35], widthM: 0.1 },
};

/** Lead (TASK-103 merge): the pieces of a kerb line beside no parking strip on that side; a
 * kerb with parking carries no UK no-waiting line. */
export function besideNoStrip(city: CompiledCity, road: CRoad, side: number, points: Vec2[]) {
  const name = side < 0 ? 'left' : 'right';
  const strips = (city.strips ?? []).filter((s) => s.road === road.idx && s.side === name);
  if (!strips.length || points.length < 2) return [points];
  const lengths = cumulativeLengths(points),
    total = lengths.at(-1)!,
    reference = cumulativeLengths(road.reference);
  const runs = strips
    .map((s) => {
      const [a, b] = [s.fromM, s.toM].map(
        (m) => nearestOnPolyline(points, pointAtDistance(road.reference, reference, m)).along,
      ) as [number, number];
      return [Math.min(a, b), Math.max(a, b)] as const;
    })
    .sort((a, b) => a[0] - b[0]);
  const pieces: Vec2[][] = [];
  let cursor = 0;
  for (const [from, to] of runs) {
    if (from > cursor + 0.05) pieces.push(trimPolyline(points, cursor, total - from));
    cursor = Math.max(cursor, to);
  }
  if (total > cursor + 0.05) pieces.push(trimPolyline(points, cursor, 0));
  return pieces;
}

type ShapeCache<T> = WeakMap<CompiledCity, WeakMap<object, WeakMap<MarkingTheme, Map<number, T>>>>;
const noSource = {};
/** TASK-206: the 2D map and the 3D scene paint the same shapes, so a road's or node's shapes are
 * computed once per painted city, source and theme and then shared: callers never change them. */
function shared<T>(
  cache: ShapeCache<T>,
  city: CompiledCity,
  source: object | undefined,
  theme: MarkingTheme,
  index: number,
  build: () => T,
): T {
  let bySource = cache.get(city);
  if (!bySource) cache.set(city, (bySource = new WeakMap()));
  let byTheme = bySource.get(source ?? noSource);
  if (!byTheme) bySource.set(source ?? noSource, (byTheme = new WeakMap()));
  let byIndex = byTheme.get(theme);
  if (!byIndex) byTheme.set(theme, (byIndex = new Map()));
  let shapes = byIndex.get(index);
  if (!shapes) byIndex.set(index, (shapes = build()));
  return shapes;
}
const roadShapes: ShapeCache<ReturnType<typeof buildRoadMarkings>> = new WeakMap();
const nodeShapes: ShapeCache<MarkingShape[]> = new WeakMap();
const transitionShapes: ShapeCache<MarkingShape[]> = new WeakMap();

export function roadMarkingGeometry(
  city: CompiledCity,
  road: CRoad,
  source?: CrossingSource,
  markingTheme: MarkingTheme = defaultTheme,
) {
  city = paintedCity(city);
  return shared(roadShapes, city, source, markingTheme, road.idx, () =>
    buildRoadMarkings(city, road, source, markingTheme),
  );
}

function buildRoadMarkings(
  city: CompiledCity,
  road: CRoad,
  source: CrossingSource | undefined,
  markingTheme: MarkingTheme,
) {
  city = transitionLanes(city);
  road = city.roads[road.idx]!;
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
    belowShapes.push(
      ...below.map((points) => lineShape(road, 'lane', points, alpha, markingTheme)),
    );
    aboveShapes.push(
      ...above.map((points) => lineShape(road, 'lane', points, alpha, markingTheme)),
    );
  };
  // TASK-131 (owner, checkpoint 2): an inner road of a junction group is part of the junction
  // surface, but its lanes run on through the group: dashed lines between lanes of one direction,
  // as on any road; no centre or edge line, and no stop, yield or crossing (`approachMarkings`).
  // TASK-215 (M2): only on lanes of `INNER_LINES_M` or more; on the short links of most groups
  // (Freiburg's inner lanes run 2 to 9 m between their cuts) a dash or two splays across the
  // junction at the link's angle. TASK-229 (N1): also on carriageway a group takes in
  // (`innerCarriageway`).
  if (road.group !== undefined) {
    const carriageway = innerCarriageway(city, road);
    for (const index of road.lanes) {
      const lane = city.lanes[index]!;
      if (lane.right < 0 || (lane.lengthM < INNER_LINES_M && !carriageway)) continue;
      draw(
        roadDashes(
          parallelOffset(lane.polyline, lane.widthM / 2),
          true,
          markingTheme.classes[road.roadClass].lane.dash!,
        ),
        0.78,
      );
    }
    return { below: belowShapes, above: aboveShapes, pavement };
  }
  // B46 (TASK-091): a centre line ends at the junction mouth, also where the outline reaches back
  // over the end of the approach: no centre line inside a junction polygon, and no piece shorter
  // than a dash left between two (a stub road inside a junction, Munich r:1172 at n:182).
  const zigZags = markingTheme.id === 'uk' ? zigZagZones(city, road, source) : [];
  const centreClips = [
    ...(junction.length ? [...clips, junction] : clips),
    ...zigZagRings(city, zigZags),
  ];
  const drawCentre = (lines: Vec2[][]) =>
    belowShapes.push(
      ...lines
        .flatMap((line) => clipOutside(line, centreClips, 0))
        .filter((piece) => cumulativeLengths(piece).at(-1)! >= 2.7)
        .map((points) => lineShape(road, 'centre', points, 0.85, markingTheme)),
    );
  const sharedLane = sharedCarriageway(road, source);
  const partners =
    road.streetGroupId === null && road.corridorId !== null
      ? city.roads
          .filter((r) => r !== road && r.corridorId === road.corridorId && r.streetGroupId === null)
          .map((r) => polylineNearest([...r.surface, r.surface[0]!]))
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
        dividerPieces(
          parallelOffset(along, lane.widthM / 2),
          !tapered,
          markingTheme.classes[road.roadClass].lane.dash!,
          solidBeforeStop(city, road, lane),
        ),
        0.78,
        !tapered,
      );
    // A dashed centre is shared by both directions; painting it twice can fill its gaps. None
    // between the halves of a shared one-lane carriageway (TASK-233, TASK-216 D6).
    if (
      road.streetGroupId !== null &&
      !sharedLane &&
      (medianOnRight ? lane.right : lane.left) < 0 &&
      (markingTheme.id !== 'uk' || firstOfGroup(city, road))
    ) {
      const edge = parallelOffset(along, ((medianOnRight ? 1 : -1) * lane.widthM) / 2);
      const pattern = markingTheme.classes[road.roadClass].centre.dash;
      drawCentre(
        markingTheme.id === 'us'
          ? [parallelOffset(edge, medianOnRight ? -0.15 : 0.15)]
          : pattern
            ? roadDashes(edge, true, pattern)
            : [edge],
      );
    }
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
            partners.map((nearest) => nearest(p)).reduce((a, b) => (b.away < a.away ? b : a)).point,
        );
        pavement.push([...run, ...facing.reverse()]);
      }
      drawCentre(runs);
    }
    if (markingTheme.id !== 'de' && (lane.left < 0 || lane.right < 0)) {
      const edges = laneEdges(
        lane,
        road.lanes.map((i) => city.lanes[i]!),
      );
      for (const side of [-1, 1]) {
        if ((side < 0 ? lane.left : lane.right) >= 0) continue;
        const median = medianOnRight ? side > 0 : side < 0;
        if (median && road.streetGroupId !== null) continue;
        // TASK-276 (D8): a UK kerb draws the yellow lines read from OSM (`kerbLine`); a double
        // line stops beside a parking strip, a single one runs on (cars park over it out of its
        // hours). A town road's kerb without them has no line; other UK edges, and the median
        // edge of a divided town road, are white.
        const yellow = markingTheme.id === 'uk' ? kerbLine(road, side, source) : undefined;
        if (
          markingTheme.id === 'uk' &&
          !yellow &&
          ukTownRoad(road) &&
          !(median && road.corridorId !== null)
        )
          continue;
        const color = yellow
          ? markingTheme.colors.edge
          : markingTheme.id === 'uk'
            ? markingTheme.colors.lane
            : side < 0 && (road.corridorId !== null || road.roadClass === 'ramp')
              ? markingTheme.colors.centre
              : undefined;
        // Compiled edges follow tapers and the road's lane-block normals.
        const boundary = side < 0 ? edges.left : edges.right;
        for (const insetM of yellow ? KERB_LINES[yellow].insetsM : [0.15]) {
          const inset = parallelOffset(boundary, -side * insetM);
          const ratio = cumulativeLengths(inset).at(-1)! / lane.lengthM;
          const edge = trimPolyline(
            inset,
            (startSpan ? startSpan.farM + LINE_CLEAR_M : 0) * ratio,
            Math.max(lane.lengthM - lane.stopM, endSpan ? endFarM + LINE_CLEAR_M : 0) * ratio,
          );
          let sections = [edge];
          if (median && partners.length) {
            // Nearby opposing carriageways already carry the shared centre paint.
            const nearestBoundary = polylineNearest(boundary);
            const kerb = (p: Vec2) => {
              const boundaryPoint = nearestBoundary(p).point;
              return partners.every((nearest) => nearest(boundaryPoint).away > 1.5);
            };
            // Separation can change between the vertices of a straight boundary.
            sections = keepInside(edge, kerb, true);
          }
          for (const section of sections)
            for (const clipped of clipOutside(section, centreClips, 0))
              for (const points of yellow === 'double'
                ? besideNoStrip(city, road, side, clipped)
                : [clipped])
                belowShapes.push({
                  ...lineShape(road, 'edge', points, 0.85, markingTheme),
                  ...(yellow ? { widthM: KERB_LINES[yellow].widthM } : {}),
                  ...(color === undefined ? {} : { color }),
                });
        }
      }
    }
    // TASK-269 (D16): a zebra's zig-zags at the kerbs, and on a two-way street at the centre
    // where this road draws the centre line.
    const zones = zigZags.filter((zone) => zone.lane === lane.idx);
    if (zones.length) {
      const median = medianOnRight ? 1 : -1;
      const centre = road.streetGroupId !== null && !sharedLane && firstOfGroup(city, road);
      for (const side of [-1, 1]) {
        if ((side < 0 ? lane.left : lane.right) >= 0) continue;
        if (side === median && road.streetGroupId !== null && !centre) continue;
        const offset =
          side === median && road.streetGroupId !== null
            ? (side * lane.widthM) / 2
            : side * (lane.widthM / 2 - 0.15 - ZIGZAG_ACROSS_M / 2);
        for (const zone of zones)
          belowShapes.push({
            kind: 'line',
            role: 'lane',
            alpha: 0.85,
            widthM: 0.15,
            points: Array.from({ length: zone.marks + 1 }, (_, k) =>
              laneOffsetPoint(
                lane,
                zone.fromM + k * ZIGZAG_MARK_M,
                offset + ((k % 2) - 0.5) * ZIGZAG_ACROSS_M,
              ),
            ),
          });
      }
    }
    aboveShapes.push(
      ...approachShapes(city, lane, endFarM, startSpan?.farM ?? 0, markingTheme, source),
    );
  }
  aboveShapes.push(...stopLine(city, road, markingTheme));
  belowShapes.push(...busLabels(city, road, source).flatMap((label) => label.shapes));
  belowShapes.push(...keepClearMarkings(city, road, markingTheme, source));
  return { below: belowShapes, above: aboveShapes, pavement };
}

const groupFirsts = new WeakMap<CompiledCity, Map<string, number>>();
/** Whether no road of the road's street group comes before it (TASK-287: the least index per
 * group once per city, instead of a scan of every road per lane). */
function firstOfGroup(city: CompiledCity, road: CRoad): boolean {
  let firsts = groupFirsts.get(city);
  if (!firsts) {
    firsts = new Map();
    for (const r of city.roads)
      if (r.streetGroupId !== null)
        firsts.set(r.streetGroupId, Math.min(firsts.get(r.streetGroupId) ?? Infinity, r.idx));
    groupFirsts.set(city, firsts);
  }
  return firsts.get(road.streetGroupId!)! >= road.idx;
}

/** A point `offset` metres right of a lane's centreline (left when negative), `atM` along it. */
function laneOffsetPoint(lane: CLane, atM: number, offset: number): Vec2 {
  const s = Math.max(0, Math.min(lane.lengthM, atM));
  const p = pointAtDistance(lane.polyline, lane.cumulative, s);
  const h = headingAtDistance(lane.polyline, lane.cumulative, s);
  return { x: p.x - Math.sin(h) * offset, y: p.y + Math.cos(h) * offset };
}

/** TASK-269 (D16): a UK zebra's zig-zag marks (diagram 1001.3): eight of 2 m on each side of the
 * crossing where they fit, at least two, 0.4 m across, from 1 m beyond the stripes. */
const ZIGZAG_MARK_M = 2;
const ZIGZAG_MARKS = 8;
const ZIGZAG_ACROSS_M = 0.4;
const ZIGZAG_GAP_M = 1;

/** TASK-269 (D16): the zebras a lane crosses, in lane metres: those its road's ends paint as
 * stripes (`crossingStripes`' zebra style), whose zig-zags run on the road's side only, and the
 * mapped zebras it paints midblock (`mappedStripes`), with zig-zags on both sides. */
function laneZebras(
  city: CompiledCity,
  road: CRoad,
  lane: CLane,
  source?: CrossingSource,
): { fromM: number; toM: number; before: boolean; after: boolean }[] {
  return [false, true].flatMap((atEnd) => {
    const span = crossingSpan(city, lane, atEnd, source);
    const own =
      span && crossingStyle(city, road, atEnd, source) === 'zebra'
        ? [
            {
              fromM: Math.min(span.nearM, span.farM),
              toM: Math.max(span.nearM, span.farM),
              before: atEnd,
              after: !atEnd,
            },
          ]
        : [];
    const first = city.lanes[road.lanes[0]!]!;
    const mapped = paintedMapped(city, road, atEnd, source).flatMap(({ at, lines }) => {
      const m = at.get(lane.idx);
      if (m === undefined || lines) return [];
      const mean = [...at.values()].reduce((a, b) => a + b, 0) / at.size;
      const p = pointAtDistance(first.polyline, first.cumulative, Math.min(first.lengthM, mean));
      return nearSignal(city, p)
        ? []
        : [{ fromM: m - 1.25, toM: m + 1.25, before: true, after: true }];
    });
    return [...own, ...mapped];
  });
}

interface ZigZagZone {
  lane: number;
  fromM: number;
  marks: number;
}
/** TASK-269 (D16): each lane's zig-zag runs, between its zebras and up to its stop position. */
function zigZagZones(city: CompiledCity, road: CRoad, source?: CrossingSource): ZigZagZone[] {
  return road.lanes.flatMap((index) => {
    const lane = city.lanes[index]!;
    const zebras = laneZebras(city, road, lane, source);
    return zebras.flatMap((zebra) => {
      const runs: ZigZagZone[] = [];
      const room = (from: number, to: number) =>
        Math.min(ZIGZAG_MARKS, Math.floor((to - from) / ZIGZAG_MARK_M + 1e-9));
      if (zebra.before) {
        const end = zebra.fromM - ZIGZAG_GAP_M;
        const limit = Math.max(0, ...zebras.filter((z) => z.toM <= zebra.fromM).map((z) => z.toM));
        const marks = room(limit, end);
        if (marks >= 2) runs.push({ lane: index, fromM: end - marks * ZIGZAG_MARK_M, marks });
      }
      if (zebra.after) {
        const start = zebra.toM + ZIGZAG_GAP_M;
        const limit = Math.min(
          lane.stopM,
          ...zebras.filter((z) => z.fromM >= zebra.toM).map((z) => z.fromM),
        );
        const marks = room(start, limit);
        if (marks >= 2) runs.push({ lane: index, fromM: start, marks });
      }
      return runs;
    });
  });
}

/** TASK-269 (D16): the areas of the zig-zag runs, 0.3 m beyond their lanes, where no centre or
 * kerb line is drawn. */
function zigZagRings(city: CompiledCity, zones: ZigZagZone[]): Vec2[][] {
  return zones.map((zone) => {
    const lane = city.lanes[zone.lane]!;
    const stations = Array.from(
      { length: zone.marks + 1 },
      (_, k) => zone.fromM + k * ZIGZAG_MARK_M,
    );
    const half = lane.widthM / 2 + 0.3;
    return [
      ...stations.map((s) => laneOffsetPoint(lane, s, -half)),
      ...stations.reverse().map((s) => laneOffsetPoint(lane, s, half)),
    ];
  });
}

/** TASK-269 (D16): the Belisha beacons of the UK theme's zebras, 0.5 m beyond each kerb at the
 * middle of the stripes (not at the centre of a two-way street), one per spot within 2 m. */
export function zebraBeacons(
  city: CompiledCity,
  source: CrossingSource | undefined,
  markingTheme: MarkingTheme,
): { pos: Vec2; road: number }[] {
  if (markingTheme.id !== 'uk') return [];
  city = paintedCity(city);
  const beacons: { pos: Vec2; road: number }[] = [];
  const median = city.drivingSide === 'left' ? 1 : -1;
  for (const road of city.roads) {
    if (road.group !== undefined) continue;
    for (const index of road.lanes) {
      const lane = city.lanes[index]!;
      for (const zebra of laneZebras(city, road, lane, source))
        for (const side of [-1, 1]) {
          if ((side < 0 ? lane.left : lane.right) >= 0) continue;
          if (side === median && road.streetGroupId !== null) continue;
          const pos = laneOffsetPoint(
            lane,
            (zebra.fromM + zebra.toM) / 2,
            side * (lane.widthM / 2 + 0.5),
          );
          if (beacons.every((b) => distance(b.pos, pos) > 2)) beacons.push({ pos, road: road.idx });
        }
    }
  }
  return beacons;
}

/**
 * TASK-229 (N1): an inner road is carriageway the group takes in, not a link inside a junction,
 * when its run (the group's inner roads joined through plain joins: nodes whose movements all
 * lead from one road into one other) measures `INNER_LINES_M` or more node to node, and crossing
 * traffic meets the run at one end at most. A lane's cut-to-cut length cannot tell: the junction
 * outlines at both ends take most of a member road (Freiburg's Friedrichstraße `r:1149`, 18 m
 * node to node, 4.7 m lanes), and a short road between plain joins is one piece of a longer
 * carriageway (Stefan-Meier-Straße `r:6`, `r:745`, `r:1179`: 33 m). Length alone takes in the
 * links across a wide median (Munich `r:252`, 23 m), which lie between two crossings. A crossing
 * is a conflict with a movement that shares neither the entry nor the exit road (not a merge or
 * diverge).
 */
function innerCarriageway(city: CompiledCity, road: CRoad): boolean {
  const roadOf = (lane: number) => city.lanes[lane]!.road;
  const run = new Set([road.idx]);
  /** The inner road beyond a plain join at `node`, on the side road `at` does not take. */
  const beyond = (node: number, after: boolean, at: number) => {
    const movements = city.nodes[node]!.movements.map((i) => city.movements[i]!);
    const from = new Set(movements.map((m) => roadOf(m.fromLane)));
    const to = new Set(movements.map((m) => roadOf(m.toLane)));
    if (from.size !== 1 || to.size !== 1 || !(after ? from : to).has(at)) return undefined;
    const next = city.roads[[...(after ? to : from)][0]!]!;
    return next.group === road.group && !run.has(next.idx) ? next : undefined;
  };
  let [first, last, length] = [road, road, road.lengthM];
  for (let r; (r = beyond(first.from, false, first.idx)); first = r) {
    run.add(r.idx);
    length += r.lengthM;
  }
  for (let r; (r = beyond(last.to, true, last.idx)); last = r) {
    run.add(r.idx);
    length += r.lengthM;
  }
  const crossed = (end: CRoad, atEnd: boolean) =>
    end.lanes.some((i) =>
      (atEnd ? city.lanes[i]!.out : city.lanes[i]!.in).some((index) => {
        const m = city.movements[index]!;
        return m.conflicts.some((c) => {
          const other = city.movements[c]!;
          return (
            roadOf(other.fromLane) !== roadOf(m.fromLane) &&
            roadOf(other.toLane) !== roadOf(m.toLane)
          );
        });
      }),
    );
  return length >= INNER_LINES_M && !(crossed(first, false) && crossed(last, true));
}

/**
 * TASK-215 (M6): an approach's stop line, one line across all its lanes where any lane has one
 * (`approachMarkings`): through each lane's stop position, from 0.44 of a lane width beyond the
 * first lane's to as far beyond the last's, so it meets every lane where its cars stop, also
 * where a lane's stop position or heading differs from its neighbour's (Freiburg r:1185 at n:970,
 * whose short lanes end 0.26 m apart and fold) and on a lane without movements (r:1148#4).
 */
function stopLine(
  city: CompiledCity,
  road: CRoad,
  markingTheme: MarkingTheme = defaultTheme,
): MarkingShape[] {
  const lanes = road.lanes.map((i) => city.lanes[i]!);
  if (!lanes.some((lane) => approachMarkings(city, lane).stop)) return [];
  const stops = lanes.map((lane) => pointAtDistance(lane.polyline, lane.cumulative, lane.stopM));
  const first = lanes[0]!,
    last = lanes.at(-1)!;
  // Across the approach, to the right of travel: from the first stop to the last, or square to a
  // lone lane.
  let across = { x: stops.at(-1)!.x - stops[0]!.x, y: stops.at(-1)!.y - stops[0]!.y };
  if (lanes.length === 1) {
    const h = headingAtDistance(first.polyline, first.cumulative, first.stopM);
    across = { x: -Math.sin(h), y: Math.cos(h) };
  }
  const length = Math.hypot(across.x, across.y);
  const beyond = (p: Vec2, lane: CLane, side: number) => ({
    x: p.x + (side * across.x * lane.widthM * 0.44) / length,
    y: p.y + (side * across.y * lane.widthM * 0.44) / length,
  });
  return [
    lineShape(
      road,
      'stop',
      [
        beyond(stops[0]!, first, -1),
        ...(lanes.length > 1 ? stops : []),
        beyond(stops.at(-1)!, last, 1),
      ],
      1,
      markingTheme,
    ),
  ];
}

/** `startFarM`: the far edge of the crossing at the lane's start, from its start (0 for none). */
function approachShapes(
  city: CompiledCity,
  lane: CLane,
  crossingFarM: number,
  startFarM: number,
  markingTheme: MarkingTheme,
  source?: CrossingSource,
): MarkingShape[] {
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
  // TASK-241: give-way markings (1 m deep, their front at the stop position) not over crossing
  // paint (a zebra on a give-way arm, TASK-239's Freiburg n:2088): moved back behind it, or none
  // where the lane has no room.
  const paint = marks.yield ? crossingPaint(city, lane, source) : [];
  const yieldAt = marks.yield
    ? (clearOf(lane.stopM, 1, 0, lane.stopM, lane.stopM, paint) ??
      clearOf(
        lane.stopM,
        1,
        0,
        (startFarM > 0 ? startFarM + LINE_CLEAR_M : 0) + 1,
        lane.stopM,
        paint,
      ))
    : null;
  if (yieldAt !== null && markingTheme.id === 'uk') {
    for (const forward of [0, -0.6])
      for (let side = -half; side < half; side += 0.9)
        shapes.push(
          lineShape(
            road,
            'stop',
            [local(yieldAt, forward, side), local(yieldAt, forward, Math.min(half, side + 0.6))],
            1,
            markingTheme,
          ),
        );
  }
  if (yieldAt !== null && markingTheme.id !== 'uk')
    for (let side = -half + 0.4; side <= half - 0.2; side += 0.85)
      shapes.push(
        fillShape('stop', [
          local(yieldAt, 0, side),
          local(yieldAt, -1, side - 0.3),
          local(yieldAt, -1, side + 0.3),
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
    let at = Math.min(marks.arrowAt, lane.lengthM - crossingFarM - ARROW_CLEAR_M - 2.5 * scale);
    // TASK-215 (M4): nor on the crossing at the lane's start (Freiburg r:467 at n:464): moved
    // forward clear of it where the lane has room before its stop line and end crossing, else none.
    const back = startFarM + ARROW_CLEAR_M + 2.5 * scale;
    const front = Math.min(lane.stopM, lane.lengthM - crossingFarM) - ARROW_CLEAR_M - 2.5 * scale;
    if (startFarM > 0 && at < back) {
      if (back > front) return shapes;
      at = back;
    }
    // TASK-241: nor on a keep-clear box (Freiburg r:904, r:296, r:1333, r:1362 at lot mouths):
    // moved along the lane to the nearest place clear of boxes and crossing paint, between the
    // start crossing and the stop line, else none.
    const boxes = keepClearBoxes(city, lane, markingTheme, source);
    // TASK-264: an arrow on a gain's transition also keeps off the boxes of the lane under it there.
    const before = at < 0 ? transitionAt(city, road, false) : null;
    if (before) {
      const start = lane.polyline[0]!;
      const under = before.road.lanes
        .map((i) => city.lanes[i]!)
        .find((l) => {
          const end = l.polyline.at(-1)!;
          return Math.hypot(end.x - start.x, end.y - start.y) < l.widthM / 2;
        });
      if (under)
        for (const box of keepClearBoxes(city, under, markingTheme, source))
          boxes.push({ ...box, fromM: box.fromM - under.lengthM, toM: box.toM - under.lengthM });
    }
    if (clearOf(at, 2.5 * scale, 2.5 * scale, at, at, boxes) === null) {
      const moved = clearOf(
        at,
        2.5 * scale,
        2.5 * scale,
        before ? 2.5 * scale - before.road.lengthM : startFarM > 0 ? back : 2.5 * scale,
        front,
        [...boxes, ...crossingPaint(city, lane, source)],
      );
      if (moved === null) return shapes;
      at = moved;
    }
    for (const polygon of turns.length === 3
      ? [...markingTheme.arrows.through, ...markingTheme.arrows['left-right']]
      : markingTheme.arrows[key])
      shapes.push(
        fillShape(
          'arrow',
          // Before the lane's start (a gain's transition), along its first heading.
          polygon.map((p) =>
            before
              ? local(Math.max(0, at + p.x * scale), Math.min(0, at + p.x * scale), p.y)
              : local(Math.max(0, at + p.x * scale), 0, p.y),
          ),
        ),
      );
  }
  return shapes;
}

export function movementMarkings(
  movement: CMovement,
  markingTheme: MarkingTheme = defaultTheme,
): MarkingShape[] {
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
  // Keep matching corners: parallelOffset trims the two sides independently.
  const left = offsetPolyline(shape.points, -shape.widthM / 2),
    right = offsetPolyline(shape.points, shape.widthM / 2);
  return left.slice(1).map((p, i) => [left[i]!, p, right[i + 1]!, right[i]!]);
}
/** The runs of `line` whose points lie within 1.5 m of one of the closed `rings`. */
function besidePartners(line: Vec2[], partners: ReturnType<typeof polylineNearest>[]): Vec2[][] {
  const runs: Vec2[][] = [];
  let run: Vec2[] = [];
  for (const p of line) {
    if (partners.some((nearest) => nearest(p).away <= 1.5)) run.push(p);
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
  for (const other of nodeRoads(city, city.nodes[node]!)) {
    if (other === road) continue;
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
  const box = boxOf(ring);
  let current: Vec2[] = [],
    within = false;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    const ts = [0, 1];
    // Keep the endpoint tolerance of segmentIntersection when rejecting the ring.
    const pad =
      2e-9 *
      Math.max(box.maxX - box.minX, box.maxY - box.minY, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    const meets = boxesMeet(box, {
      minX: Math.min(a.x, b.x) - pad,
      minY: Math.min(a.y, b.y) - pad,
      maxX: Math.max(a.x, b.x) + pad,
      maxY: Math.max(a.y, b.y) + pad,
    });
    if (meets) {
      for (let j = 1; j < ring.length; j++) {
        const hit = segmentIntersection(a, b, ring[j - 1]!, ring[j]!);
        if (hit) ts.push(distance(a, hit) / Math.max(distance(a, b), 1e-12));
      }
    }
    ts.sort((x, y) => x - y);
    for (let k = 1; k < ts.length; k++) {
      if (ts[k]! - ts[k - 1]! < 1e-9) continue;
      const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const side = meets && pointInPolygon(at((ts[k - 1]! + ts[k]!) / 2), ring, 0);
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

/** TASK-217 (M7, owner-approved, German practice): a lane line is solid over the last
 * `SOLID_M` before a stop line, over the last half of a line shorter than twice that. */
const SOLID_M = 30;

/**
 * TASK-217 (M7): how much of the line between `lane` and its right-hand neighbour is solid
 * before the approach's stop line (`approachMarkings`), in metres back from the lane's stop
 * position: `SOLID_M`, or half the stop position on a short road, and no farther back than the
 * end of a lane gain's taper on either side (the added lane is entered across a dashed line);
 * none beside a lane that ends in a taper (its cars merge across the line).
 */
function solidBeforeStop(city: CompiledCity, road: CRoad, lane: CLane): number {
  const neighbour = city.lanes[lane.right]!;
  if (
    lane.taperEndM ||
    neighbour.taperEndM ||
    !road.lanes.some((i) => approachMarkings(city, city.lanes[i]!).stop)
  )
    return 0;
  const gain = Math.max(lane.taperStartM, neighbour.taperStartM);
  return Math.max(0, Math.min(SOLID_M, lane.stopM / 2, lane.stopM - gain));
}

/** A divider's pieces: dashes (`roadDashes`) and, where `solidM` > 0, one solid line over its
 * last `solidM` metres, the dashes then anchored to the solid line's start. */
function dividerPieces(
  line: Vec2[],
  fromEnd: boolean,
  pattern: readonly [number, number],
  solidM: number,
): Vec2[][] {
  const total = cumulativeLengths(line).at(-1)!;
  const solid = Math.min(solidM, total);
  if (solid <= 0.05) return roadDashes(line, fromEnd, pattern);
  return [
    ...(total - solid > 0.05 ? roadDashes(trimPolyline(line, 0, solid), true, pattern) : []),
    trimPolyline(line, total - solid, 0),
  ];
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
 * service roads. TASK-215 (M1): on an entry of a junction group, its paths through the group
 * (`groupTurns`), not the first inner link it enters; TASK-229 (N2): its movements at the entry
 * node when the group gives it no path, or double lefts only; TASK-240: on an approach ending at
 * no junction, the junction's ahead (`aheadTurns`). */
function arrowTurns(city: CompiledCity, lane: CLane): Turn[] {
  const road = city.roads[lane.road]!;
  const ahead = aheadTurns(city, road);
  if (ahead) return ahead[road.lanes.indexOf(lane.idx)]!;
  const group = road.group === undefined ? city.nodes[road.to]!.group : undefined;
  const paths = group === undefined ? null : groupTurns(city, city.groups![group]!, lane);
  if (paths) return paths;
  return [...new Set(arrowMovements(city, lane).map((m) => m.turn))];
}

/** A lane's movements an arrow can show: no u-turns, merges, diverges, never-green movements or
 * turns into service roads (a median crossover is one, Freiburg `r:1876`). */
const arrowMovements = (city: CompiledCity, lane: CLane) =>
  lane.out
    .map((index) => city.movements[index]!)
    .filter(
      (m) =>
        !m.neverGreen &&
        !['uturn', 'merge', 'diverge'].includes(m.turn) &&
        city.roads[city.lanes[m.toLane]!.road]!.roadClass !== 'service',
    );

/** TASK-240: no junction for arrows: a node outside any group, without a signal, stop or yield,
 * where no two movements cross (`innerCarriageway`'s crossing; movements to or from service roads
 * aside, so a median crossover's end is none, Freiburg `n:1147`). */
function noJunction(city: CompiledCity, node: CNode): boolean {
  if (node.group !== undefined || node.signal || node.control !== 'uncontrolled') return false;
  const roadOf = (lane: number) => city.roads[city.lanes[lane]!.road]!;
  const counted = (m: CMovement) =>
    roadOf(m.fromLane).roadClass !== 'service' && roadOf(m.toLane).roadClass !== 'service';
  return node.movements.every((index) => {
    const m = city.movements[index]!;
    return (
      !counted(m) ||
      m.conflicts.every((c) => {
        const other = city.movements[c]!;
        return (
          !counted(other) ||
          roadOf(other.fromLane) === roadOf(m.fromLane) ||
          roadOf(other.toLane) === roadOf(m.toLane)
        );
      })
    );
  });
}

/** TASK-255: a signal's stop position before its junction (TASK-218's D4): a member of a signalised
 * group laid out as the plain node it is, with no floor (`STOP_POSITION` in the compiler). The
 * approach's arrows read past it, as past a node that is no junction (`aheadTurns`). */
function stopPosition(city: CompiledCity, node: CNode): boolean {
  return node.group !== undefined && city.groups![node.group]!.signalised && !node.outline.length;
}

/**
 * TASK-240: on an approach that ends at no junction (`noJunction`: a plain node or a median
 * crossover), each lane's turns at the junction its path reaches next, where no lane on the way
 * has room for that junction's arrows (`arrowRoom`). A lane follows its one movement straight on
 * across nodes that are no junction; a lane whose one movement there turns (Freiburg `r:1149#4`
 * right onto the ramp `r:2153` at the gore `n:473`) shows that turn. At a junction: its movements
 * there, or on a group entry its paths through the group (`groupTurns`, M1); where the group gives
 * it none (TASK-229's case), the first turn its one movement after another makes inside the group,
 * or through where it leaves the group straight on. TASK-229's stand-in, the movement at the entry
 * node, is the first inner link M1 does not show, and stays for the entry's own arrows only.
 * Westbound Friedrichstraße `r:1148` ends at the crossover `n:1147`; its lanes run on through
 * `r:1149` and `r:475`, too short for arrows: `#0` and `#1` have no path through the Hauptbahnhof
 * group (a loop and a double left), and turn left at `n:1` first; the lanes read left, left,
 * through, through, right, as way 227874537's turn:lanes and the ground do. Null (the approach's
 * own movements) when any lane's path is ambiguous: several movements, or none, at a node that is
 * no junction or inside a group, or a lane on the way with room for arrows of its own; and when
 * the junction gives a lane no arrow (all its paths u-turns, Freiburg `r:1059#0` and `#1`), so an
 * approach keeps its arrows rather than show the junction's on some lanes only (`r:1285`).
 * TASK-255: an approach ending at a signal's stop position (`stopPosition`), whose road on to the
 * junction is an inner road that draws no arrows, is read the same way: the stop position is the
 * group entry, so each lane shows its paths through the group, or where it has none the first turn
 * its movements make inside it, the junction's movement as its turn:lanes give it. Zur
 * Unterführung's r:261 enters the Hauptbahnhof group at its signal n:260: #0 has no path and its
 * movements turn left after two links straight on, so it reads left, as on the ground and as before
 * the signal joined the group, not through (N2's stand-in, its link onto the inner r:1185).
 */
function aheadTurns(city: CompiledCity, road: CRoad): Turn[][] | null {
  const end = city.nodes[road.to]!;
  if (road.group !== undefined || !(noJunction(city, end) || stopPosition(city, end))) return null;
  const turns: Turn[][] = [];
  for (const index of road.lanes) {
    let lane = city.lanes[index]!;
    const seen = new Set<number>();
    for (;;) {
      seen.add(lane.idx);
      const inside = city.roads[lane.road]!.group !== undefined;
      const end = city.nodes[city.roads[lane.road]!.to]!;
      if (!inside && !noJunction(city, end)) {
        const group = end.group === undefined ? undefined : city.groups![end.group]!;
        const paths = group && groupTurns(city, group, lane);
        if (!group || paths) {
          const there = paths ?? arrowTurns(city, lane);
          if (!there.length) return null;
          turns.push(there);
          break;
        }
      }
      const out = arrowMovements(city, lane);
      if (out.length !== 1) return null;
      if (out[0]!.turn !== 'through') {
        turns.push([out[0]!.turn]);
        break;
      }
      lane = city.lanes[out[0]!.toLane]!;
      if (seen.has(lane.idx)) return null;
      if (inside && city.roads[lane.road]!.group === undefined) {
        turns.push(['through']);
        break;
      }
      if (!inside && city.roads[lane.road]!.group === undefined && arrowRoom(lane)) return null;
    }
  }
  return turns;
}

/** Signed change of heading from `a` to `b`, in (-pi, pi]. */
const turnBetween = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** The heading of a polyline's chord over its first 20 m. */
function chordHeading(line: Vec2[]): number {
  const lengths = cumulativeLengths(line);
  const p = pointAtDistance(line, lengths, Math.min(20, lengths.at(-1)!));
  return Math.atan2(p.y - line[0]!.y, p.x - line[0]!.x);
}

/**
 * TASK-215 (M1): the turns of a group entry lane's chains (`CGroup.chains`) through the group,
 * as the importer reads the entry's arrows (`groupAngle`): the angle between the entry's and the
 * exit's chords over 20 m from the group, classified as a movement's turn is. That angle is taken
 * on the side of a full turn the path itself turns through (the headings it changes along its
 * movements and inner lanes), so a path round the block (three lefts, Freiburg r:1396#0 to
 * r:868) is no right turn but a u-turn, and shown as none. A path of one movement keeps that
 * movement's turn; paths with a never-green movement, into a service road, merges and diverges
 * are left out as at any node (`arrowTurns`).
 * TASK-229 (N2): null for a lane with no chain, or whose chains are all u-turns of two turns to
 * one side (double lefts): Freiburg `r:1148#0` has no chain through the Hauptbahnhof group and
 * `#1`'s only one turns left twice (to `r:484`), yet the ground has arrows on both. A path round
 * the block (three lefts) stays a u-turn.
 */
function groupTurns(city: CompiledCity, group: CGroup, lane: CLane): Turn[] | null {
  const turns = new Set<Turn>();
  const entry = city.roads[lane.road]!;
  let paths = 0,
    doubles = 0;
  for (const chain of group.chains) {
    const movements = chain.movements.map((i) => city.movements[i]!);
    if (movements[0]!.fromLane !== lane.idx) continue;
    paths++;
    if (movements.some((m) => m.neverGreen)) continue;
    const exit = city.roads[chain.to]!;
    if (exit.roadClass === 'service') continue;
    let turn = movements[0]!.turn;
    if (movements.length > 1) {
      let path = 0;
      for (const [k, m] of movements.entries()) {
        path += turnBetween(startHeading(m.polyline), endHeading(m.polyline));
        if (k < movements.length - 1) {
          const inner = city.lanes[m.toLane]!.polyline;
          path += turnBetween(endHeading(m.polyline), startHeading(inner));
          path += turnBetween(startHeading(inner), endHeading(inner));
          path += turnBetween(endHeading(inner), startHeading(movements[k + 1]!.polyline));
        }
      }
      const chord = turnBetween(
        chordHeading([...entry.reference].reverse()) + Math.PI,
        chordHeading(exit.reference),
      );
      const angle = chord + 2 * Math.PI * Math.round((path - chord) / (2 * Math.PI));
      turn =
        Math.abs(angle) > (5 * Math.PI) / 6
          ? 'uturn'
          : Math.abs(angle) < Math.PI / 6
            ? 'through'
            : angle > 0
              ? 'right'
              : 'left';
    }
    const sides = movements.filter((m) => m.turn === 'left' || m.turn === 'right');
    if (turn === 'uturn' && sides.length === 2 && sides[0]!.turn === sides[1]!.turn) doubles++;
    if (turn === 'uturn' || turn === 'merge' || turn === 'diverge') continue;
    turns.add(turn);
  }
  return paths === doubles ? null : [...turns];
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
  const before = transitionAt(city, road, false);
  const arrowAt = before ? -before.atM : arrowPosition(lane, crossingFarM);
  return {
    // TASK-131: no stop or yield line on a junction group's inner road.
    stop:
      controlled &&
      road.group === undefined &&
      (node.signal !== null || (node.control === 'stop' && minor)),
    yield: controlled && road.group === undefined && node.control === 'yield' && minor,
    arrowAt,
    turns:
      road.group === undefined &&
      differ &&
      (before !== null || arrowRoom(lane, crossingFarM)) &&
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

/** A stretch of a lane, in lane metres. */
type Span = { fromM: number; toM: number };

/** TASK-241: the position nearest `at`, within `lo` to `hi`, of a glyph reaching `behind` back
 * and `ahead` forward from it that keeps `ARROW_CLEAR_M` off every blocked span; null if none. */
function clearOf(
  at: number,
  behind: number,
  ahead: number,
  lo: number,
  hi: number,
  blocked: Span[],
): number | null {
  const clear = (c: number) =>
    blocked.every(
      (b) => c + ahead + ARROW_CLEAR_M <= b.fromM || c - behind - ARROW_CLEAR_M >= b.toM,
    );
  return (
    [
      at,
      ...blocked.flatMap((b) => [b.fromM - ARROW_CLEAR_M - ahead, b.toM + ARROW_CLEAR_M + behind]),
    ]
      .filter((c) => c >= lo - 1e-9 && c <= hi + 1e-9 && clear(c))
      .sort((a, b) => Math.abs(a - at) - Math.abs(b - at) || a - b)[0] ?? null
  );
}

/** Where a lane's arrow is centred, from its start (`approachMarkings`). */
function arrowPosition(lane: CLane, crossingFarM = 0): number {
  const scale = Math.min(1, lane.lengthM / 18);
  return Math.min(
    lane.stopM - ARROW_BEFORE_STOP_M,
    lane.lengthM - crossingFarM - ARROW_CLEAR_M - ARROW_HALF_M * scale,
  );
}

/** A lane is long enough for an arrow, with the arrow behind its stop position. */
const arrowRoom = (lane: CLane, crossingFarM = 0) =>
  lane.lengthM >= ARROW_MIN_LANE_M &&
  arrowPosition(lane, crossingFarM) >= ARROW_HALF_M * Math.min(1, lane.lengthM / 18);

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

/** The paint of a road end's crossing, empty where it has none (`crossingEnabled`) or it is
 * unmarked: zebra stripes, or the two broken lines of a signalised crossing along the stripes'
 * near and far edges (TASK-217, `crossingStyle`). */
export function crossingStripes(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): Vec2[][] {
  const mapped = mappedStripes(city, road, atEnd, source);
  if (!crossingEnabled(city, road, atEnd, source)) return mapped;
  const { stripes } = crossingPlacement(city, road, atEnd);
  const style = crossingStyle(city, road, atEnd, source);
  return [
    ...(style === 'zebra' ? stripes : style === 'signal' ? signalLines(stripes) : []),
    ...mapped,
  ];
}

/** TASK-217 (D1): where each mapped crossing way (walk link of kind `crossing`) crosses a
 * road's lanes, in lane metres from the lane's start, by road; a link crossing at another grade,
 * or (TASK-257) one OSM maps unmarked, is left out. */
const mappedHits = new WeakMap<object, WeakMap<CompiledCity, Map<number, MappedHit[]>>>();
interface MappedHit {
  link: number;
  lane: number;
  atM: number;
  lines: boolean;
}
function roadMappedHits(city: CompiledCity, road: CRoad, source?: CrossingSource): MappedHit[] {
  const walk = source?.walk;
  if (!walk) return [];
  let byCity = mappedHits.get(walk.links);
  if (!byCity) mappedHits.set(walk.links, (byCity = new WeakMap()));
  let byRoad = byCity.get(city);
  if (!byRoad) {
    byRoad = new Map();
    for (const [k, link] of Object.values(walk.links).entries()) {
      if (link.kind !== 'crossing' || link.marking === 'none') continue;
      const grade = link.layer ?? walk.nodes[link.from]!.layer;
      for (const i of lanesNear(city, link.line)) {
        const lane = city.lanes[i]!;
        if (city.roads[lane.road]!.grade !== grade) continue;
        for (const hit of polylineCrossings(link.line, lane.polyline)) {
          const list = byRoad.get(lane.road) ?? [];
          list.push({ link: k, lane: i, atM: hit.alongB, lines: link.marking === 'lines' });
          byRoad.set(lane.road, list);
        }
      }
    }
    byCity.set(city, byRoad);
  }
  return byRoad.get(road.idx) ?? [];
}

/**
 * TASK-217 (D1): the paint of the mapped crossings over the half of a road nearer one end that
 * the end's own crossing does not stand for: a midblock crossing (over `MAPPED_M` from the cut),
 * or one at an end without a crossing of its own (Freiburg's zebras where a slip road splits at
 * the crossing node, n:398). Stripes 2.5 m long along each lane, centred where the way crosses
 * its centreline, at the end crossings' 0.9 m pitch across the road; none inside a junction; the
 * broken lines of a signalised crossing near a signalized node (`nearSignal`) or (TASK-257) where
 * OSM marks it with lines, zebra stripes elsewhere.
 */
function mappedStripes(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): Vec2[][] {
  const lanes = road.lanes.map((i) => city.lanes[i]!);
  const outlines = [city.nodes[road.from]!.outline, city.nodes[road.to]!.outline]
    .filter((o) => o.length)
    .map((o) => preparePolygonRing(o));
  const width = lanes.reduce((sum, lane) => sum + lane.widthM, 0);
  const paint: Vec2[][] = [];
  for (const { at, lines } of paintedMapped(city, road, atEnd, source)) {
    const mean = [...at.values()].reduce((a, b) => a + b, 0) / at.size;
    const local = (lane: CLane, d: number, offset: number): Vec2 => {
      const s = Math.max(0, Math.min(lane.lengthM, d));
      const p = pointAtDistance(lane.polyline, lane.cumulative, s);
      const h = headingAtDistance(lane.polyline, lane.cumulative, s);
      return { x: p.x - Math.sin(h) * offset, y: p.y + Math.cos(h) * offset };
    };
    const stripes: Vec2[][] = [];
    for (let side = 0.225; side + 0.45 <= width; side += 0.9) {
      let edge = 0;
      const lane = lanes.find((lane) => {
        if (side + 0.225 <= edge + lane.widthM) return true;
        edge += lane.widthM;
        return false;
      });
      const centre = lane && at.get(lane.idx);
      if (!lane || centre === undefined) continue;
      const near = side - edge - lane.widthM / 2,
        far = near + 0.45;
      const stripe = [
        local(lane, centre - 1.25, near),
        local(lane, centre + 1.25, near),
        local(lane, centre + 1.25, far),
        local(lane, centre - 1.25, far),
      ];
      if (distance(stripe[0]!, stripe[1]!) < 0.2) continue;
      if (stripe.some((p) => outlines.some((inside) => inside(p)))) continue;
      stripes.push(stripe);
    }
    const p = pointAtDistance(
      lanes[0]!.polyline,
      lanes[0]!.cumulative,
      Math.min(lanes[0]!.lengthM, mean),
    );
    paint.push(...(lines || nearSignal(city, p) ? signalLines(stripes) : stripes));
  }
  return paint;
}

const preparePolygonRing = (ring: Vec2[]) => (p: Vec2) => pointInPolygon(p, ring, 0);

/** The mapped crossings `mappedStripes` paints over the half of a road nearer one end: per
 * crossing way, where it crosses each lane (lane index to lane metres), and whether OSM marks it
 * with lines. */
function paintedMapped(
  city: CompiledCity,
  road: CRoad,
  atEnd: boolean,
  source?: CrossingSource,
): { at: Map<number, number>; lines: boolean }[] {
  const hits = roadMappedHits(city, road, source);
  if (!hits.length || road.group !== undefined) return [];
  const ownCrossing =
    crossingEnabled(city, road, atEnd, source) &&
    crossingPlacement(city, road, atEnd).stripes.length > 0;
  return [...new Set(hits.map((h) => h.link))].flatMap((link) => {
    const own = hits.filter((h) => h.link === link);
    const at = new Map(own.map((h) => [h.lane, h.atM]));
    const mean = [...at.values()].reduce((a, b) => a + b, 0) / at.size;
    const length = city.lanes[road.lanes.find((lane) => at.has(lane))!]!.lengthM;
    const fromCut = atEnd ? length - mean : mean;
    return mean > length / 2 !== atEnd || (ownCrossing && fromCut <= MAPPED_M)
      ? []
      : [{ at, lines: own[0]!.lines }];
  });
}

/** TASK-241: the stretches of a lane under crossing paint, in lane metres: the crossings its
 * road's ends draw (zebra stripes or a signalised crossing's lines, `crossingStripes`) and the
 * mapped crossings it draws (`mappedStripes`, 2.5 m along the lane). */
function crossingPaint(city: CompiledCity, lane: CLane, source?: CrossingSource): Span[] {
  const road = city.roads[lane.road]!;
  return [false, true].flatMap((atEnd) => {
    const span = crossingSpan(city, lane, atEnd, source);
    const own =
      span && crossingStyle(city, road, atEnd, source) !== 'none'
        ? [{ fromM: Math.min(span.nearM, span.farM), toM: Math.max(span.nearM, span.farM) }]
        : [];
    const mapped = paintedMapped(city, road, atEnd, source).flatMap(({ at }) => {
      const m = at.get(lane.idx);
      return m === undefined ? [] : [{ fromM: m - 1.25, toM: m + 1.25 }];
    });
    return [...own, ...mapped];
  });
}

/** TASK-217 (D1): a signalised crossing's broken lines (German `Fußgängerfurt`), 0.15 m wide,
 * 0.5 m dashes and 0.2 m gaps, inside the near and far edges of the stripes the crossing would
 * have, run by run where stripes are left out (a curb return, the junction outline). */
const FURT_WIDTH_M = 0.15;
const FURT_DASH_M = 0.5;
const FURT_GAP_M = 0.2;
function signalLines(stripes: Vec2[][]): Vec2[][] {
  const dashes: Vec2[][] = [];
  // A stripe is [near side, far side, far side + width, near side + width]; stripes adjoin at a
  // 0.9 m pitch, so a gap of over 1 m between them starts a new run.
  const runs: Vec2[][][] = [];
  for (const stripe of stripes) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last && distance(last[3]!, stripe[0]!) < 1) run.push(stripe);
    else runs.push([stripe]);
  }
  // Each line lies inside the stripes' footprint, along its near or far edge.
  const towards = (p: Vec2, q: Vec2) => {
    const f = FURT_WIDTH_M / distance(p, q);
    return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
  };
  for (const run of runs)
    for (const near of [true, false]) {
      const outer = run.flatMap((t) => (near ? [t[0]!, t[3]!] : [t[1]!, t[2]!]));
      const inner = run.flatMap((t) =>
        near
          ? [towards(t[0]!, t[1]!), towards(t[3]!, t[2]!)]
          : [towards(t[1]!, t[0]!), towards(t[2]!, t[3]!)],
      );
      const outerLengths = cumulativeLengths(outer),
        innerLengths = cumulativeLengths(inner);
      const total = outerLengths.at(-1)!,
        innerTotal = innerLengths.at(-1)!;
      for (let start = 0; start < total - 0.05; start += FURT_DASH_M + FURT_GAP_M) {
        const end = Math.min(total, start + FURT_DASH_M);
        if (end - start < 0.05) continue;
        dashes.push([
          pointAtDistance(outer, outerLengths, start),
          pointAtDistance(outer, outerLengths, end),
          pointAtDistance(inner, innerLengths, (end / total) * innerTotal),
          pointAtDistance(inner, innerLengths, (start / total) * innerTotal),
        ]);
      }
    }
  return dashes;
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

function guideDashes(line: Vec2[], markingTheme: MarkingTheme): Vec2[][] {
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

export function junctionGuides(
  city: CompiledCity,
  node: CNode,
  markingTheme: MarkingTheme = defaultTheme,
): Guide[] {
  const lined = splitLinedUp(city, node);
  const groups = majorThroughs(city, node);
  if (!groups.length && !lined) return [];
  const lines = lined ? splitDividers(city, lined) : [];
  const major = new Set(
    groups.flat().flatMap((m) => [city.lanes[m.fromLane]!.road, city.lanes[m.toLane]!.road]),
  );
  const curb = city.drivingSide === 'right' ? 1 : -1;
  // TASK-276 (D8): UK yellow lines stop at a side road's mouth, so a UK town road's kerb, which
  // has no white edge line (`buildRoadMarkings`), has no guide across it either.
  const kerbGuide = (m: CMovement) =>
    markingTheme.id !== 'uk' || !ukTownRoad(city.roads[city.lanes[m.fromLane]!.road]!);
  for (const group of groups) {
    // At a split junction the dividers are the lined-up movements' (above).
    for (let i = 1; i < group.length && !lined; i++) {
      const [a, b] = [group[i - 1]!, group[i]!];
      if (a.fromLane === b.fromLane || a.toLane === b.toLane) continue;
      for (const line of midway(a, b, false)) lines.push({ kind: 'divider', line });
    }
    const outer = group.at(-1)!;
    if (kerbGuide(outer) && mouth(city, node, outer, major, curb))
      lines.push({ kind: 'edge', line: edge(city, outer, curb) });
  }
  // A one-way road has a curb on its median side too.
  const inner = groups[0]?.[0];
  if (inner && groups.length === 1 && kerbGuide(inner) && mouth(city, node, inner, major, -curb))
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
    dashes: guideDashes(guide.line, markingTheme).flatMap((dash) => keepInside(dash, inside)),
  }));
}

/** The runs of a dash whose sampled points all lie inside; runs under 0.5 m are dropped. */
function keepInside(dash: Vec2[], inside: (p: Vec2) => boolean, sampleSegments = false): Vec2[][] {
  if (!sampleSegments && dash.every(inside)) return [dash];
  const cumulative = cumulativeLengths(dash);
  const total = cumulative.at(-1)!;
  const step = 0.1;
  const runs: Vec2[][] = [];
  let run: Vec2[] = [];
  let allInside = true;
  let startM = 0,
    endM = 0;
  for (let s = 0; s <= total + 1e-9; s += step) {
    const at = Math.min(s, total);
    const p = pointAtDistance(dash, cumulative, at);
    if (inside(p)) {
      if (!run.length) startM = at;
      endM = at;
      run.push(p);
    } else {
      allInside = false;
      if (run.length) {
        runs.push(sampleSegments ? trimPolyline(dash, startM, total - endM) : run);
        run = [];
      }
    }
  }
  if (sampleSegments && allInside && dash.every(inside)) return [dash];
  if (run.length) runs.push(sampleSegments ? trimPolyline(dash, startM, total - endM) : run);
  return runs.filter(
    (r) =>
      r.length > 1 &&
      (sampleSegments ? cumulativeLengths(r).at(-1)! >= 0.5 - 1e-9 : (r.length - 1) * step >= 0.5),
  );
}

export function transitionGeometry(city: CompiledCity, road: CRoad) {
  city = paintedCity(city);
  road = city.roads[road.idx]!;
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

function seamSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function withinSeam(p: Vec2, line: Vec2[], distanceM: number): boolean {
  // The padded box only rejects distant segments. The distance test still decides the threshold.
  const pad = distanceM + 1e-6;
  const minX = p.x - pad,
    maxX = p.x + pad,
    minY = p.y - pad,
    maxY = p.y + pad;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    if (
      (a.x < minX && b.x < minX) ||
      (a.x > maxX && b.x > maxX) ||
      (a.y < minY && b.y < minY) ||
      (a.y > maxY && b.y > maxY)
    )
      continue;
    if (seamSegmentDistance(p, a, b) <= distanceM) return true;
  }
  return false;
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
  const total = lengths.at(-1)!;
  for (let s = 0; ; s = Math.min(total, s + 4)) {
    const p = pointAtDistance(edge, lengths, s);
    for (const k of city.laneSpatial.search(p.x - 3, p.y - 3, p.x + 3, p.y + 3)) {
      const lane = city.lanes[owner[k]!]!;
      if (lane.road !== road.idx && lane.left < 0) candidates.add(lane.idx);
    }
    if (s === total) break;
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
      if (withinSeam(q, left, run.length ? 0.25 : 0.1)) run.push(q);
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
  let best = seamSegmentDistance(a, left[0]!, left[1]!);
  for (let i = 2; i < left.length; i++) {
    const distance = seamSegmentDistance(a, left[i - 1]!, left[i]!);
    if (distance < best) {
      closest = i;
      best = distance;
    }
  }
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
  markingTheme: MarkingTheme = defaultTheme,
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
      const lineWidth = defaultTheme.classes[candidate.road.roadClass].channel.widthM;
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

export function nodeMarkingGeometry(
  city: CompiledCity,
  node: CNode,
  markingTheme: MarkingTheme = defaultTheme,
): MarkingShape[] {
  city = paintedCity(city);
  return shared(nodeShapes, city, undefined, markingTheme, node.idx, () =>
    buildNodeMarkings(city, node, markingTheme),
  );
}

function buildNodeMarkings(
  city: CompiledCity,
  node: CNode,
  markingTheme: MarkingTheme,
): MarkingShape[] {
  const guides = junctionGuides(city, node, markingTheme).flatMap((g) =>
    g.dashes.map((points) => ({
      kind: 'line' as const,
      role: g.kind === 'divider' ? ('lane' as const) : g.kind,
      points,
      alpha: 0.78,
      widthM: markingTheme.guide.widthM,
      dash: markingTheme.guide.dash,
      // TASK-276: a UK edge guide continues a white edge line, never a yellow kerb line.
      ...(markingTheme.id === 'uk' && g.kind === 'edge' ? { color: markingTheme.colors.lane } : {}),
    })),
  );
  return [
    ...guides,
    ...paintedGores(city, node).flatMap((g) =>
      hatchGeometry(g.ring, g.heading, g.road, g.holes, markingTheme).map((shape) => ({
        ...shape,
        gore: g,
      })),
    ),
    ...miniRoundaboutMarkings(city, node, markingTheme),
  ];
}

/**
 * TASK-269 (D4): a mini-roundabout's paint (its give-way lines are the entries' own, as at any
 * yield node): a white disc at the node, a third of the junction's inscribed radius, 0.75 to 2 m;
 * under the UK theme also its three arrows round the disc (diagram 1003.4 with 1014), 0.15 m
 * wide, 0.9 m outside it, in the circulating sense: clockwise in left-hand traffic,
 * anticlockwise in right-hand (with y south, clockwise is increasing angle).
 */
function miniRoundaboutMarkings(
  city: CompiledCity,
  node: CNode,
  markingTheme: MarkingTheme,
): MarkingShape[] {
  if (!node.miniRoundabout) return [];
  const { pos } = node;
  const ring = node.outline;
  const inscribed = ring.length
    ? Math.min(...ring.map((p, i) => segmentDistance(pos, p, ring[(i + 1) % ring.length]!)))
    : node.radiusM;
  const discM = Math.min(2, Math.max(0.75, inscribed / 3));
  const at = (r: number, angle: number): Vec2 => ({
    x: pos.x + r * Math.cos(angle),
    y: pos.y + r * Math.sin(angle),
  });
  const arc = (r: number, from: number, to: number, steps: number) =>
    Array.from({ length: steps + 1 }, (_, i) => at(r, from + ((to - from) * i) / steps));
  const shapes = [fillShape('arrow', arc(discM, 0, 2 * Math.PI, 36).slice(0, -1))];
  if (markingTheme.id !== 'uk') return shapes;
  const sense = city.drivingSide === 'left' ? 1 : -1;
  const r = discM + 0.9,
    half = 0.075,
    span = 1.2;
  for (let k = 0; k < 3; k++) {
    const from = (k * 2 * Math.PI) / 3,
      to = from + sense * span;
    shapes.push(
      fillShape('arrow', [
        ...arc(r + half, from, to, 12),
        at(r + 0.3, to),
        at(r, to + (sense * 0.5) / r),
        at(r - 0.3, to),
        ...arc(r - half, to, from, 12),
      ]),
    );
  }
  return shapes;
}

export function transitionMarkings(
  city: CompiledCity,
  road: CRoad,
  markingTheme: MarkingTheme = defaultTheme,
): MarkingShape[] {
  city = paintedCity(city);
  return shared(transitionShapes, city, undefined, markingTheme, road.idx, () =>
    buildTransitionMarkings(city, road, markingTheme),
  );
}

function buildTransitionMarkings(
  city: CompiledCity,
  road: CRoad,
  markingTheme: MarkingTheme,
): MarkingShape[] {
  city = transitionLanes(city);
  road = city.roads[road.idx]!;
  const pattern = markingTheme.classes[road.roadClass].lane.dash!;
  const shapes = seams(city, road).flatMap((line) =>
    roadDashes(line, true, pattern).map((p) => lineShape(road, 'lane', p, 0.78, markingTheme)),
  );
  if (!road.lanes.some((i) => city.lanes[i]!.taperStartM || city.lanes[i]!.taperEndM))
    return shapes;
  const geometry = transitionGeometry(city, road);
  for (const [k, divider] of geometry.dividers.entries())
    shapes.push(
      ...dividerPieces(
        divider,
        true,
        pattern,
        solidBeforeStop(city, road, city.lanes[road.lanes[k]!]!),
      ).map((p) => lineShape(road, 'lane', p, 0.78, markingTheme)),
    );
  // TASK-241: a hatched taper only where a lane ends (with its merge arrow). A lane gain is lanes
  // of one carriageway widening or fanning (2 to 5 lanes at Freiburg's n:1146 and n:1169), where
  // the ground has plain lanes: no hatch there. Hatched gores between roads with an island are
  // `paintedGores`'.
  for (const item of geometry.lanes) {
    const lane = city.lanes[item.lane]!;
    const taper = lane.taperEndM;
    if (!taper) continue;
    const others = road.lanes.map((i) => city.lanes[i]!).filter((l) => !l.taperEndM);
    const neighbor = others.reduce((a, b) =>
      Math.abs(a.lane - lane.lane) < Math.abs(b.lane - lane.lane) ? a : b,
    );
    const side = Math.sign(lane.lane - neighbor.lane);
    const nominal = parallelOffset(lane.polyline, side * 0.15);
    const actual = side > 0 ? item.right : item.left;
    const from = lane.lengthM - taper,
      to = lane.lengthM;
    const section = (edge: Vec2[]) => [
      pointAtDistance(edge, lane.cumulative, from),
      ...edge.filter((_, i) => lane.cumulative[i]! > from && lane.cumulative[i]! < to),
      pointAtDistance(edge, lane.cumulative, to),
    ];
    const between = [...section(nominal), ...section(actual).reverse()];
    const rings = clearCentrelines(city, intersect(unionRings([between]), [road.surface]));
    const at = lane.lengthM - taper;
    const h = headingAtDistance(lane.polyline, lane.cumulative, at);
    for (const ring of rings.filter((r) => areaD(r) > 0.15)) {
      const holes = rings.filter(
        (r) => areaD(r) < 0 && pointInPolygon(r[0]!, [...ring, ring[0]!], 0),
      );
      shapes.push(...hatchGeometry(ring, h, road, holes, markingTheme));
    }
    const centre = Math.max(3.75, lane.taperStartM, at - 7.5);
    const scale =
      (lane.speedLimitMps >= 70 / 3.6 ? markingTheme.fastArrowLengthM : markingTheme.arrowLengthM) /
      5;
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
  return shapes;
}
