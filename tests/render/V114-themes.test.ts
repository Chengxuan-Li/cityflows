import { continuity } from '../../src/fixtures/continuity';
import { pointInPolygon, nearestOnPolyline } from '../../src/geo/polyline';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { compileAuditCity, loadAuditCity } from '../../bench/junction-audit';
import {
  roadMarkingGeometry,
  markingPolygons,
  nodeMarkingGeometry,
  transitionMarkings,
} from '../../src/render/marking-geometry';
import { compile } from '../../src/network';
import { createEditor } from '../../src/editor';
import { applyPatch } from '../../src/editor/patch';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { saveProject, saveProjectJson } from '../../src/project/save';
import { openProject } from '../../src/project/open';
import { citySchema, scenarioSchema } from '../../src/schema';
import { cityMarkingTheme } from '../../src/schema/marking-theme';
import { markingThemes } from '../../src/render/style';
import { buildMarkings } from '../../src/render3d/markings';
import { cityHeights } from '../../src/render3d/heights';
import { tierCities, unitTest, cityTest } from '../tier';

// Hash shared gore metadata once, rather than duplicating whole roads for every stripe.
function paintHash(shapes: unknown): string {
  const indices = new Map<unknown, number>();
  const gores: unknown[] = [];
  const paint = JSON.stringify(shapes, (key, value: unknown) => {
    if (key !== 'gore') return value;
    const existing = indices.get(value);
    if (existing !== undefined) return existing;
    const index = gores.length;
    indices.set(value, index);
    gores.push(value);
    return index;
  });
  return createHash('sha256').update(paint).update(JSON.stringify(gores)).digest('hex');
}

test.each(tierCities(['munich', 'sindelfingen'] as const))(
  'V114: %s German paint equals main',
  (name) => {
    const net = compileAuditCity(name);
    const shapes = [
      net.roads.map((r) => [roadMarkingGeometry(net, r), transitionMarkings(net, r)]),
      net.nodes.map((n) => nodeMarkingGeometry(net, n)),
    ];
    expect(paintHash(shapes)).toBe(
      name === 'munich'
        ? '04b0f83f79f2144d43a30c97fff04d445feed09740ef452cf4fb0feec6eb5ccb'
        : 'abca6442b0b710647153506e60e8e03175492cf8dc1fd470be28d7074da559e5',
    );
    expect(loadAuditCity(name).markingTheme).toBe('de');
  },
);

unitTest(
  'V114: a two-way multi-lane street has double yellow US centre lines and white 3/9 lane dashes',
  () => {
    const { city, node, street } = buildCity('Markings', 1);
    street(node(0, 0), node(201, 0), 2);
    const compiled = compile(city);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const net = compiled.compiled;
    const marks = net.roads.flatMap(
      (r) => roadMarkingGeometry(net, r, city, markingThemes.us).below,
    );
    const centre = marks.filter((s) => s.role === 'centre');
    expect(centre).toHaveLength(2);
    expect(Math.abs(centre[0]!.points[0]!.y - centre[1]!.points[0]!.y)).toBeCloseTo(0.3);
    expect(markingThemes.us.colors.centre).toBe(0xf2ca4b);
    expect(markingThemes.us.colors.lane).toBe(0xfffcf3);
    expect(
      marks
        .filter((s) => s.role === 'lane')
        .every((s) => s.kind === 'line' && s.dash?.[0] === 3 && s.dash[1] === 9),
    ).toBe(true);
    expect(marks.filter((s) => s.role === 'lane').length).toBeGreaterThan(4);
    for (const shape of marks.filter((s) => s.role === 'lane'))
      expect(
        Math.hypot(
          shape.points.at(-1)!.x - shape.points[0]!.x,
          shape.points.at(-1)!.y - shape.points[0]!.y,
        ),
      ).toBeLessThanOrEqual(3.000001);
    const uk = net.roads.flatMap((r) => roadMarkingGeometry(net, r, city, markingThemes.uk).below);
    expect(uk.some((s) => s.role === 'centre')).toBe(true);
    const runs = uk
      .filter((s) => s.role === 'centre')
      .map(
        (s) =>
          [
            Math.min(s.points[0]!.x, s.points.at(-1)!.x),
            Math.max(s.points[0]!.x, s.points.at(-1)!.x),
          ] as const,
      )
      .sort((a, b) => a[0] - b[0]);
    let end = -Infinity;
    for (const [from, to] of runs) {
      expect(to - from).toBeLessThanOrEqual(3.000001);
      if (from < end - 0.000001) expect(to).toBeLessThanOrEqual(end + 0.000001);
      end = Math.max(end, to);
    }
    expect(markingThemes.uk.colors.centre).toBe(0xfffcf3);
    expect(markingThemes.uk.colors.edge).toBe(0xf2ca4b);
  },
);

