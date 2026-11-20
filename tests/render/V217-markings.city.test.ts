import { beforeAll, expect, test } from 'vitest';
import { openFreiburg } from '../../bench/freiburg';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { lonLatToLocal } from '../../src/geo/projection';
import {
  cumulativeLengths,
  distance,
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
  segmentDistance,
} from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { compile, type CompiledCity } from '../../src/network';
import {
  crossingEnabled,
  crossingPlacement,
  crossingSpan,
  crossingStyle,
} from '../../src/network/crossings';
import {
  approachMarkings,
  crossingStripes,
  keepClearBoxes,
  keepClearMarkings,
  roadMarkingGeometry,
  transitionMarkings,
} from '../../src/render/marking-geometry';
import { paintedCity } from '../../src/render/road-paint';
import { markingThemes } from '../../src/render/style';
import type { City } from '../../src/schema';

// TASK-215: the marking cases M1 to M6 of TASK-212's audit
// (docs/findings/2026-11-19-geometry-audit/README.md), on the bundled Freiburg project; TASK-217:
// crossings where OSM maps them (D1 of docs/findings/2026-11-19-aerial-check/) and solid lane
// lines before stop lines (M7); TASK-229: N1 and N2 of TASK-224's re-check
// (docs/findings/2026-11-19-aerial-recheck/); TASK-240: arrows of the junction ahead.

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

const laneLines = (id: string) => {
  const { below, above } = roadMarkingGeometry(net, road(id), city);
  return [...below, ...above].filter((s) => s.role === 'lane').length;
};

test('M2: inner roads of junction groups with lanes under 15 m carry lane lines only on carriageway (N1)', () => {
  const lines: string[] = [];
  for (const r of net.roads) {
    if (r.group === undefined || r.lanes.every((i) => net.lanes[i]!.lengthM >= 15)) continue;
    if (laneLines(r.id)) lines.push(r.id);
  }
  // TASK-226: r:1149 and r:475 leave the Hauptbahnhof group (D2), 81 to 79.
  expect(net.roads.filter((r) => r.group !== undefined && r.lanes.length > 1).length).toBe(79);
  // Runs of 15 m or more node to node through plain joins, crossed at one end at most; the
  // other short inner roads lie inside junctions (TASK-217's M2).
  expect(lines.sort()).toEqual(
    [
      ...['r:6', 'r:745', 'r:1179'], // Stefan-Meier-Straße, 33 m through n:5 and n:744
      ...['r:775', 'r:288', 'r:663'],
      ...['r:816', 'r:1225'],
      ...['r:1484', 'r:1881'],
      ...['r:1372', 'r:2167', 'r:770'],
    ].sort(),
  );
});

test('N1: lane lines on carriageway a group takes in, none on the links inside its junction', () => {
  // TASK-224: about 35 m of westbound Friedrichstraße (r:1149 18.1 m and r:475 19.1 m node to
  // node, lanes of 4.6 to 5.5 m between their cuts) and Stefan-Meier-Straße's 13 m r:1179 lost
  // the dashed lines the ground has. Since TASK-226 (D2) r:1149 and r:475 are plain roads before
  // the group and keep their lines as any road does.
  for (const id of ['r:1149', 'r:475', 'r:6', 'r:745', 'r:1179'])
    expect(laneLines(id), id).toBeGreaterThanOrEqual(road(id).lanes.length - 1);
  // The Hauptbahnhof junction's own links, crossed at both ends: none.
  for (const id of ['r:972', 'r:973', 'r:975', 'r:976']) expect(laneLines(id), id).toBe(0);
});

test('N2: an entry lane with no path through the group, or only a double left, shows its own turn', () => {
  const turns = (id: string) => [...approachMarkings(net, lane(id)).turns].sort();
  // TASK-226 (D2): r:1148 no longer enters the Hauptbahnhof group but ends at the median
  // crossover n:1147; TASK-240 paints there the arrows of the junction ahead (below).
  expect(['r:1148#0', 'r:1148#1', 'r:1148#2', 'r:1148#3', 'r:1148#4'].map(turns)).toEqual([
    ['left'],
    ['left'],
    ['through'],
    ['through'],
    ['right'],
  ]);
  // r:460#0 has no chain either (its arrow finds no room behind the crossing at its start, M4);
  // #1's only chain turns left three times round the block: a u-turn, no arrow.
  expect(turns('r:460#0')).toEqual(['through']);
  expect(turns('r:460#1')).toEqual([]);
  // Where the double left was the only lane without an arrow, every lane now runs straight on
  // and none carries one (TASK-079), as on the ground at r:1262 and r:1478.
  for (const id of ['r:1262#0', 'r:1262#1', 'r:1478#0', 'r:1478#1'])
    expect(turns(id), id).toEqual([]);
});

