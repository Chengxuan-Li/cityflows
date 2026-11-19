import { beforeAll, expect, test } from 'vitest';
import { openFreiburg } from '../../bench/freiburg';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { lonLatToLocal } from '../../src/geo/projection';
import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
  segmentDistance,
} from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { compile, type CompiledCity, type CRoad } from '../../src/network';
import {
  crossingArms,
  crossingEnabled,
  crossingPlacement,
  crossingSpan,
  crossingStyle,
} from '../../src/network/crossings';
import {
  approachMarkings,
  crossingStripes,
  roadMarkingGeometry,
  transitionMarkings,
} from '../../src/render/marking-geometry';
import type { City } from '../../src/schema';

// TASK-215: the marking cases M1 to M6 of TASK-212's audit
// (docs/findings/2026-11-19-geometry-audit/README.md), on the bundled Freiburg project; TASK-217:
// crossings where OSM maps them (D1 of docs/findings/2026-11-19-aerial-check/) and solid lane
// lines before stop lines (M7).

let city: City;
let net: CompiledCity;
beforeAll(async () => {
  city = (await openFreiburg()).city;
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  net = result.compiled;
});

const road = (id: string) => net.roads[net.index.road.get(id as never)!]!;
const lane = (id: string) => net.lanes.find((l) => l.id === id)!;
const nodeOf = (r: CRoad, atEnd: boolean) => net.nodes[atEnd ? r.to : r.from]!;
/** Every road end that draws stripes, with its placement. */
const striped = () =>
  net.roads.flatMap((r) =>
    [false, true].flatMap((atEnd) => {
      if (!crossingEnabled(net, r, atEnd, city)) return [];
      const placement = crossingPlacement(net, r, atEnd, city);
      return placement.stripes.length ? [{ road: r, atEnd, placement }] : [];
    }),
  );

test('M1: a group entry lane shows its turns through the group, not its first inner link', () => {
  const turns = (id: string) => [...approachMarkings(net, lane(id)).turns].sort();
  // Each enters an inner road straight on and turns left at the next member.
  for (const id of ['r:1277#0', 'r:1514#0', 'r:850#0', 'r:130#0', 'r:1396#0'])
    expect(turns(id), id).toEqual(['left']);
  // Through to r:873 and left to r:845 through the group; right at the first member.
  expect(turns('r:1396#1')).toEqual(['left', 'through']);
  expect(turns('r:1396#2')).toEqual(['left', 'right', 'through']);
});

test('M2: inner roads of junction groups with lanes under 15 m carry no lane lines', () => {
  const lines: string[] = [];
  for (const r of net.roads) {
    if (r.group === undefined || r.lanes.every((i) => net.lanes[i]!.lengthM >= 15)) continue;
    const { below, above } = roadMarkingGeometry(net, r, city);
    if ([...below, ...above].some((s) => s.role === 'lane')) lines.push(r.id);
  }
  expect(net.roads.filter((r) => r.group !== undefined && r.lanes.length > 1).length).toBe(81);
  expect(lines).toEqual([]);
});

test('M3: no default crossing over a trunk road, unless OSM maps one', () => {
  const trunk = striped().filter((e) => e.road.roadClass === 'trunk');
  expect(trunk.map((e) => `${e.road.id} at ${nodeOf(e.road, e.atEnd).id}`)).toEqual([]);
  // A mapped crossing way over the B 31 at n:446 keeps its crossing there.
  const r = road('r:1692');
  const [a, b] = [r.lanes[0]!, r.lanes.at(-1)!].map((i) => {
    const l = net.lanes[i]!;
    return pointAtDistance(l.polyline, l.cumulative, l.lengthM - 5);
  }) as [Vec2, Vec2];
  const out = (p: Vec2, q: Vec2) => ({ x: p.x + (p.x - q.x), y: p.y + (p.y - q.y) });
  const mapped: Pick<City, 'roads' | 'walk'> = {
    roads: city.roads,
    walk: {
      nodes: {},
      links: {
        ['wl:1' as never]: {
          id: 'wl:1' as never,
          from: 'wn:1' as never,
          to: 'wn:2' as never,
          line: [out(a, b), out(b, a)],
          kind: 'crossing',
          layer: 0,
          widthM: null,
          provenance: { source: 'osm' },
        },
      },
    },
  };
  // TASK-217: Freiburg now maps one there itself (a marked crossing node becomes a link).
  expect(crossingEnabled(net, r, true, { roads: city.roads })).toBe(false);
  expect(crossingEnabled(net, r, true, mapped)).toBe(true);
});

