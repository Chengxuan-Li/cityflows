import { readFileSync } from 'node:fs';
import { importOsmCached } from '../../bench/city-cache';
import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { continuity } from '../../src/fixtures/continuity';
import {
  cumulativeLengths,
  distance,
  offsetPolyline,
  pointAtDistance,
  preparePolygon,
  segmentsIntersect,
} from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { compile, type CompiledCity, type CRoad } from '../../src/network';
import { separation } from '../../src/network/continuity';
import { seams } from '../../src/render/layers/transitions';
import type { City } from '../../src/schema';
import { cityTest, tierCities, unitTest } from '../tier';

function compiled(city: City): CompiledCity {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

const roadOf = (net: CompiledCity, id: string) => net.roads[net.index.road.get(id as never)!]!;

/** Distance from a road's start at which every lane is back on its own offset for good. */
function settled(net: CompiledCity, road: CRoad, own: Vec2[], atEnd = false): number {
  const lane = net.lanes[road.lanes[0]!]!;
  const points = atEnd ? [...lane.polyline].reverse() : lane.polyline;
  const lengths = cumulativeLengths(points);
  const near = (p: Vec2) => {
    let best = Infinity;
    for (let i = 1; i < own.length; i++) {
      const a = own[i - 1]!,
        b = own[i]!;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
      );
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return best;
  };
  let last = 0;
  points.forEach((p, i) => {
    if (near(p) > 0.01) last = lengths[i]!;
  });
  return last;
}

unitTest('T33.1: tapers are short and scaled by speed, at most half the road', () => {
  // Widenings (an added lane) and narrowings (a dropped lane) at 50 and 100 km/h, and on a road
  // shorter than twice the 50 km/h taper.
  const { city, node, road } = buildCity('Taper lengths', 1);
  const cases: [string, number, number, number][] = [];
  for (const [y, kmh, length] of [
    [0, 50, 180],
    [100, 100, 180],
    [200, 50, 30],
  ] as const) {
    const seam = node(0, y);
    road(node(-180, y), seam, { lanes: 1, speedKmh: kmh });
    cases.push([road(seam, node(length, y), { lanes: 2, speedKmh: kmh }).id, kmh, length, 0]);
    const drop = node(0, y + 50);
    cases.push([road(node(-length, y + 50), drop, { lanes: 2, speedKmh: kmh }).id, kmh, length, 1]);
    road(drop, node(180, y + 50), { lanes: 1, speedKmh: kmh });
  }
  const net = compiled(city);
  const expected = { 50: 20, 100: 40 } as Record<number, number>;
  for (const [id, kmh, length, dropped] of cases) {
    const lanes = roadOf(net, id).lanes.map((i) => net.lanes[i]!);
    const taper = Math.min(length / 2, expected[kmh]!);
    if (dropped)
      expect(lanes.map((l) => l.taperEndM)).toEqual([0, taper].map((t) => expect.closeTo(t, 6)));
    else
      expect(lanes.map((l) => l.taperStartM)).toEqual([0, taper].map((t) => expect.closeTo(t, 6)));
  }

  // A branch offset: a 4-lane trunk splitting 2 + 2 at 25 degrees. The branches keep their
  // slices until their own lane blocks part, then ease onto their own offsets over the taper.
  for (const kmh of [50, 100]) {
    const split = buildCity('Branch taper', 1);
    const at = split.node(0, 0);
    split.road(split.node(-200, 0), at, { lanes: 4, roadClass: 'primary', speedKmh: kmh });
    const left = split.road(at, split.node(300, -140), {
      lanes: 2,
      roadClass: 'primary',
      speedKmh: kmh,
    });
    const right = split.road(at, split.node(300, 140), {
      lanes: 2,
      roadClass: 'primary',
      speedKmh: kmh,
    });
    const net = compiled(split.city);
    const hold = separation({ source: left, atEnd: false }, { source: right, atEnd: false });
    expect(hold).toBeGreaterThan(5);
    for (const branch of [left, right]) {
      const r = roadOf(net, branch.id);
      expect(r.startOffsetM).not.toBe(0);
      const own = offsetPolyline(branch.centerline, -1.75);
      // Lane 0 sits 1.75 m left of the branch centre once settled; the projection along the
      // diverging road shortens the distance slightly.
      expect(settled(net, r, own)).toBeGreaterThan(hold + expected[kmh]! - 1.5);
      expect(settled(net, r, own)).toBeLessThanOrEqual(hold + expected[kmh]! + 0.5);
    }
  }
});

/** Turns sharper than 5 degrees at lane vertices that are not at a source centerline corner: a
 * heading jump, not the curvature of a taper sampled every 0.5 m. */
function kinks(net: CompiledCity, city: City, roads: CRoad[]) {
  const found: string[] = [];
  for (const road of roads) {
    const corners = city.roads[road.id]!.centerline.slice(1, -1);
    for (const index of road.lanes) {
      const lane = net.lanes[index]!;
      const p = lane.polyline;
      for (let i = 1; i < p.length - 1; i++) {
        const a = Math.atan2(p[i]!.y - p[i - 1]!.y, p[i]!.x - p[i - 1]!.x),
          b = Math.atan2(p[i + 1]!.y - p[i]!.y, p[i + 1]!.x - p[i]!.x);
        const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
        if (turn < (5 * Math.PI) / 180) continue;
        if (corners.some((c) => distance(c, p[i]!) < lane.widthM * 2 + 2)) continue;
        found.push(`${lane.id}@${i}`);
      }
    }
  }
  return found;
}

function selfIntersections(net: CompiledCity, roads: CRoad[]) {
  const found: string[] = [];
  for (const lane of roads.flatMap((r) => r.lanes.map((i) => net.lanes[i]!)))
    for (let i = 1; i < lane.polyline.length; i++)
      for (let j = i + 2; j < lane.polyline.length; j++)
        if (
          segmentsIntersect(
            lane.polyline[i - 1]!,
            lane.polyline[i]!,
            lane.polyline[j - 1]!,
            lane.polyline[j]!,
          )
        )
          found.push(lane.id);
  return [...new Set(found)];
}

const munich = () => {
  const imported = importOsmCached(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), {
    importerVersion: 'test',
    bbox: [11.525, 48.135, 11.545, 48.148],
  });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  return imported.city;
};

