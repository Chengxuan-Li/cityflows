import { withoutLotAisles } from '../without-lot-aisles';
import { areaD, booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import { expect, test } from 'vitest';
import {
  directionPairs,
  frame,
  joinAudit,
  laneFoldAudit,
  pairGapAudit,
  rayCrossings,
  roadWidthAudit,
  STEP_M,
  surfaceEdges,
} from '../../bench/geometry-audit';
import { auditCities, loadAuditCity, type AuditCity } from '../../bench/junction-audit';
import { cityTest, tierCities, unitTest } from '../tier';
import {
  cumulativeLengths,
  distance,
  nearestOnPolyline,
  pointAtDistance,
  vertexNormals,
} from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { compile, type CompiledCity, type CRoad, type Diagnostic } from '../../src/network';
import { offsetLine, referenceLine, type Reference } from '../../src/network/corridor';
import { roadWidth } from '../../src/network/lanes';
import type { City } from '../../src/schema';

// T35 (TASK-082, docs/plan.md "Geometry rework" stage 2): every lane, edge and taper is a
// parallel offset of its corridor's reference line by arc length.

const compiled = new Map<AuditCity, { city: City; net: CompiledCity; diagnostics: Diagnostic[] }>();
function load(name: AuditCity) {
  let entry = compiled.get(name);
  if (!entry) {
    const city = withoutLotAisles(loadAuditCity(name));
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 5)));
    compiled.set(name, (entry = { city, net: result.compiled, diagnostics: result.diagnostics }));
  }
  return entry;
}

/** `CRoad.reference` as a `Reference`, normals as the compiler takes them. */
const asReference = (road: CRoad): Reference => ({
  points: road.reference,
  lengths: cumulativeLengths(road.reference),
  normals: vertexNormals(road.reference),
  eased: [],
  needM: 0,
  reversed: false,
  source: 0,
});

const EASED_M = 0.02;
/** Stations within this of an eased stretch or a transition are left out of the width measure:
 * the audit's tangent is a chord over 1 m on either side. */
const PAD_M = 2;

/** The audit's width error (measure 1, its stations and rays along the canonical centerline),
 * outside the audit's transition zones, outside the stations where a lane leaves its nominal
 * offset from the road's reference by more than 1 cm (TASK-071/080 transitions, including the
 * side-by-side branches the audit does not classify), and away from eased stretches (where the
 * reference leaves the source centerline by more than `EASED_M`). */