test('M4 dropped (TASK-217): of two crossings under 7.5 m apart on a road, both paint only at signals', () => {
  const both: string[] = [];
  for (const r of net.roads) {
    const close = r.lanes.some((i) => {
      const l = net.lanes[i]!;
      const [s, e] = [crossingSpan(net, l, false, city), crossingSpan(net, l, true, city)];
      return s && e && e.farM - s.farM < 7.5 - 1e-9;
    });
    if (!close) continue;
    const styles = [false, true].map((atEnd) => crossingStyle(net, r, atEnd, city));
    if (styles.every((s) => s !== 'none')) both.push(`${r.id} ${styles.join('/')}`);
  }
  // Both walk crossings stay (the rule cost Munich 4 to 5% of mean delay); the doubled stripes
  // TASK-215 removed were default zebras, which no longer paint.
  expect(
    both.every((entry) => entry.endsWith('signal/signal')),
    both.join(),
  ).toBe(true);
});

test('D1: a ramp (a `_link` road) has a crossing only where OSM maps one over it', () => {
  // r:405, the Hauptbahnhof slip road at n:403.
  const r = road('r:405');
  const n403 = net.index.node.get('n:403' as never)!;
  const atEnd = r.to === n403;
  expect(crossingEnabled(net, r, atEnd, city)).toBe(false);
  const lanes = r.lanes.map((i) => net.lanes[i]!);
  const [a, b] = [lanes[0]!, lanes.at(-1)!].map((l) =>
    pointAtDistance(l.polyline, l.cumulative, atEnd ? l.lengthM - 4 : 4),
  ) as [Vec2, Vec2];
  // Square to the first lane, 3 m beyond the outer lanes' centres.
  const l0 = lanes[0]!;
  const heading = headingAtDistance(l0.polyline, l0.cumulative, atEnd ? l0.lengthM - 4 : 4);
  const n = { x: -Math.sin(heading) * 3, y: Math.cos(heading) * 3 };
  const mapped: Pick<City, 'roads' | 'walk'> = {
    roads: city.roads,
    walk: {
      nodes: {},
      links: {
        ['wl:1' as never]: {
          id: 'wl:1' as never,
          from: 'wn:1' as never,
          to: 'wn:2' as never,
          line: [
            { x: a.x - n.x, y: a.y - n.y },
            { x: b.x + n.x, y: b.y + n.y },
          ],
          kind: 'crossing',
          layer: r.grade,
          widthM: null,
          provenance: { source: 'osm' },
        },
      },
    },
  };
  expect(crossingEnabled(net, r, atEnd, mapped)).toBe(true);
  expect(crossingStyle(net, r, atEnd, mapped)).toBe('zebra');
});

/** Keep-clear boxes painted on stripes, and arrows on a crossing at their lane's start or end. */
function paintOnStripes() {
  // Keep-clear boxes over stripes (n:1462's lot mouth).
  const rings = striped().flatMap((e) => e.placement.stripes.map((s) => [...s, s[0]!]));
  const over: string[] = [];
  // Arrows on a crossing at their lane's start (r:467 at n:464) or end.
  const arrows: string[] = [];
  for (const r of net.roads) {
    const { below, above } = roadMarkingGeometry(net, r, city);
    for (const shape of [...below, ...above]) {
      const c = {
        x: shape.points.reduce((s, p) => s + p.x, 0) / shape.points.length,
        y: shape.points.reduce((s, p) => s + p.y, 0) / shape.points.length,
      };
      if (
        shape.role === 'hatch' &&
        rings.some((ring) => distance(ring[0]!, c) < 20 && pointInPolygon(c, ring, 0))
      )
        over.push(r.id);
      if (shape.role !== 'arrow') continue;
      for (const i of r.lanes) {
        const l = net.lanes[i]!;
        const start = crossingSpan(net, l, false, city)?.farM ?? -Infinity;
        const end = crossingSpan(net, l, true, city)?.farM ?? Infinity;
        for (const p of shape.points) {
          const on = nearestOnPolyline(l.polyline, p);
          if (on.away < l.widthM / 2 && (on.along < start || on.along > end)) arrows.push(l.id);
        }
      }
    }
  }
  return { over: [...new Set(over)], arrows: [...new Set(arrows)] };
}