test('T33.2: transition lanes never cross themselves and keep a continuous heading', () => {
  for (const city of tierCities(['continuity', 'munich']).map((name) =>
    name === 'munich' ? munich() : continuity(),
  )) {
    const net = compiled(city);
    const transitions = net.roads.filter(
      (r) =>
        r.startOffsetM ||
        r.endOffsetM ||
        r.lanes.some((i) => net.lanes[i]!.taperStartM || net.lanes[i]!.taperEndM),
    );
    expect(transitions.length).toBeGreaterThan(3);
    // r:1308#0 folds within its first 0.2 m at n:104 (its far end from the n:643 widening), as
    // on main: the offset of a sharp source corner, not a transition.
    // TASK-131 keeps OSM geometry: smoothing leaves the vertices within 30 m of a node, so lanes
    // offset from sharp source corners fold there. r:728#0 (Landsberger Straße, -3.5 m, the OSM
    // curve into n:474 with vertices 2 m apart) backs up 0.34 m and 0.15 m 18 to 20 m in;
    // r:256#0 (Trappentreustraße, 1.5 m start offset, a corner 19.8 m from n:207) repeats a
    // vertex at 16.5 m, a zero-length step rather than a visible fold.
    const folds = ['r:1308#0', 'r:728#0', 'r:256#0'];
    expect(selfIntersections(net, transitions).filter((id) => !folds.includes(id))).toEqual([]);
    // TASK-131 keeps OSM geometry: tapers and shifts squeezed into roads between OSM nodes main
    // merged into one turn more than 5 degrees per vertex: Westendstraße r:1284 (16.6 m, n:841 to
    // n:1282, a 10.7 m taper), Hansastraße r:1287 (8.2 m, n:1285 to n:1286, 5.3 m) and
    // Arnulfstraße r:700 (8 m, n:52 to n:695, jg:10778's inner road, a 1.75 m end shift).
    const squeezed = ['r:1284#2', 'r:1287#1', 'r:700#0', 'r:700#1'];
    expect(
      kinks(net, city, transitions).filter((id) => !squeezed.includes(id.split('@')[0]!)),
    ).toEqual([]);
  }
}, 60_000);

/** m², unique 0.25 m cells inside both road surfaces. */
function overlapM2(a: Vec2[], b: Vec2[]) {
  const inA = preparePolygon([...a, a[0]!], 0),
    inB = preparePolygon([...b, b[0]!], 0);
  const box = (r: Vec2[]) => [
    Math.min(...r.map((p) => p.x)),
    Math.min(...r.map((p) => p.y)),
    Math.max(...r.map((p) => p.x)),
    Math.max(...r.map((p) => p.y)),
  ];
  const [ax0, ay0, ax1, ay1] = box(a),
    [bx0, by0, bx1, by1] = box(b);
  let cells = 0;
  for (let x = Math.max(ax0!, bx0!) + 0.0123; x < Math.min(ax1!, bx1!); x += 0.25)
    for (let y = Math.max(ay0!, by0!) + 0.0371; y < Math.min(ay1!, by1!); y += 0.25)
      if (inA({ x, y }) && inB({ x, y })) cells++;
  return cells * 0.0625;
}

