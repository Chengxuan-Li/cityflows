import { expect, test } from 'vitest';
import {
  auditGeometry,
  joinAudit,
  junctionShapeAudit,
  laneFoldAudit,
  markingAudit,
  markingLines,
  roadWidthAudit,
  surfaceEdges,
  throughAudit,
  totals,
  unrelatedOverlaps,
  directionPairs,
  pairGapAudit,
} from '../../bench/geometry-audit';
import { buildCity } from '../../src/fixtures/build-city';
import { cumulativeLengths } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { compile, type CompiledCity, type CRoad } from '../../src/network';
import type { City } from '../../src/schema';

/** A straight two-way secondary street west to east with a degree-two node `k` on it (a through
 * join), a tertiary side street south from `m` (a T), and an unrelated one-way road 40 m north. */
function fixture() {
  const { city, node, road } = buildCity('T34', 1);
  const w = node(-100, 0),
    k = node(-50, 0),
    m = node(0, 0),
    e = node(100, 0),
    s = node(0, 100),
    p = node(-100, -40),
    q = node(100, -40);
  const two = (a: typeof w, b: typeof w, roadClass: 'secondary' | 'tertiary', group: string) => [
    road(a, b, { roadClass, streetGroupId: group }),
    road(b, a, { roadClass, streetGroupId: group }),
  ];
  const [wk] = two(w, k, 'secondary', 'g:wk');
  const [km] = two(k, m, 'secondary', 'g:km');
  const [me, em] = two(m, e, 'secondary', 'g:east');
  two(m, s, 'tertiary', 'g:side');
  const pq = road(p, q, { roadClass: 'secondary' });
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const net = result.compiled;
  const at = (id: string) => net.roads[net.index.road.get(id as never)!]!;
  return {
    city: city as City,
    net,
    wk: at(wk!.id),
    km: at(km!.id),
    me: at(me!.id),
    em: at(em!.id),
    pq: at(pq.id),
    k: net.nodes[net.index.node.get(k.id)!]!,
    m: net.nodes[net.index.node.get(m.id)!]!,
  };
}

const shift = (points: Vec2[], dx: number, dy: number) =>
  points.map((p) => ({ x: p.x + dx, y: p.y + dy }));

function relayLanes(net: CompiledCity, road: CRoad, dx: number, dy: number) {
  for (const i of road.lanes) {
    const lane = net.lanes[i]!;
    lane.polyline = shift(lane.polyline, dx, dy);
    lane.cumulative = cumulativeLengths(lane.polyline);
  }
}

test('T34.0: every measure is zero on clean geometry', () => {
  const { city, net } = fixture();
  const audit = auditGeometry(city, net);
  const t = totals(audit);
  console.info('T34.0', t);
  for (const key of [
    'widthMaxM',
    'gapMaxM',
    'foldBackSteps',
    'foldCrossings',
    'foldCusps',
    'throughFarM',
    'throughNearM',
    'throughLaneM',
    'overlapM2',
    'junctionSelfX',
    'bulgeM2',
    'joinGapMaxM',
    'markingMaxM',
  ] as const)
    expect(t[key], key).toBe(0);
  // Every measure saw something: the street's pairs, the T, the through join, the markings.
  expect(t.gapPairs).toBeGreaterThanOrEqual(3);
  expect(t.throughNodes).toBe(1);
  expect(audit.joins.map((j) => j.joins)).toEqual([2]);
  // The T is the one junction with a curb radius; the four dead ends' caps are not junctions.
  expect(audit.junctions.filter((j) => j.radiusM > 0).map((j) => j.radiusM)).toEqual([9]);
  // Centre lines on the eight two-way roads; the one-way single lane has none.
  expect(audit.markings.filter((m) => m.lines > 0).length).toBe(8);
  expect(audit.widths.every((w) => w.samples > 0)).toBe(true);
});

test('T34.1: a road whose surface is built too narrow', () => {
  const { city, net, wk } = fixture();
  // Right of travel (east) is +y: the outer edge moves 0.5 m in.
  const [left, right] = surfaceEdges(wk);
  wk.surface = [...left, ...shift(right, 0, -0.5).reverse()];
  const { audit } = roadWidthAudit(city, net, wk);
  expect(audit.maxM).toBeCloseTo(0.5, 6);
  expect(audit.side).toBe('right');
  expect(audit.p95M).toBeCloseTo(0.5, 6);
});

test('T34.2: the two directions’ centre lines parting', () => {
  const { city, net, wk } = fixture();
  const pair = directionPairs(city, net).find((p) => p.a === wk || p.b === wk)!;
  expect(pairGapAudit(net, pair.a, pair.b, pair.kind, [0, 0]).maxM).toBe(0);
  // The westbound direction moves 0.3 m north, away from the eastbound one.
  const westbound = pair.a === wk ? pair.b : pair.a;
  relayLanes(net, westbound, 0, -0.3);
  const gap = pairGapAudit(net, pair.a, pair.b, pair.kind, [0, 0]);
  expect(gap.maxM).toBeCloseTo(0.3, 6);
  expect(gap.signedM).toBeCloseTo(0.3, 6);
  relayLanes(net, westbound, 0, 0.6);
  expect(pairGapAudit(net, pair.a, pair.b, pair.kind, [0, 0]).signedM).toBeCloseTo(-0.3, 6);
});