function widthOutsideTransitions(city: City, net: CompiledCity, road: CRoad) {
  const source = city.roads[road.id]!;
  const center = source.centerline;
  const lengths = cumulativeLengths(center);
  const width = roadWidth(source);
  const expected = {
    left: source.lateralOffsetM - width / 2,
    right: source.lateralOffsetM + width / 2,
  };
  const reference = asReference(road);
  const stations = Array.from(road.stations);
  const moving: [number, number][] = [];
  let edge = expected.left;
  road.lanes.forEach((index, i) => {
    const lane = net.lanes[index]!;
    const nominal = edge + source.lanes[i]!.widthM / 2;
    edge += source.lanes[i]!.widthM;
    offsetLine(reference, stations, nominal).forEach((p, k) => {
      if (distance(p, lane.polyline[k]!) > 0.01)
        moving.push([
          stations[Math.max(0, k - 1)]!,
          stations[Math.min(stations.length - 1, k + 1)]!,
        ]);
    });
  });
  const [left, right] = surfaceEdges(road);
  const { audit } = roadWidthAudit(city, net, road);
  const mid = (a: Vec2, b: Vec2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const s0 = nearestOnPolyline(center, mid(left[0]!, right[0]!)).along;
  const s1 = nearestOnPolyline(center, mid(left.at(-1)!, right.at(-1)!)).along;
  const samples: { s: number; p: Vec2; n: Vec2; along: number }[] = [];
  const eased: number[] = [];
  for (let s = 0; s <= lengths.at(-1)!; s += STEP_M) {
    const { p, n } = frame(center, lengths, s);
    const near = nearestOnPolyline(road.reference, p);
    if (near.away > EASED_M) eased.push(s);
    else samples.push({ s, p, n, along: near.along });
  }
  let worst = { errorM: 0, atM: 0 },
    skipped = 0;
  for (const { s, p, n, along } of samples) {
    // TASK-131: a cut on a sampled station (r:15 at 2.5 m) is the edge's end, not a width.
    if (s <= s0 + 1e-6 || s >= s1 - 1e-6 || s - s0 <= audit.zones[0] || s1 - s <= audit.zones[1])
      continue;
    if (
      eased.some((e) => Math.abs(e - s) <= PAD_M) ||
      moving.some(([a, b]) => along >= a - PAD_M && along <= b + PAD_M)
    ) {
      skipped++;
      continue;
    }
    for (const [side, line] of [
      ['left', left],
      ['right', right],
    ] as const) {
      const target = expected[side];
      const hits = rayCrossings(p, n, line, Math.abs(target) + width + 2);
      const hit = hits.reduce<number | null>(
        (best, v) => (best === null || Math.abs(v - target) < Math.abs(best - target) ? v : best),
        null,
      );
      const error =
        hit === null
          ? Math.abs(nearestOnPolyline(line, p).away - Math.abs(target))
          : Math.abs(hit - target);
      if (error > worst.errorM) worst = { errorM: error, atM: s };
    }
  }
  return { ...worst, skipped };
}

test.each(tierCities(auditCities))(
  'T35.1: %s corridors keep their width and centre line, and no lane folds',
  (name) => {
    const { city, net } = load(name);
    const folds = net.lanes
      .map((lane) => laneFoldAudit(city, net, lane))
      .filter((f) => f.backSteps || f.crossings || f.cusps)
      .map((f) => f.lane);
    expect(folds).toEqual([]);

    const widths = net.roads.map((road) => ({
      road: road.id,
      ...widthOutsideTransitions(city, net, road),
    }));
    const over = widths.filter((w) => w.errorM >= 0.05).map((w) => `${w.road}@${w.atM}`);
    expect(over).toEqual([]);

    // Gap: the two directions of a street (one `streetGroupId`) drawn on one centerline. Opposite
    // carriageways the source draws on one line without a street (Marsstraße, TASK-084's case)
    // and directions with centerlines of their own are counted and left out.
    const pairs = directionPairs(city, net);
    const shared = pairs.filter(({ a, b, kind }) => {
      const ca = city.roads[a.id]!.centerline,
        cb = [...city.roads[b.id]!.centerline].reverse();
      return (
        kind === 'two-way' &&
        ca.length === cb.length &&
        ca.every((p, i) => distance(p, cb[i]!) < 1e-6)
      );
    });
    const gaps = shared.map(({ a, b, kind }) =>
      pairGapAudit(net, a, b, kind, roadWidthAudit(city, net, a).audit.zones),
    );
    // TASK-087: Sindelfingen's r:585/r:586 continues at n:580 into the unnamed pair r:582/r:583,
    // now pushed apart side by side with a 0.5 m median; the median eases in over r:585's taper,
    // parting its two directions by 4 cm 11 m from the node.
    const parting = gaps
      .filter((g) => {
        // TASK-101 keeps way 332200797 (14.59 m) before the private divided pair at n:581.
        // Its two-way link parts by 0.245 m while approaching the pair's 0.5 m median.
        if (name === 'sindelfingen' && g.roads === 'r:592/r:593') {
          expect(g.maxM).toBeLessThanOrEqual(0.246);
          return false;
        }
        return g.maxM >= 0.02 && g.roads !== 'r:585/r:586';
      })
      .map((g) => `${g.roads} ${g.maxM}`);
    expect(parting).toEqual([]);
    console.info(
      name,
      `width outside transitions and easings ${Math.max(0, ...widths.map((w) => w.errorM)).toFixed(3)} m`,
      `(${widths.reduce((sum, w) => sum + w.skipped, 0)} stations left out);`,
      `gap ${Math.max(0, ...gaps.map((g) => g.maxM)).toFixed(3)} m over ${gaps.length} pairs,`,
      `${pairs.length - shared.length} pairs without one centerline left out`,
    );
  },
  300_000,
);

cityTest(
  'T35.1: G1, the hairpin service roads, keep their width and centre line',
  () => {
    const { city, net } = load('munich');
    const at = (id: string) => net.roads[net.index.road.get(id as never)!]!;
    // Outside the eases at n:919 and n:355 (joints of 15 degrees in the source, eased over
    // about 16 m to share the node's tangent, about 0.4 m off the centerline).
    for (const id of ['r:917', 'r:921', 'r:1059', 'r:1060'])
      expect(widthOutsideTransitions(city, net, at(id)).errorM, id).toBeLessThan(0.05);
    for (const [a, b] of [
      ['r:917', 'r:921'],
      ['r:1059', 'r:1060'],
    ] as const) {
      const gap = pairGapAudit(net, at(a), at(b), 'two-way', [0, 0]);
      expect(gap.maxM, `${a}/${b}`).toBeLessThan(0.02);
    }
  },
  120_000,
);

cityTest(
  'T35.1: at G1 n:919 the two streets share one tangent: no gap, no kink',
  () => {
    const { net } = load('munich');
    const node = net.nodes[net.index.node.get('n:919' as never)!]!;
    expect(node.outline).toEqual([]);
    const through = node.movements.map((i) => net.movements[i]!);
    expect(through.length).toBe(2);
    for (const m of through) {
      const from = net.lanes[m.fromLane]!,
        to = net.lanes[m.toLane]!;
      // The lane ends meet, and so do the edges either side of them.
      expect(distance(from.polyline.at(-1)!, to.polyline[0]!)).toBeLessThan(1e-9);
      const heading = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);
      const turn =
        heading(to.polyline[0]!, to.polyline[1]!) -
        heading(from.polyline.at(-2)!, from.polyline.at(-1)!);
      expect((Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) * 180) / Math.PI).toBeLessThan(
        2,
      );
      const [la, ra] = surfaceEdges(net.roads[from.road]!),
        [lb, rb] = surfaceEdges(net.roads[to.road]!);
      expect(distance(la.at(-1)!, lb[0]!)).toBeLessThan(1e-9);
      expect(distance(ra.at(-1)!, rb[0]!)).toBeLessThan(1e-9);
    }
    expect(joinAudit(net, node)!.maxM).toBeLessThanOrEqual(0.05);
  },
  120_000,
);