// TASK-080 (B36): every Munich split or merge where two road surfaces overlapped, measured on
// main (5024a83) with the same cell count: the pair (left then right in travel direction), the
// overlap before, and the most it may be now. None of these nodes shares a trunk lane between
// its branches, so the whole overlap lies outside a shared lane block.
const munichCases: [string, string, string, number, number][] = [
  // Not continuation nodes: side-by-side blocks, junction and movements kept.
  ['n:305', 'r:1188', 'r:676', 58.8, 1], // absorbing merge 3 + 2 into 4 (owner's screen 5)
  ['n:308', 'r:310', 'r:674', 53.4, 1], // split 4 into 3 + 2, crossing lane rules
  ['n:312', 'r:692', 'r:706', 71.6, 1], // split 4 into 2 + 2, crossing lane rules (screen 4)
  // Split 3 into 1 + 2, 31 degrees off the trunk. TASK-131 keeps OSM geometry: the left branch
  // (way 151912581, main's r:729) is r:728 and runs to n:474 instead of main's merged n:1181.
  ['n:726', 'r:728', 'r:984', 59.1, 1],
  ['n:253', 'r:321', 'r:254', 13.1, 1], // split 2 into 1 + 2
  ['n:28', 'r:663', 'r:29', 2.2, 1], // absorbing merge 2 + 1 into 2
  // r:1275 begins at a continuation widening (n:731) 56 m away: the side-by-side run gets half
  // the road and the branches part beyond it.
  ['n:201', 'r:730', 'r:1275', 54.5, 30],
  // Continuation nodes. n:194: the ramp r:196 leaves on the trunk's right lane, where r:416
  // gains its added lane over the same metres, and its own line stays within r:416's lane block
  // for all of its 45 m (no lane to share, nothing to part from); not changed by TASK-080.
  // TASK-082: 92.1 m2 with the edges offset from the corridor reference line. TASK-131: 97.3 m2,
  // as the importer now sets r:416 apart from a carriageway (provenance `separated`, main has
  // none), up to 0.9 m toward the ramp; both lanes keep their lengths within 0.2 m.
  ['n:194', 'r:416', 'r:196', 90.1, 97.5],
  // TASK-082: 7.1 m2 at n:734 with the edges offset from the corridor reference.
  ['n:734', 'r:1189', 'r:735', 31.5, 7.5],
];

cityTest(
  'T33.3: Munich splits and merges run side by side with dividers to where they part',
  () => {
    const net = compiled(munich());
    const report: Record<string, { before: number; after: number; dividerM: number }> = {};
    for (const [node, leftId, rightId, before, limit] of munichCases) {
      const left = roadOf(net, leftId),
        right = roadOf(net, rightId);
      const n = net.index.node.get(node as never)!;
      expect([left.from, left.to]).toContain(n);
      expect([right.from, right.to]).toContain(n);
      const after = overlapM2(left.surface, right.surface);
      const seam = seams(net, left).filter((s) =>
        right.lanes.some((i) => {
          const lane = net.lanes[i]!;
          const edge = offsetPolyline(lane.polyline, -lane.widthM / 2);
          return (
            edge.some((q) => distance(q, s[0]!) < 1) || edge.some((q) => distance(q, s.at(-1)!) < 1)
          );
        }),
      );
      const dividerM = seam.reduce((sum, s) => sum + cumulativeLengths(s).at(-1)!, 0);
      report[node] = { before, after: Math.round(after * 10) / 10, dividerM: Math.round(dividerM) };
      expect(after, node).toBeLessThanOrEqual(limit);
      if (node === 'n:194') continue;
      // A divider runs between the two blocks from the junction (or the node) to where they part
      // (at n:201 within 2 m of the junction, see above). TASK-131 keeps n:28 at its OSM position
      // (main moved it 4.4 m into a merged node), so r:29 and r:663 meet at 28 degrees, not 22,
      // and part 1.5 m beyond the junction cut.
      expect(dividerM, node).toBeGreaterThan(['n:201', 'n:28'].includes(node) ? 1 : 5);
      const leftLanes = left.lanes.map((i) => net.lanes[i]!);
      const atNode = left.to === n;
      for (const s of seam) {
        // Past the divider's far end the two edges are apart.
        const last = leftLanes.at(-1)!;
        const edge = offsetPolyline(last.polyline, last.widthM / 2);
        const lengths = cumulativeLengths(edge);
        const end = atNode ? s[0]! : s.at(-1)!;
        const index = edge.findIndex((q) => distance(q, end) < 1e-9);
        const beyond = pointAtDistance(
          edge,
          lengths,
          Math.max(0, Math.min(lengths.at(-1)!, lengths[index]! + (atNode ? -3 : 3))),
        );
        const rightLane = net.lanes[right.lanes[0]!]!;
        const rightEdge = offsetPolyline(rightLane.polyline, -rightLane.widthM / 2);
        const gap = Math.min(...rightEdge.map((q) => distance(q, beyond)));
        if (index > 0 && index < edge.length - 1) expect(gap, node).toBeGreaterThan(0.1);
      }
    }
    console.info('T33.3 overlap m2 before/after and divider m', report);
  },
  60_000,
);
