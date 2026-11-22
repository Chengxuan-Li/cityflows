import {
  areaD,
  ClipperD,
  ClipType,
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
  unionD,
} from 'clipper2-ts';
import {
  cumulativeLengths,
  headingAtDistance,
  nearestOnPolyline,
  offsetPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineLength,
  sampleBezier,
  trimPolyline,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { AirsideEdge, Airport, Runway, RunwayEnd } from '../schema/airport';
import { airsideAreas, runwayCentreline } from './airside-geometry';
import type { MarkingShape } from './marking-geometry';
import { paintAirsideText } from './airside-lettering';

const white = 0xf8f7ef;
const yellow = 0xffcf3c;
const line = (points: Vec2[], widthM: number, color = yellow): MarkingShape => ({
  kind: 'line',
  role: 'centre',
  points,
  widthM,
  color,
  alpha: 1,
});
const fill = (points: Vec2[]): MarkingShape => ({
  kind: 'polygon',
  role: 'edge',
  points,
  color: white,
  alpha: 1,
});

function frame(pos: Vec2, heading: number) {
  const x = Math.cos(heading);
  const y = Math.sin(heading);
  return (forward: number, right: number): Vec2 => ({
    x: pos.x + x * forward - y * right,
    y: pos.y + y * forward + x * right,
  });
}

// EASA CS ADR-DSN.L.525–550. Use dimensions in metres, fitting the longitudinal layout
// to short fields and the lateral dimensions to unusually narrow pavement.
function runwayEndPaint(end: RunwayEnd, width: number, between: number, lda: number) {
  const world = frame(end.threshold.pos, end.heading);
  const scale = Math.min(1, between / 700);
  const rect = (from: number, length: number, left: number, stripe: number) =>
    fill([
      world(from, left),
      world(from + length, left),
      world(from + length, left + stripe),
      world(from, left + stripe),
    ]);
  const paint: MarkingShape[] = [];
  const bars = width >= 60 ? 16 : width >= 45 ? 12 : width >= 30 ? 8 : width >= 23 ? 6 : 4;
  const thresholdHalf = Math.min(27, width / 2 - Math.min(3, width / 6));
  const bar = thresholdHalf / bars;
  for (let i = 0; i < bars / 2; i++) {
    const inner = (2 * i + 1) * bar;
    paint.push(
      rect(6 * scale, 30 * scale, inner, bar),
      rect(6 * scale, 30 * scale, -inner - bar, bar),
    );
  }
  const [, number, suffix] = end.designator.toUpperCase().match(/^(\d{1,2})([LCR])?$/) ?? [];
  const labelHeight = Math.min(9 * scale, width / 3);
  const digits = number?.padStart(2, '0') ?? end.designator;
  const designator = (text: string, at: number) =>
    paintAirsideText(text, labelHeight, world, at * scale + labelHeight / 2, 0, white);
  paint.push(...designator(digits, 43));
  if (suffix) paint.push(...designator(suffix, 55));
  if (end.displacedM > 0) {
    const stripe = Math.min(1.8, end.displacedM);
    paint.push(rect(-stripe, stripe, -width / 2, width));
    const arrowCount = Math.max(1, Math.floor(end.displacedM / 30));
    const step = (end.displacedM - stripe) / arrowCount;
    const arrowScale = Math.min(1, step / 16, width / 12);
    for (let i = 0; i < arrowCount && arrowScale > 0; i++) {
      const tip = -stripe - (i + 0.2) * step;
      const a = (back: number, side: number) => world(tip - back * arrowScale, side * arrowScale);
      paint.push(
        fill([a(0, 0), a(5, 3), a(5, 0.4), a(12, 0.4), a(12, -0.4), a(5, -0.4), a(5, -3)]),
      );
    }
  }

  const [aim, aimLength, innerGap, aimWidth]: [number, number, number, number] =
    lda < 800
      ? [150, 30, 6, 4]
      : lda < 1200
        ? [250, 30, 9, 6]
        : lda < 2400
          ? [300, 45, 18, 6]
          : [400, 45, 18, 8];
  const lateral = Math.min(1, (width / 2 - Math.min(1.5, width / 8)) / (innerGap / 2 + aimWidth));
  const pair = (at: number, length: number, stripe: number) => {
    const offset = (innerGap / 2) * lateral;
    const barWidth = stripe * lateral;
    paint.push(
      rect(at * scale, length * scale, offset, barWidth),
      rect(at * scale, length * scale, -offset - barWidth, barWidth),
    );
  };
  pair(aim, aimLength, aimWidth);
  const pairs =
    between < 900 ? 1 : between < 1200 ? 2 : between < 1500 ? 3 : between < 2400 ? 4 : 6;
  const touchdown = Array.from({ length: pairs }, (_, i) => 150 * (i + 1)).filter(
    (at) => Math.abs(at - aim) > 50,
  );
  // On the short-field layout the first pair coincides with the aiming marks.
  if (!touchdown.length) touchdown.push(aim + 150);
  for (const at of touchdown) if ((at + 22.5) * scale < between / 2) pair(at, 22.5, 3);

  return paint;
}

function runwayPaint(airport: Airport, runway: Runway): MarkingShape[] {
  const path = runwayCentreline(airport, runway);
  const lengths = cumulativeLengths(path);
  const length = lengths.at(-1)!;
  const [a, b] = runway.ends;
  const start = nearestOnPolyline(path, a.threshold.pos).along;
  const end = nearestOnPolyline(path, b.threshold.pos).along;
  const between = end - start;
  const edge = runway.widthM >= 30 ? 0.9 : 0.45;
  const offset = Math.min(30, runway.widthM / 2) - edge / 2;
  const paint = [-offset, offset].map((side) => line(offsetPolyline(path, side), edge, white));
  if (between <= 0) return paint;
  paint.push(
    ...runwayEndPaint(a, runway.widthM, between, length - start),
    ...runwayEndPaint(b, runway.widthM, between, end),
  );

  const margin = 66 * Math.min(1, between / 700);
  const span = between - 2 * margin;
  const stripes = Math.max(1, Math.round((span + 25) / 55));
  const period = span / (stripes - 0.4);
  for (let i = 0; i < stripes; i++) {
    const from = start + margin + i * period;
    const to = from + period * 0.6;
    paint.push(
      line(
        [
          pointAtDistance(path, lengths, from),
          ...path.filter((_, j) => lengths[j]! > from && lengths[j]! < to),
          pointAtDistance(path, lengths, to),
        ],
        0.45,
        white,
      ),
    );
  }
  return paint;
}

function holdingPaint(airport: Airport, incident: Map<string, AirsideEdge[]>): MarkingShape[] {
  return Object.values(airport.holdingPositions).flatMap((hold) => {
    const edges =
      incident
        .get(hold.node)
        ?.filter((edge) => edge.kind === 'taxiway' || edge.kind === 'taxilane') ?? [];
    const toward = edges.find((edge) => edge.id === hold.toward);
    const edge = toward ?? edges[0];
    if (!edge) return [];
    const path = edge.from === hold.node ? edge.line : [...edge.line].reverse();
    const lengths = cumulativeLengths(path);
    const pos = airport.nodes[hold.node]!.pos;
    let heading = headingAtDistance(path, lengths, 0);
    if (!toward && hold.runway) {
      const runway = airport.runways[hold.runway]!;
      const { point } = nearestOnPolyline(runwayCentreline(airport, runway), pos);
      if ((point.x - pos.x) * Math.cos(heading) + (point.y - pos.y) * Math.sin(heading) < 0)
        heading += Math.PI;
    }
    const world = frame(pos, heading);
    const half = edge.widthM / 2 - Math.min(0.35, edge.widthM / 8);
    const paint: MarkingShape[] = [];
    // Pattern A for runway holds, with the two solid rows on the taxiway side.
    // Intermediate holds have the single broken row of CS ADR-DSN.L.580.
    const rows = hold.kind === 'runway' ? [-0.9, -0.3, 0.3, 0.9] : [0];
    for (const row of rows) {
      if (row < 0) paint.push(line([world(row, -half), world(row, half)], 0.3));
      else {
        // Keep a dash centred on the taxiway centreline.
        const dashes = 2 * Math.round(((2 * half) / 1.8 - 1) / 2) + 1;
        const step = (2 * half) / (dashes - 0.5);
        for (let i = 0; i < dashes; i++)
          paint.push(line([world(row, i * step - half), world(row, (i + 0.5) * step - half)], 0.3));
      }
    }
    return paint;
  });
}

function pavementEdges(airport: Airport): MarkingShape[] {
  const areas = airsideAreas(airport);
  const paths = (runway: boolean) =>
    areas
      .filter((area) => (area.kind === 'runway') === runway)
      .flatMap(({ rings }) =>
        rings.map((ring, i) => (areaD(ring) > 0 === (i === 0) ? ring : [...ring].reverse())),
      );
  // The joined outside edge keeps paint across pavement joins and out of taxiway mouths.
  const paved = unionD(paths(false), FillRule.NonZero);
  if (!paved.length) return [];
  const strips = [0.25, 0.6].flatMap((inset) =>
    inflatePathsD(paved, -inset, JoinType.Round, EndType.Polygon, 2, 2).map((ring) => [
      ...ring,
      ring[0]!,
    ]),
  );
  const clip = new ClipperD(2);
  clip.addOpenSubjectPaths(strips);
  clip.addClipPaths(paths(true));
  const visible: Vec2[][] = [];
  clip.execute(ClipType.Difference, FillRule.NonZero, [], visible);
  return visible.filter((path) => path.length >= 2).map((path) => line(path, 0.15));
}

function turnPadPaint(airport: Airport): MarkingShape[] {
  const areas = airport.surfaces.filter((area) => area.kind === 'turn_pad');
  const mapped = areas.map(({ rings: [ring] }) => {
    const sum = ring!.reduce((p, q) => ({ x: p.x + q.x, y: p.y + q.y }), { x: 0, y: 0 });
    return {
      pos: { x: sum.x / ring!.length, y: sum.y / ring!.length },
      ring: [...ring!, ring![0]!],
    };
  });
  const pads = [
    ...mapped,
    ...airport.turnPads
      .filter(({ pos }) => !mapped.some(({ ring }) => pointInPolygon(pos, ring)))
      .map(({ pos }) => ({ pos, ring: undefined })),
  ];
  const runways = Object.values(airport.runways).map((runway) => {
    const path = runwayCentreline(airport, runway);
    return { runway, path, lengths: cumulativeLengths(path) };
  });
  return pads.flatMap(({ pos, ring }) => {
    const match = runways
      .map((r) => ({ ...r, near: nearestOnPolyline(r.path, pos) }))
      .sort((a, b) => a.near.away - b.near.away)[0];
    if (!match || match.near.away > match.runway.widthM) return [];
    const { runway, path, lengths, near } = match;
    const length = lengths.at(-1)!;
    const reverse = near.along < length / 2;
    const heading = headingAtDistance(path, lengths, near.along) + (reverse ? Math.PI : 0);
    const lateral =
      (pos.y - near.point.y) * Math.cos(heading) - (pos.x - near.point.x) * Math.sin(heading);
    const side = lateral < 0 ? -1 : 1;
    // Outbound S-curve, then a half turn tangent to the runway centreline on the way back.
    const guide = (radius: number) => {
      const station = Math.max(radius + 1, Math.min(length - radius - 1, near.along));
      const world = frame(pointAtDistance(path, lengths, station), heading);
      const approach = sampleBezier(
        world(-5 * radius, 0),
        world(-3.5 * radius, 0),
        world(-2.5 * radius, side * 2 * radius),
        world(-radius, side * 2 * radius),
      );
      const arc = Array.from({ length: 25 }, (_, i) => {
        const angle = (i * Math.PI) / 24;
        return world(radius * Math.sin(angle), side * radius * (1 + Math.cos(angle)));
      });
      return [...approach, ...arc, world(-radius, 0)];
    };
    const radius = Math.min(12, runway.widthM * 0.22, length / 12);
    if (ring && Math.abs(lateral) > 2 * radius) {
      const wider = guide(Math.min(Math.abs(lateral) / 2, length / 12));
      if (
        wider.every(
          (p) =>
            nearestOnPolyline(path, p).away < runway.widthM / 2 - 0.5 || pointInPolygon(p, ring),
        )
      )
        return [line(wider, 0.3)];
    }
    return [line(guide(radius), 0.3)];
  });
}

const cache = new WeakMap<Airport, MarkingShape[]>();

/** Airfield paint in draw order, shared by the 2D and 3D renderers. */
export function airsideMarkings(airport: Airport): MarkingShape[] {
  const cached = cache.get(airport);
  if (cached) return cached;
  const incident = new Map<string, AirsideEdge[]>();
  const holdClearance = new Map(
    Object.values(airport.holdingPositions).map((hold) => [
      hold.node,
      hold.kind === 'runway' ? 1.25 : 0.35,
    ]),
  );
  const guides: MarkingShape[] = [];
  for (const edge of Object.values(airport.edges)) {
    for (const node of [edge.from, edge.to]) {
      const atNode = incident.get(node);
      if (atNode) atNode.push(edge);
      else incident.set(node, [edge]);
    }
    if (edge.kind === 'runway') continue;
    const from = holdClearance.get(edge.from) ?? 0;
    const to = holdClearance.get(edge.to) ?? 0;
    if (!from && !to) guides.push(line(edge.line, 0.3));
    else if (from + to < polylineLength(edge.line))
      guides.push(line(trimPolyline(edge.line, from, to), 0.3));
  }
  const paint = [
    ...Object.values(airport.runways).flatMap((runway) => runwayPaint(airport, runway)),
    ...pavementEdges(airport),
    ...guides,
    ...turnPadPaint(airport),
    ...holdingPaint(airport, incident),
  ];
  for (const stand of Object.values(airport.stands)) {
    if (!stand.ref) continue;
    const world = frame(stand.pos, stand.heading);
    const ref = stand.ref.toUpperCase();
    const height = 2.4;
    paint.push(line([world(0, -0.9), world(0, 0.9)], 0.3));
    paint.push(
      ...paintAirsideText(ref, height, world, 0, 1.35 + ref.length * height * 0.42, yellow),
    );
  }
  cache.set(airport, paint);
  return paint;
}