test.each(tierCities(auditCities))(
  'T35.1: %s road surfaces are simple and corridor surfaces are their clean union',
  (name) => {
    const { net } = load(name);
    const overlapping: string[] = [];
    for (const road of net.roads) {
      const union = booleanOpD(ClipType.Union, [road.surface], null, FillRule.NonZero, 4);
      const perimeter = cumulativeLengths([...road.surface, road.surface[0]!]).at(-1)!;
      const lost = Math.abs(
        Math.abs(areaD(road.surface)) - union.reduce((s, r) => s + areaD(r), 0),
      );
      if (union.length !== 1 || lost > 1e-4 * perimeter) overlapping.push(road.id);
    }
    expect(overlapping).toEqual([]);
    for (const road of net.roads) {
      // The union is rounded to the millimetre.
      const own = Math.abs(areaD(road.surface));
      const perimeter = cumulativeLengths([...road.surface, road.surface[0]!]).at(-1)!;
      const corridor = road.corridorSurface.reduce((s, r) => s + areaD(r), 0);
      expect(corridor).toBeGreaterThanOrEqual(own - 1e-3 * perimeter);
      expect(net.roads.filter((r) => r.corridorSurface === road.corridorSurface).length).toBe(
        net.roads.filter((r) => (r.corridorId ?? r.id) === (road.corridorId ?? road.id)).length,
      );
    }
  },
  120_000,
);

/** TASK-089: reference ends that move farther than 2 m, each with the tolerance it had. Through
 * alignments of a converging flow (the owner's n:104 rule: the carriageway passing a converging
 * node runs on straight, so its continuation's reference ends where the through line meets the
 * node, half the corridor separation off the node point), and B43 far through alignments whose
 * cuts grow by at most 2 m (`farThrough`), which may move an end a little past 2 m. Recorded on
 * main 5568eed. TASK-090: a budget, not per end: at most 15 percent more ends than recorded move
 * farther than 2 m, none farther than 6.5 m. */
