import { beforeAll, expect, test } from 'vitest';
import { openFreiburg } from '../../bench/freiburg';
import {
  distance,
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
} from '../../src/network/crossings';
import { approachMarkings, roadMarkingGeometry } from '../../src/render/marking-geometry';
import type { City } from '../../src/schema';

// TASK-215: the marking cases M1 to M6 of TASK-212's audit
// (docs/findings/2026-11-19-geometry-audit/README.md), on the bundled Freiburg project.

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
      const placement = crossingPlacement(net, r, atEnd);
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
          widthM: null,
          provenance: { source: 'osm' },
        },
      },
    },
  };
  expect(crossingEnabled(net, r, true, city)).toBe(false);
  expect(crossingEnabled(net, r, true, mapped)).toBe(true);
});

test('M4: no two crossings on a road closer than 7.5 m', () => {
  const close: string[] = [];
  for (const r of net.roads) {
    const spans = r.lanes.map((i) => {
      const l = net.lanes[i]!;
      return [crossingSpan(net, l, false, city), crossingSpan(net, l, true, city), l] as const;
    });
    if (spans.some(([s, e]) => s && e && e.farM - s.farM < 7.5 - 1e-9)) close.push(r.id);
  }
  // Kronenbrücke (r:1143 at n:1142, a signal, and n:664) keeps the signal's.
  expect(crossingEnabled(net, road('r:1143'), false, city)).toBe(true);
  expect(close).toEqual([]);
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
  expect(crossingEnabled(net, road('r:460'), false, city)).toBe(false);
  expect(
    [...steps]
      .filter(([, step]) => step > 1)
      .map(([id]) => id)
      .sort(),
  ).toEqual(['n:552', 'n:94']);
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