test('M4: no keep-clear box on a crossing', () => expect(paintOnStripes().over).toEqual([]));

test('M4: no arrow on a crossing (r:467 at n:464)', () =>
  expect(paintOnStripes().arrows).toEqual([]));

test('M5: a crossing is one straight band across its arm, and its walk link runs on it', () => {
  // The audit's steps: r:460 at n:403 5.5 m (its crossing now yields to n:461), n:11 4.1 m between
  // the directions, n:276 2.3, n:18 2.0, n:4 1.6. TASK-091's placement stays where a band costs an
  // end stripes: r:1448 at n:552 (too short for a band clear of the far curb), r:1381 at n:94.
  const steps = new Map<string, number>();
  const ends = striped();
  for (const node of net.nodes)
    for (const arm of crossingArms(net, node)) {
      const own = ends.filter((e) => arm.some((a) => a.road === e.road && a.atEnd === e.atEnd));
      if (!own.length) continue;
      const sum = arm.reduce((s, e) => ({ x: s.x + e.direction.x, y: s.y + e.direction.y }), {
        x: 0,
        y: 0,
      });
      const along = (p: Vec2) => (p.x * sum.x + p.y * sum.y) / Math.hypot(sum.x, sum.y);
      const near = own.flatMap((e) =>
        e.placement.stripes.map((s) =>
          along({ x: (s[0]!.x + s[3]!.x) / 2, y: (s[0]!.y + s[3]!.y) / 2 }),
        ),
      );
      const step = Math.max(...near) - Math.min(...near);
      steps.set(node.id, Math.max(step, steps.get(node.id) ?? 0));
    }
  for (const id of ['n:11', 'n:276', 'n:18', 'n:4']) expect(steps.get(id), id).toBeLessThan(0.3);
  expect(
    [...steps]
      .filter(([, step]) => step > 1)
      .map(([id]) => id)
      .sort(),
    // TASK-217: r:460 at n:403 (5.5 m), which TASK-215's dropped M4 removed, keeps TASK-091's
    // placement; it is unmarked (no signal, no mapped crossing), so the step does not show.
  ).toEqual(['n:403', 'n:552', 'n:94']);
  // A generated walk link crosses each lane at that lane's stripes (as T71.1, lane by lane; six
  // mapped crossings stay where OSM maps them, as on main).
  let spans = 0;
  for (const link of net.walk.links)
    for (const span of link.generated ? (link.crossing?.spans ?? []) : []) {
      const l = net.lanes[span.lane]!;
      const r = net.roads[l.road]!;
      const n = link.crossing!.node;
      if (n < 0 || (r.from !== n && r.to !== n)) continue;
      const stripes = crossingSpan(net, l, r.to === n, city);
      if (!stripes) continue;
      spans++;
      expect(Math.abs(span.atM - (stripes.nearM + stripes.farM) / 2), l.id).toBeLessThan(0.3);
    }
  expect(spans).toBeGreaterThan(150);
});

test('M6: a stop line is one line across its approach, through every lane’s stop position', () => {
  let approaches = 0;
  for (const r of net.roads) {
    const stops = roadMarkingGeometry(net, r, city).above.filter((s) => s.role === 'stop');
    const lines = stops.filter((s) => s.kind === 'line');
    if (!lines.length) continue;
    approaches++;
    expect(lines, r.id).toHaveLength(1);
    const line = lines[0]!.points;
    for (const i of r.lanes) {
      const l = net.lanes[i]!;
      const stop = pointAtDistance(l.polyline, l.cumulative, l.stopM);
      // r:1148#4, a lane without movements, is crossed too.
      const away = Math.min(...line.slice(1).map((p, k) => segmentDistance(stop, line[k]!, p)));
      expect(away, l.id).toBeLessThan(0.01);
    }
  }
  expect(approaches).toBeGreaterThan(59);
  expect(approachMarkings(net, lane('r:1148#4')).stop).toBe(false);
});