test('TASK-240: an approach ending at a plain node or a median crossover shows the arrows of the junction ahead', () => {
  const turns = (id: string) =>
    road(id).lanes.map((i) => [...approachMarkings(net, net.lanes[i]!).turns].sort().join('+'));
  // r:1148 runs on through the crossover n:1147, r:1149 and r:475 (lanes under 6 m, no room for
  // arrows) into the Hauptbahnhof group; #4 leaves at the gore n:473 onto the ramp r:2153. As way
  // 227874537's turn:lanes (left|left|through|through|right) and the ground.
  expect(turns('r:1148')).toEqual(['left', 'left', 'through', 'through', 'right']);
  const arrows = (id: string) => {
    const { below, above } = roadMarkingGeometry(net, road(id), city);
    return [...below, ...above].filter((s) => s.role === 'arrow').length;
  };
  expect(arrows('r:1148')).toBe(5);
  for (const id of ['r:1149', 'r:475']) expect(arrows(id), id).toBe(0);
  // Others before a road too short for arrows, as their ways' turn:lanes.
  expect(turns('r:261')).toEqual(['left', 'through', 'through', 'right', 'right']);
  expect(turns('r:296')).toEqual(['left', 'through', 'through']);
  expect(turns('r:500')).toEqual(['left', 'left+right']);
  expect(turns('r:904')).toEqual(['left+through', 'through']);
  expect(turns('r:2199')).toEqual(['through', 'right+through']);
  // The road ahead has room for the arrows itself (r:1148): none here.
  expect(turns('r:1175')).toEqual(['', '']);
  // The Lessingstraße group gives r:1059#0 and #1 no arrow (their paths are u-turns): r:1285
  // keeps its own movements' arrows rather than show the junction's on two lanes.
  expect(turns('r:1285')).toEqual(['through', 'through', 'through', 'right']);
});

test('TASK-241: no hatched taper where lanes of one carriageway widen or fan', () => {
  const hatched = (id: string) =>
    transitionMarkings(net, road(id)).filter((s) => s.role === 'hatch' || s.role === 'channel')
      .length;
  // r:1175's two lanes fan into r:1148's five at the way split n:1146 (r:1169's likewise into
  // r:1171 at n:1169): plain lanes on the ground, no gore.
  for (const id of ['r:1148', 'r:1171', 'r:1187', 'r:1189', 'r:261', 'r:402'])
    expect(hatched(id), id).toBe(0);
  // Every hatched taper left is a lane end (with its merge arrow); diverge gores are the ramps'.
  for (const r of net.roads)
    if (hatched(r.id))
      expect(
        r.lanes.some((i) => net.lanes[i]!.taperEndM > 0),
        r.id,
      ).toBe(true);
});

test('TASK-241: arrows keep off keep-clear boxes, moved along their lane or left out', () => {
  // A box's lane stretch from its hatch: the paint of the lane's `hatch` shapes, along the lane.
  const onBoxes: string[] = [];
  const arrowsOf = (id: string) => {
    const { below, above } = roadMarkingGeometry(net, road(id), city);
    return [...below, ...above].filter((s) => s.role === 'arrow');
  };
  for (const r of net.roads) {
    const { below, above } = roadMarkingGeometry(net, r, city);
    const shapes = [...below, ...above];
    for (const i of r.lanes) {
      const l = net.lanes[i]!;
      const along = (role: string) =>
        shapes
          .filter((s) => s.role === role)
          .flatMap((s) =>
            s.points
              .map((p) => nearestOnPolyline(l.polyline, p))
              .filter((on) => on.away < l.widthM / 2)
              .map((on) => on.along),
          );
      const box = along('hatch');
      if (!box.length) continue;
      const [from, to] = [Math.min(...box), Math.max(...box)];
      if (along('arrow').some((a) => a > from && a < to)) onBoxes.push(l.id);
    }
  }
  expect(onBoxes).toEqual([]);
  // r:296#2 (box 2.0 to 16.5 m) and r:1333#1 (12.8 to 27.3 m) keep their arrows, moved past and
  // behind the box; r:904#0 and r:1362#3 have no room beside theirs.
  expect(arrowsOf('r:296').length).toBe(3);
  expect(arrowsOf('r:1333').length).toBe(2);
  expect(arrowsOf('r:904').length).toBe(1);
});