unitTest('V114: theme arrows differ and UK give-way approaches have two dashed bars', () => {
  const source = grid5x5();
  const result = compile(source);
  if (!result.ok) throw new Error('compile failed');
  const net = result.compiled;
  const arrows = Object.values(markingThemes).map((theme) =>
    net.roads.flatMap((r) =>
      roadMarkingGeometry(net, r, source, theme).above.filter((s) => s.role === 'arrow'),
    ),
  );
  expect(arrows.every((a) => a.length > 0)).toBe(true);
  expect(new Set(arrows.map((a) => JSON.stringify(a))).size).toBe(3);
  const road = net.roads.find((r) => net.lanes[r.lanes[0]!]!.lengthM > 30)!;
  source.nodes[net.nodes[road.to]!.id]!.control = 'yield';
  source.nodes[net.nodes[road.to]!.id]!.signal = null;
  source.nodes[net.nodes[road.to]!.id]!.minorRoads = [road.id];
  const yielded = compile(source);
  if (!yielded.ok) throw new Error('yield compile failed');
  const marks = roadMarkingGeometry(
    yielded.compiled,
    yielded.compiled.roads[road.idx]!,
    source,
    markingThemes.uk,
  ).above.filter((s) => s.role === 'stop');
  expect(marks.length).toBeGreaterThan(2);
  expect(marks.every((s) => s.kind === 'line')).toBe(true);
  expect(
    new Set(marks.map((s) => s.points[0]!.x.toFixed(2))).size === 2 ||
      new Set(marks.map((s) => s.points[0]!.y.toFixed(2))).size === 2,
  ).toBe(true);
});

unitTest(
  'V114: style edits undo/redo without changing compiled data, including saved inverses',
  async () => {
    const source = grid5x5();
    const editor = createEditor(source);
    const compiled = editor.compiled;
    expect(editor.canUndoDisplayOnly).toBe(false);
    expect(editor.apply({ kind: 'setMarkingTheme', theme: 'us' }).ok).toBe(true);
    expect(editor.canUndoDisplayOnly).toBe(true);
    expect(editor.compiled).toBe(compiled);
    expect(editor.city.version).toBe(source.version);
    expect(cityMarkingTheme(editor.city)).toBe('us');
    const project = {
      city: editor.city,
      history: [...editor.history],
      scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))],
    };
    for (const save of [saveProject, saveProjectJson]) {
      const opened = await openProject(await save(project));
      expect(opened.ok).toBe(true);
      if (!opened.ok) continue;
      expect(opened.project.city.markingTheme).toBe('us');
      expect(
        cityMarkingTheme(applyPatch(opened.project.city, opened.project.history![0]!.inverse)),
      ).toBe('de');
    }
    editor.undo();
    expect(editor.canRedoDisplayOnly).toBe(true);
    expect(editor.city.markingTheme).toBeUndefined();
    expect(editor.compiled).toBe(compiled);
    editor.redo();
    expect(editor.city.markingTheme).toBe('us');
    expect(compile({ ...source, markingTheme: 'uk' })).toEqual(compile(source));
    expect(citySchema.safeParse({ ...source, markingTheme: 'fr' }).success).toBe(false);
  },
);

unitTest(
  'V114: old projects default from their geography; new themes colour the 3D mesh',
  async () => {
    const city = grid5x5();
    city.geo = {
      origin: { lon: -0.1, lat: 51.5 },
      scale: 1,
      bbox: [-0.2, 51.4, 0, 51.6],
      source: {
        kind: 'osm',
        snapshotDate: null,
        attribution: 'OSM',
        importerVersion: '1',
        inferredCount: 0,
      },
    };
    const opened = await openProject(
      await saveProject({ city, scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] }),
    );
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(cityMarkingTheme(opened.project.city)).toBe('uk');
    const result = compile(city);
    if (!result.ok) throw new Error('compile failed');
    for (const theme of ['us', 'uk'] as const) {
      const mesh = buildMarkings(
        result.compiled,
        { ...city, markingTheme: theme },
        cityHeights(result.compiled, city),
      );
      const colors = mesh.getAttribute('color');
      expect(
        Array.from({ length: colors.count }, (_, i) => [
          colors.getX(i),
          colors.getY(i),
          colors.getZ(i),
        ]).some(
          (c) =>
            Math.abs(c[0]! - 242 / 255) < 1e-5 &&
            Math.abs(c[1]! - 202 / 255) < 1e-5 &&
            Math.abs(c[2]! - 75 / 255) < 1e-5,
        ),
      ).toBe(true);
      mesh.dispose();
    }
  },
);