const centroid = (points: Vec2[]) => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});
/** All crossing paint (zebra stripes and signal dashes) within `m` of `p`. */
const paintNear = (source: Pick<City, 'roads' | 'walk'>, p: Vec2, m: number) =>
  net.roads
    .flatMap((r) => [false, true].flatMap((atEnd) => crossingStripes(net, r, atEnd, source)))
    .filter((shape) => distance(centroid(shape), p) < m);
const key = (shape: Vec2[]) => shape.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');

test('D1: a crossing at a signal paints the broken lines of a signalised crossing, no zebra', () => {
  let ends = 0;
  for (const r of net.roads)
    for (const atEnd of [false, true]) {
      if (net.nodes[atEnd ? r.to : r.from]!.signal === null) continue;
      if (!crossingEnabled(net, r, atEnd, city)) continue;
      const { stripes } = crossingPlacement(net, r, atEnd, city);
      if (!stripes.length) continue;
      ends++;
      expect(crossingStyle(net, r, atEnd, city)).toBe('signal');
      const zebra = new Set(stripes.map(key));
      const paint = crossingStripes(net, r, atEnd, city);
      expect(paint.length).toBeGreaterThan(stripes.length);
      expect(paint.some((shape) => zebra.has(key(shape)))).toBe(false);
    }
  expect(ends).toBeGreaterThan(80);
});

test('D1: zebras where OSM maps them (TASK-216: n:211, n:1139, the Zur Unterführung slip road)', () => {
  const osm = (lat: number, lon: number) => lonLatToLocal(city.geo!, { lat, lon });
  // 2479358348 at n:211 and 9118444286 at n:1139 are mapped as nodes only; 320091867 on a
  // `path=crossing` way where a 7 m slip road splits at n:398.
  for (const [id, at] of [
    ['2479358348', osm(47.9975169, 7.8428582)],
    ['9118444286', osm(47.997331, 7.8436884)],
    ['320091867', osm(47.9997243, 7.8438616)],
  ] as const)
    expect(paintNear(city, at, 3).length, id).toBeGreaterThanOrEqual(3);
  // Without the mapped walk network the n:1139 zebra is gone: it comes from OSM, not a default.
  expect(paintNear({ roads: city.roads }, osm(47.997331, 7.8436884), 3)).toEqual([]);
});

test('D1: a default crossing where OSM maps none is unmarked, and stays where it was', () => {
  const n1139 = net.nodes[net.index.node.get('n:1139' as never)!]!;
  // The west and south arms of n:1139, which main painted 13 and 17 m from the mapped zebra.
  for (const id of ['r:1140', 'r:1945']) {
    const r = road(id);
    const atEnd = r.to === n1139.idx;
    expect(crossingEnabled(net, r, atEnd, city), id).toBe(true);
    expect(crossingStyle(net, r, atEnd, city), id).toBe('none');
    expect(crossingStripes(net, r, atEnd, city), id).toEqual([]);
    expect(crossingPlacement(net, r, atEnd, city).stripes.length, id).toBeGreaterThan(0);
    // It keeps its span: parking strips and walk links treat it as before.
    expect(crossingSpan(net, net.lanes[r.lanes[0]!]!, atEnd, city), id).not.toBeNull();
  }
  // Every zebra painted at a road end is led by a mapped crossing (no hand edits in Freiburg).
  for (const r of net.roads)
    for (const atEnd of [false, true])
      if (crossingEnabled(net, r, atEnd, city) && crossingStyle(net, r, atEnd, city) === 'zebra')
        expect(crossingPlacement(net, r, atEnd, city).mapped, r.id).toBe(true);
});