const farther: Record<string, number> = {
  // Munich, converging flows: n:104 r:644 > r:1308; n:1181 r:729 and r:984 > r:1358; n:33
  // r:944 > r:948.
  'munich r:644:end': 5,
  'munich r:1308:start': 5,
  'munich r:729:end': 5,
  'munich r:984:end': 5,
  'munich r:1358:start': 5,
  'munich r:944:end': 6.5,
  'munich r:948:start': 6.5,
  // Far through alignments: Munich n:635 r:934 > r:699; Sindelfingen n:658 r:1033 > r:1035 and
  // n:81 r:82 > r:86.
  'munich r:934:end': 2.5,
  'munich r:699:start': 2.5,
  'sindelfingen r:1033:end': 2.5,
  'sindelfingen r:1035:start': 2.5,
  'sindelfingen r:82:end': 2.5,
  'sindelfingen r:86:start': 2.5,
};

test.each(tierCities(auditCities))(
  'T35.2: %s reference lines keep their endpoints and stay within 5 cm of the source unless eased',
  (name) => {
    const { city, net, diagnostics } = load(name);
    const noted = new Set(
      diagnostics.filter((d) => d.code === 'reference_eased').flatMap((d) => d.refs),
    );
    const failures: string[] = [];
    const movedFar: string[] = [];
    let easedRoads = 0;
    for (const road of net.roads) {
      const source = city.roads[road.id]!.centerline;
      // TASK-083: at a junction a through road keeps its alignment, so within 20 m of the node
      // (at most half the road) its reference line may leave the source by up to 2 m and no
      // longer end at the node point.
      const lengths = cumulativeLengths(source);
      const total = lengths.at(-1)!;
      const aligned = [false, true].map((atEnd) => {
        const [p, q] = atEnd
          ? [road.reference.at(-1)!, source.at(-1)!]
          : [road.reference[0]!, source[0]!];
        if (distance(p, q) <= 1e-9) return false;
        const node = net.nodes[atEnd ? road.to : road.from]!;
        const end = `${name} ${road.id}:${atEnd ? 'end' : 'start'}`;
        if (!node.outline.length || distance(p, q) > 6.5 + 1e-9)
          failures.push(`${road.id}: ${atEnd ? 'end' : 'start'} moved`);
        else if (distance(p, q) > 2 + 1e-9) movedFar.push(end);
        return true;
      });
      const reach = Math.min(20, total / 2) + 0.5;
      const deviation = Math.max(
        0,
        ...source
          .filter(
            (_, i) =>
              !(aligned[0] && lengths[i]! < reach) && !(aligned[1] && total - lengths[i]! < reach),
          )
          .map((p) => nearestOnPolyline(road.reference, p).away),
      );
      if (deviation > 0.05) {
        easedRoads++;
        if (!noted.has(road.id)) failures.push(`${road.id}: ${deviation.toFixed(3)} m, no note`);
      }
    }
    expect(failures).toEqual([]);
    const recorded = Object.keys(farther).filter((end) => end.startsWith(`${name} `));
    expect(movedFar.length).toBeLessThanOrEqual(Math.floor(1.15 * recorded.length));
    console.info(name, `${easedRoads} roads eased beyond 5 cm, each noted`, {
      notRecorded: movedFar.filter((end) => !recorded.includes(end)),
    });
  },
  120_000,
);