cityTest(
  'V114: Munich theme build times and compilation are display-only',
  () => {
    const city = loadAuditCity('munich');
    const net = compileAuditCity('munich');
    const timings = [];
    const hash = (value: unknown) =>
      createHash('sha256')
        .update(JSON.stringify(value, (_, v: unknown) => (v instanceof Map ? [...v] : v)))
        .digest('hex');
    const baseline = hash(compile(city));
    for (const id of ['de', 'us', 'uk'] as const) {
      expect(hash(compile({ ...city, markingTheme: id }))).toBe(baseline);
      const start = performance.now();
      for (const r of net.roads) {
        roadMarkingGeometry(net, r, city, markingThemes[id]);
        transitionMarkings(net, r, markingThemes[id]);
      }
      for (const n of net.nodes) nodeMarkingGeometry(net, n, markingThemes[id]);
      const sharedMs = performance.now() - start;
      timings.push({ theme: id, sharedMs: Math.round(sharedMs) });
    }
    console.info('V114 Munich marking build ms:', JSON.stringify(timings));
  },
  120_000,
);

unitTest.each([0, 1.4])(
  'V114: close opposing carriageways keep a white UK centre without yellow inner edges (gap %s m)',
  (gap) => {
    const { city, node, street } = buildCity('Paired markings', 1);
    const roads = street(node(0, 0), node(201, 0), 2);
    for (const road of roads) {
      road.streetGroupId = null;
      road.corridorId = 'paired';
      road.lateralOffsetM += gap / 2;
    }
    const compiled = compile(city);
    if (!compiled.ok) throw new Error('compile failed');
    const shapes = compiled.compiled.roads.flatMap(
      (r) => roadMarkingGeometry(compiled.compiled, r, city, markingThemes.uk).below,
    );
    expect(shapes.some((s) => s.role === 'centre')).toBe(true);
    const edges = shapes.filter((s) => s.role === 'edge');
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.flatMap((s) => s.points).every((p) => Math.abs(p.y) > 1)).toBe(true);
  },
);

unitTest('V114: new theme edge paint stays on tapered road surfaces', () => {
  const city = continuity();
  const result = compile(city);
  if (!result.ok) throw new Error('compile failed');
  const net = result.compiled;
  const roads = net.roads.filter((r) =>
    r.lanes.some((i) => net.lanes[i]!.taperStartM || net.lanes[i]!.taperEndM),
  );
  expect(roads.length).toBeGreaterThan(0);
  for (const theme of [markingThemes.us, markingThemes.uk])
    for (const road of roads)
      for (const shape of roadMarkingGeometry(net, road, city, theme).below.filter(
        (s) => s.role === 'edge',
      ))
        for (const p of markingPolygons(shape).flat())
          expect(pointInPolygon(p, [...road.surface, road.surface[0]!], 0.1)).toBe(true);
});

unitTest.each([
  [0, -10, 0.15, true],
  [6, 6, 3.15, false],
] as const)(
  'V114: sparse edges follow separation changing inside a segment (gap %s m)',
  (gap, bow, targetY, painted) => {
    const { city, node, street } = buildCity('Changing median', 1);
    const roads = street(node(0, 0), node(201, 0), 2);
    for (const road of roads) {
      road.streetGroupId = null;
      road.corridorId = 'paired';
      road.lateralOffsetM += gap / 2;
    }
    roads[1].centerline.splice(1, 0, { x: 100, y: bow });
    const result = compile(city);
    if (!result.ok) throw new Error('compile failed');
    const net = result.compiled;
    const road = net.roads[net.index.road.get(roads[0].id)!]!;
    const edges = roadMarkingGeometry(net, road, city, markingThemes.uk).below.filter(
      (s) => s.role === 'edge',
    );
    expect(edges.every((s) => s.points.length < 100)).toBe(true);
    expect(edges.some((s) => nearestOnPolyline(s.points, { x: 100, y: targetY }).away < 0.1)).toBe(
      painted,
    );
  },
);
