import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { createEditor } from '../../src/editor';
import { citySchema } from '../../src/schema';
import { openProject } from '../../src/project/open';
import { createEngine } from '../../src/sim/engine';
import { scenario, trips } from '../sim/fixtures';

test.each(['right', 'left'] as const)(
  'T12 roundabout circulates under %s-hand driving, persists and restores',
  (side) => {
    const city = createEditor(grid5x5()).city;
    city.drivingSide = side;
    Object.assign(Object.values(city.places)[0]!.connectors[0]!, { roadId: 'r:64', positionM: 10 });
    const editor = createEditor(city);
    const result = editor.apply({ kind: 'addRoundabout', nodeId: 'n:13', radiusM: 25 });
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    const record = editor.city.nodes['n:13']!.roundabout!;
    expect(record.ringRoads).toHaveLength(8);
    for (const id of record.ringRoads) {
      const road = editor.city.roads[id]!;
      expect(road.lanes).toHaveLength(1);
      expect(road.lanes[0]!.allowed).toContain('van');
      expect(road.speedLimitMps).toBeCloseTo(30 / 3.6);
    }
    const entries = Object.values(editor.city.nodes).filter((n) => n.control === 'yield');
    expect(entries).toHaveLength(4);
    for (const node of entries) expect(node.minorRoads).toHaveLength(1);
    const original = JSON.stringify(city);
    expect(editor.undo()?.ok).toBe(true);
    expect({ ...editor.city, version: city.version }).toEqual(city);
    expect(editor.redo()?.ok).toBe(true);
    const reopened = createEditor(citySchema.parse(JSON.parse(JSON.stringify(editor.city))));
    expect(reopened.apply({ kind: 'removeRoundabout', nodeId: 'n:13' }).ok).toBe(true);
    expect({ ...reopened.city, version: city.version, nextId: city.nextId }).toEqual(city);
    expect(JSON.stringify(city)).toBe(original);

    // Force a crossing and a U-turn through the ring rather than the outer grid.
    const homes = Object.values(editor.city.places)[0]!;
    const work = Object.values(editor.city.places)[1]!;
    const approaches = Object.values(editor.city.roads).filter((r) => r.to === entries[0]!.id);
    const entry = approaches.find((r) => !record.ringRoads.includes(r.id))!;
    const ring = new Set(record.ringRoads);
    const exit = Object.values(editor.city.roads).find(
      (r) =>
        !ring.has(r.id) &&
        record.ringRoads.some((id) => editor.city.roads[id]!.to === r.from) &&
        r.to === entry.from,
    )!;
    const testCity = structuredClone(editor.city);
    testCity.places[homes.id]!.connectors = [
      { ...homes.connectors[0]!, roadId: entry.id, lane: 0, positionM: 3, direction: 'out' },
    ];
    testCity.places[work.id]!.connectors = [
      {
        ...work.connectors[0]!,
        roadId: exit.id,
        lane: 0,
        positionM: Math.min(
          15,
          editor.compiled.lanes[editor.compiled.index.lane.get(`${exit.id}#0`)!]!.lengthM - 1,
        ),
        direction: 'in',
      },
    ];
    const testEditor = createEditor(testCity);
    const engine = createEngine();
    engine.load({
      compiled: testEditor.compiled,
      scenario: scenario(),
      trips: trips(testCity, 5, 4),
    });
    engine.step(1);
    const route = engine.inspect(1)!.route!;
    expect(
      route.roads.filter((i) => ring.has(testEditor.compiled.roads[i]!.id)).length,
    ).toBeGreaterThanOrEqual(6);
    engine.step(2500);
    expect(engine.metrics().trips.completed).toBe(5);
    expect(engine.metrics().trips.failed).toBe(0);
  },
);

const nodeId = 'n:13';
const add = { kind: 'addRoundabout', nodeId, radiusM: 25 } as const;
const remove = { kind: 'removeRoundabout', nodeId } as const;

