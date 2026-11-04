import { expect, test } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { createEditor } from '../../src/editor';
import { citySchema } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { scenario, trips } from '../sim/fixtures';

test.each(['right', 'left'] as const)(
  'T12 roundabout circulates under %s-hand driving, persists and restores',
  (side) => {
    const city = grid5x5();
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
      { ...work.connectors[0]!, roadId: exit.id, lane: 0, positionM: 15, direction: 'in' },
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

test('T12 invalid radii and intervening approach edits reject atomically', () => {
  const editor = createEditor(grid5x5());
  expect(() => editor.apply({ kind: 'addRoundabout', nodeId: 'n:13', radiusM: 100 })).toThrow();
  expect(editor.canUndo).toBe(false);
  editor.apply({ kind: 'addRoundabout', nodeId: 'n:13', radiusM: 25 });
  const id = editor.city.nodes['n:13']!.roundabout!.ringRoads[0]!;
  editor.apply({ kind: 'setRoadAttributes', roadId: id, speedLimitMps: 5 });
  const before = editor.city;
  expect(() => editor.apply({ kind: 'removeRoundabout', nodeId: 'n:13' })).toThrow(/Undo edits/);
  expect(editor.city).toBe(before);
});