test('D1: a mapped crossing leads its arm, and one beyond 12 m of the cut paints where mapped', () => {
  // A long two-lane road; a crossing mapped across it in the middle and one 6 m from its end.
  const r = net.roads.find(
    (x) => x.group === undefined && x.lanes.length === 2 && net.lanes[x.lanes[0]!]!.lengthM > 80,
  )!;
  const across = (fromEnd: number) => {
    const [a, b] = [r.lanes[0]!, r.lanes[1]!].map((i) => {
      const l = net.lanes[i]!;
      return pointAtDistance(l.polyline, l.cumulative, l.lengthM - fromEnd);
    }) as [Vec2, Vec2];
    const out = (p: Vec2, q: Vec2) => ({ x: p.x + 2 * (p.x - q.x), y: p.y + 2 * (p.y - q.y) });
    return { line: [out(a, b), out(b, a)], centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };
  const length = net.lanes[r.lanes[0]!]!.lengthM;
  const mid = across(length * 0.4);
  const link = (id: string, line: Vec2[]) => ({
    id: id as never,
    from: 'wn:1' as never,
    to: 'wn:2' as never,
    line,
    kind: 'crossing' as const,
    layer: r.grade,
    widthM: null,
    provenance: { source: 'osm' as const },
  });
  const source: Pick<City, 'roads' | 'walk'> = {
    roads: city.roads,
    walk: { nodes: {}, links: { ['wl:1' as never]: link('wl:1', mid.line) } },
  };
  const stripes = crossingStripes(net, r, true, source).filter(
    (s) => distance(centroid(s), mid.centre) < 4,
  );
  expect(stripes.length).toBeGreaterThanOrEqual(4);
  expect(
    crossingStripes(net, r, true, { roads: city.roads }).some(
      (s) => distance(centroid(s), mid.centre) < 4,
    ),
  ).toBe(false);
});

test('M7: lane lines are solid over the last 30 m before a stop line', () => {
  const result = compile(signalApproach());
  if (!result.ok) throw new Error('fixture');
  const n = result.compiled;
  const node = n.nodes.find((x) => x.signal)!;
  for (const r of n.roads.filter((x) => x.to === node.idx)) {
    const { below, above } = roadMarkingGeometry(n, r);
    const lines = [...below, ...above].filter((x) => x.role === 'lane' && x.kind === 'line');
    const solid = lines.filter((x) => cumulativeLengths(x.points).at(-1)! > 6.5);
    expect(solid, r.id).toHaveLength(1);
    expect(cumulativeLengths(solid[0]!.points).at(-1)!).toBeCloseTo(30, 1);
    const lane = n.lanes[r.lanes[0]!]!;
    const stop = pointAtDistance(lane.polyline, lane.cumulative, lane.stopM);
    expect(distance(solid[0]!.points.at(-1)!, stop)).toBeCloseTo(lane.widthM / 2, 1);
    // Dashes before it, none shorter than its pattern's dash.
    expect(lines.length).toBeGreaterThan(5);
  }
});

test('M7: on Freiburg, solid lines start after a lane gain and run no more than 30 m', () => {
  let solid = 0;
  for (const r of net.roads) {
    if (!r.lanes.some((i) => approachMarkings(net, net.lanes[i]!).stop)) continue;
    const lanes = r.lanes.map((i) => net.lanes[i]!);
    const { below, above } = roadMarkingGeometry(net, r, city);
    for (const shape of [...below, ...above, ...transitionMarkings(net, r)]) {
      if (shape.role !== 'lane' || shape.kind !== 'line') continue;
      const length = cumulativeLengths(shape.points).at(-1)!;
      if (length <= 6.5) continue;
      solid++;
      expect(length, r.id).toBeLessThan(30.5);
      // The two lanes the line runs between, and how far a gain on either tapers in.
      const beside = lanes
        .map((l) => ({ l, on: nearestOnPolyline(l.polyline, shape.points[0]!) }))
        .sort((a, b) => a.on.away - b.on.away)
        .slice(0, 2);
      const gain = Math.max(...beside.map(({ l }) => l.taperStartM));
      expect(beside[0]!.on.along, r.id).toBeGreaterThan(gain - 0.5);
    }
  }
  expect(solid).toBeGreaterThan(30);
});