test('T12 removes the current approaches and undoes and redoes the removal exactly', () => {
  const city = createEditor(grid5x5()).city;
  const editor = createEditor(city);
  expect(editor.apply(add).ok).toBe(true);
  expect(editor.apply({ kind: 'setRoadAttributes', roadId: 'r:64', speedLimitMps: 5 }).ok).toBe(
    true,
  );
  const built = editor.city;
  expect(editor.apply(remove).ok).toBe(true);
  const restored = editor.city;
  expect(restored.roads).toEqual({
    ...city.roads,
    'r:64': { ...city.roads['r:64'], speedLimitMps: 5 },
  });
  expect(restored.nodes).toEqual(city.nodes);
  expect(restored.nextId).toBe(built.nextId);
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city).toEqual({ ...built, version: editor.city.version });
  expect(editor.redo()?.ok).toBe(true);
  expect(editor.city).toEqual({ ...restored, version: editor.city.version });
});

test('T12 rebuilds at the ring centroid after the center marker moves', () => {
  const city = createEditor(grid5x5()).city;
  const editor = createEditor(city);
  expect(editor.apply(add).ok).toBe(true);
  expect(editor.apply({ kind: 'moveNode', nodeId, pos: { x: 245, y: 250 } }).ok).toBe(true);
  expect(editor.apply(remove).ok).toBe(true);
  expect(editor.city.nodes[nodeId]!.pos.x).toBeCloseTo(city.nodes[nodeId]!.pos.x, 8);
  expect(editor.city.nodes[nodeId]!.pos.y).toBeCloseTo(city.nodes[nodeId]!.pos.y, 8);
});

test('T12 keeps a split inbound approach in the restored signal program', () => {
  const editor = createEditor(grid5x5());
  expect(editor.apply(add).ok).toBe(true);
  expect(editor.apply({ kind: 'splitRoad', roadId: 'r:64', atM: 30 }).ok).toBe(true);
  const splitNode = editor.city.roads['r:64']!.to;
  const approach = Object.values(editor.city.roads).find(
    (road) => road.from === splitNode && road.to !== editor.city.roads['r:64']!.from,
  )!;
  expect(editor.apply(remove).ok).toBe(true);
  expect(editor.city.roads[approach.id]!.to).toBe(nodeId);
  const signal = editor.city.nodes[nodeId]!.signal!;
  expect(
    signal.phases.some((phase) => phase.groups.some((group) => group.from === approach.id)),
  ).toBe(true);
});

test('T12 restores the original signal program after building a roundabout', () => {
  const city = createEditor(grid5x5()).city;
  const editor = createEditor(city);
  expect(editor.apply(add).ok).toBe(true);
  expect(editor.city.nodes[nodeId]!.control).toBe('uncontrolled');
  expect(editor.apply(remove).ok).toBe(true);
  expect(editor.city.nodes[nodeId]).toEqual(city.nodes[nodeId]);
});

test('T12 opens and removes a v1 roundabout saved by main, including baseline and history', async () => {
  const fixture = new URL('./main-v1-roundabout.cityflows', import.meta.url);
  const opened = await openProject(await readFile(fixture));
  expect(opened).toMatchObject({ ok: true });
  if (!opened.ok) throw new Error(opened.error);
  const { city, baseline, history } = opened.project;
  expect(city.schemaVersion).toBe(3);
  const record = city.nodes[nodeId]!.roundabout!;
  expect(Object.keys(record).sort()).toEqual(['radiusM', 'restore', 'ringRoads']);
  expect(baseline?.city).toEqual(city);
  expect(history?.[0]?.patch.set.nodes?.[nodeId]?.roundabout).toEqual(record);
  const editor = createEditor(city);
  expect(editor.apply(remove).ok).toBe(true);
  expect(editor.city.nodes[nodeId]).toEqual(grid5x5().nodes[nodeId]);
  expect(record.ringRoads.every((id) => !editor.city.roads[id])).toBe(true);
});

test('T12 invalid radii and broken rings reject atomically', () => {
  const editor = createEditor(grid5x5());
  expect(() => editor.apply({ ...add, radiusM: 100 })).toThrow(/too little road/);
  expect(editor.canUndo).toBe(false);
  expect(editor.apply(add).ok).toBe(true);
  const id = editor.city.nodes[nodeId]!.roundabout!.ringRoads[0]!;
  expect(editor.apply({ kind: 'deleteRoad', roadId: id }).ok).toBe(true);
  const before = editor.city;
  expect(() => editor.apply(remove)).toThrow(id);
  expect(editor.city).toBe(before);
});