test('TASK-246: a keep-clear box stands on its lane between its tapers, inside the carriageway', () => {
  const box = (id: string) =>
    keepClearBoxes(net, net.lanes[net.index.lane.get(id as never)!]!, markingThemes.de, city);
  // r:1189#3 gains its lane at n:1169 (taper 8.7 m), r:1360#2 at 15 m, r:296#2 at 11.3 m: the box
  // starts where the lane is whole (it was 2.0, 7.9 and 2.0 m).
  expect(box('r:1189#3').map((z) => [+z.fromM.toFixed(1), +z.toM.toFixed(1)])).toEqual([
    [8.7, 16.5],
  ]);
  expect(box('r:1360#2')[0]!.fromM).toBeCloseTo(15, 6);
  expect(box('r:296#2')[0]!.fromM).toBeCloseTo(
    net.lanes[net.index.lane.get('r:296#2' as never)!]!.taperStartM,
    6,
  );
  // r:1151#1 (9.5 m, 6.7 m taper) and r:1389#1 (a gain and an end of 15 m on 30.3 m) keep under
  // 3 m of whole lane: no box.
  expect(box('r:1151#1')).toEqual([]);
  expect(box('r:1389#1')).toEqual([]);
  const painted = paintedCity(net);
  for (const r of net.roads) {
    for (const i of r.lanes) {
      const l = net.lanes[i]!;
      for (const z of keepClearBoxes(net, l, markingThemes.de, city)) {
        expect(z.fromM, l.id).toBeGreaterThanOrEqual(l.taperStartM - 1e-9);
        expect(z.toM, l.id).toBeLessThanOrEqual(l.lengthM - l.taperEndM + 1e-9);
      }
    }
    // Every point of the box paint lies on the road's painted surface (r:1189's, r:1389's and
    // r:296's fanned across the ground beside the widening).
    const surface = painted.roads[r.idx]!.surface;
    const ring = [...surface, surface[0]!];
    for (const shape of keepClearMarkings(net, r, markingThemes.de, city))
      for (const p of shape.points) expect(pointInPolygon(p, ring, 0.05), r.id).toBe(true);
  }
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
      const { stripes } = crossingPlacement(net, r, atEnd);
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

test('D1: zebras where OSM maps a crossing way (TASK-216 box: n:229, n:1651)', () => {
  const osm = (lat: number, lon: number) => lonLatToLocal(city.geo!, { lat, lon });
  // 21875560 on Friedrichstraße and 334498547, mapped zebras whose crossing ways lead their arms.
  for (const [id, at] of [
    ['21875560', osm(47.9978027, 7.8480967)],
    ['334498547', osm(47.9978582, 7.8479135)],
  ] as const)
    expect(paintNear(city, at, 4).length, id).toBeGreaterThanOrEqual(3);
  // Without the mapped walk network they are default crossings of imported roads: unmarked.
  expect(paintNear({ roads: city.roads }, osm(47.9978027, 7.8480967), 4)).toEqual([]);
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
    expect(crossingPlacement(net, r, atEnd).stripes.length, id).toBeGreaterThan(0);
    // It keeps its span: parking strips and walk links treat it as before.
    expect(crossingSpan(net, net.lanes[r.lanes[0]!]!, atEnd, city), id).not.toBeNull();
  }
  // Every zebra painted at a road end comes from a mapped crossing (no hand edits in Freiburg).
  for (const r of net.roads)
    for (const atEnd of [false, true])
      if (crossingEnabled(net, r, atEnd, city) && crossingStyle(net, r, atEnd, city) === 'zebra')
        expect(crossingStyle(net, r, atEnd, { roads: city.roads }), r.id).toBe('none');
});

test('D1: a mapped crossing beyond 12 m of a cut paints where it is mapped', () => {
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