test('T34.3: a folded lane', () => {
  const { city, net, km } = fixture();
  const lane = net.lanes[km.lanes[0]!]!;
  expect(laneFoldAudit(city, net, lane)).toMatchObject({ backSteps: 0, crossings: 0, cusps: 0 });
  const [start, end] = [lane.polyline[0]!, lane.polyline.at(-1)!];
  const y = start.y;
  // Forward to x -20, a zigzag back to -29 that crosses its own first leg, then on.
  lane.polyline = [
    start,
    { x: -30, y },
    { x: -26, y: y + 1 },
    { x: -28, y: y - 1 },
    { x: -29, y: y + 1 },
    { x: -20, y },
    end,
  ];
  const fold = laneFoldAudit(city, net, lane);
  expect(fold.backSteps).toBe(1);
  expect(fold.backStepM).toBeCloseTo(3, 1);
  expect(fold.crossings).toBeGreaterThan(0);
  expect(fold.cusps).toBeGreaterThan(0);
});

test('T34.4: a through road’s far edge bulging across the junction', () => {
  const { city, net, m } = fixture();
  expect(throughAudit(city, net, m)).toMatchObject({ farM: 0, nearM: 0, laneM: 0 });
  // The outline's north edge (the far side; the side street leaves south) moves 1 m out.
  m.outline = m.outline.map((p) => (p.y < -3.4 ? { x: p.x, y: p.y - 1 } : p));
  const through = throughAudit(city, net, m)!;
  expect(through.farM).toBeCloseTo(1, 2);
  expect(through.nearM).toBe(0);
  expect(through.signedM).toBeCloseTo(1, 2);
});

test('T34.4: a through road’s lanes dipping toward the node', () => {
  const { city, net, m, me } = fixture();
  relayLanes(net, me, 0, 0.8);
  expect(throughAudit(city, net, m)!.laneM).toBeCloseTo(0.8, 6);
});

test('T34.5: two overlapping unrelated roads', () => {
  const { city, net, pq } = fixture();
  expect(unrelatedOverlaps(city, net)).toEqual([]);
  // The road 40 m north moves onto the street: its 3.5 m overlap the street's 7 m.
  pq.surface = shift(pq.surface, 0, 40);
  const overlaps = unrelatedOverlaps(city, net);
  expect(overlaps.length).toBeGreaterThan(0);
  // Over the street's ends from x -100 to 100 less the side street's own pair: 3.5 m wide.
  const total = overlaps.reduce((sum, o) => sum + o.areaM2, 0);
  expect(total).toBeGreaterThan(3.5 * 150);
});

test('T34.6: a bulging and a self-intersecting junction outline', () => {
  const { city, net, m } = fixture();
  expect(junctionShapeAudit(city, net, m)).toMatchObject({ selfIntersections: 0, bulgeM2: 0 });
  const outline = [...m.outline];
  // A lobe 20 m north of the junction, 4 m wide at its base.
  const north = outline.reduce((best, p, i) => (p.y < outline[best]!.y ? i : best), 0);
  const base = outline[north]!;
  m.outline = [
    ...outline.slice(0, north + 1),
    { x: base.x + 2, y: base.y - 20 },
    { x: base.x + 4, y: base.y },
    ...outline.slice(north + 1),
  ];
  const bulging = junctionShapeAudit(city, net, m)!;
  expect(bulging.bulgeM2).toBeGreaterThan(10);
  expect(bulging.outlineBulgeM2).toBe(bulging.bulgeM2);
  // Two vertices a third of the ring apart swapped: the ring crosses itself.
  const crossed = [...outline];
  const i = Math.floor(crossed.length / 6),
    j = i + Math.floor(crossed.length / 3);
  [crossed[i], crossed[j]] = [crossed[j]!, crossed[i]!];
  m.outline = crossed;
  expect(junctionShapeAudit(city, net, m)!.selfIntersections).toBeGreaterThan(0);
});

test('T34.7: a broken through join', () => {
  const { net, k, km } = fixture();
  expect(joinAudit(net, k)).toMatchObject({ maxM: 0, joins: 2, over: 0 });
  relayLanes(net, km, 0, 0.4);
  expect(joinAudit(net, k)).toMatchObject({ maxM: 0.4, over: 1 });
});

test('T34.8: a marking off its offset', () => {
  const { net, em } = fixture();
  const lines = markingLines(net, em);
  expect(lines.length).toBeGreaterThan(0);
  expect(markingAudit(net, em, lines)).toMatchObject({ maxM: 0, over: 0 });
  const off = markingAudit(
    net,
    em,
    lines.map((line) => shift(line, 0, 0.3)),
  )!;
  expect(off.maxM).toBeCloseTo(0.3, 6);
  expect(off.over).toBe(lines.length);
});