test.each(tierCities(auditCities))(
  'T35.3: %s lanes at 25, 50 and 75 percent map to the reference station within 0.1 m',
  (name) => {
    const { city, net } = load(name);
    const failures: string[] = [];
    let checked = 0,
      inTransition = 0;
    for (const road of net.roads) {
      const source = city.roads[road.id]!;
      const reference = asReference(road);
      const stations = Array.from(road.stations);
      let edge = source.lateralOffsetM - roadWidth(source) / 2;
      for (const [i, index] of road.lanes.entries()) {
        const lane = net.lanes[index]!;
        const nominal = edge + source.lanes[i]!.widthM / 2;
        edge += source.lanes[i]!.widthM;
        expect(lane.polyline.length).toBe(stations.length);
        const placed = offsetLine(reference, stations, nominal);
        for (const fraction of [0.25, 0.5, 0.75]) {
          const at = fraction * lane.lengthM;
          let k = 1;
          while (k < lane.polyline.length - 1 && lane.cumulative[k]! < at) k++;
          // Inside a TASK-071/080 transition the lane follows its block's line, not its offset.
          if (
            distance(placed[k - 1]!, lane.polyline[k - 1]!) > 0.01 ||
            distance(placed[k]!, lane.polyline[k]!) > 0.01
          ) {
            inTransition++;
            continue;
          }
          checked++;
          const span = lane.cumulative[k]! - lane.cumulative[k - 1]!;
          const t = span > 0 ? (at - lane.cumulative[k - 1]!) / span : 0;
          const station = stations[k - 1]! + t * (stations[k]! - stations[k - 1]!);
          const p = pointAtDistance(lane.polyline, lane.cumulative, at);
          // Searched near the station, so a hairpin's other arm is never taken.
          const lengths = reference.lengths;
          const from = Math.max(0, station - 20),
            to = Math.min(lengths.at(-1)!, station + 20);
          const window = [
            pointAtDistance(road.reference, lengths, from),
            ...road.reference.filter((_, j) => lengths[j]! > from && lengths[j]! < to),
            pointAtDistance(road.reference, lengths, to),
          ];
          const found = from + nearestOnPolyline(window, p).along;
          if (Math.abs(found - station) > 0.1)
            failures.push(`${lane.id} ${fraction}: ${station.toFixed(2)} -> ${found.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
    console.info(name, `${checked} lane stations checked, ${inTransition} inside transitions`);
  },
  120_000,
);

/** Lane-offset folds of a reference: offsets up to `need` on either side step backwards. */
function folds(points: Vec2[], need: number) {
  const reference: Reference = {
    points,
    lengths: cumulativeLengths(points),
    normals: vertexNormals(points),
    eased: [],
    needM: need,
    reversed: false,
    source: 0,
  };
  let count = 0;
  for (const lateral of [-need, need]) {
    const line = offsetLine(reference, [...reference.lengths], lateral);
    for (let i = 1; i < line.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      const step =
        (line[i]!.x - line[i - 1]!.x) * (b.x - a.x) + (line[i]!.y - line[i - 1]!.y) * (b.y - a.y);
      if (step <= 0) count++;
    }
  }
  return count;
}

unitTest(
  'T35.2: a right-angle corner is eased to the offset plus a margin, a gentle arc only resampled',
  () => {
    const corner = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
    ];
    const sharp = referenceLine(corner, 3, 3);
    expect(sharp.points[0]).toEqual(corner[0]);
    expect(sharp.points.at(-1)).toEqual(corner[2]);
    expect(sharp.eased).toHaveLength(1);
    // A 3.25 m arc in a right angle passes 3.25 (sqrt 2 - 1) m inside the corner (its chords a
    // few millimetres more).
    expect(sharp.eased[0]!.radiusM).toBeCloseTo(3.25, 6);
    expect(Math.abs(sharp.eased[0]!.deviationM - 3.25 * (Math.SQRT2 - 1))).toBeLessThan(0.01);
    expect(folds(sharp.points, 3)).toBe(0);

    // A radius-12 m quarter circle sampled every 0.3 m, with millimetre back-steps.
    const arc: Vec2[] = [];
    for (let s = 0; s <= 6 * Math.PI; s += 0.3) {
      arc.push({ x: 12 * Math.sin(s / 12), y: 12 - 12 * Math.cos(s / 12) });
      arc.push({ x: 12 * Math.sin(s / 12) - 0.001, y: 12 - 12 * Math.cos(s / 12) });
    }
    const gentle = referenceLine(arc, 3, 3);
    expect(gentle.eased).toEqual([]);
    expect(gentle.points[0]).toEqual(arc[0]);
    expect(gentle.points.at(-1)).toEqual(arc.at(-1));
    expect(gentle.points.length).toBeLessThan(arc.length / 4);
    const lengths = cumulativeLengths(gentle.points);
    for (let i = 1; i < gentle.points.length; i++)
      expect(lengths[i]! - lengths[i - 1]!).toBeLessThanOrEqual(1 + 1e-9);
    for (const p of arc) expect(nearestOnPolyline(gentle.points, p).away).toBeLessThan(0.02);
    expect(folds(gentle.points, 3)).toBe(0);
  },
);
