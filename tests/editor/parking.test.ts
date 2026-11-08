import { expect, test } from 'vitest';
import { createEditor } from '../../src/editor';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { openProject } from '../../src/project/open';
import { saveProject } from '../../src/project/save';
import { allocateId } from '../../src/schema';

test('T48 garage capacity and access edits undo, redo and survive project history', async () => {
  const editor = createEditor(grid5x5());
  const original = editor.compiled.parking[0]!;
  expect(editor.city.parking?.[original.id]).toEqual(original.source);
  expect(
    editor.apply({ kind: 'setParkingAttributes', parkingId: original.id, capacity: 1200 }).ok,
  ).toBe(true);
  expect(
    editor.apply({ kind: 'setParkingAttributes', parkingId: original.id, access: 'public' }).ok,
  ).toBe(true);
  expect(editor.history).toHaveLength(2);
  const opened = await openProject(
    await saveProject({
      city: editor.city,
      scenarios: [defaultScenario('grid5x5')],
      history: [...editor.history],
    }),
  );
  if (!opened.ok) throw new Error(opened.error);
  expect(opened.project.city).toEqual(editor.city);
  expect(opened.project.history).toEqual(editor.history);
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city.parking![original.id]!.access).toBe(original.access);
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city.parking![original.id]).toEqual(original.source);
  expect(editor.redo()?.ok).toBe(true);
  expect(editor.city.parking![original.id]!.capacity).toBe(1200);
  expect(
    editor.apply({ kind: 'setParkingAttributes', parkingId: original.id, capacity: -1 }).ok,
  ).toBe(false);
  expect(editor.city.parking![original.id]!.capacity).toBe(1200);
});

test('explicit garage entries follow lane drops and splits, delete cleanly and undo', () => {
  const city = grid5x5();
  const road = Object.values(city.roads).find((road) => road.lanes.length === 2)!;
  const parkingId = allocateId(city, 'pk');
  const connector = {
    id: allocateId(city, 'c'),
    roadId: road.id,
    lane: 1,
    positionM: 70,
    direction: 'both' as const,
    throughputPerMin: 30,
  };
  city.parking = {
    [parkingId]: {
      id: parkingId,
      kind: 'garage',
      name: 'Public garage',
      access: 'public',
      capacity: 10,
      placeId: null,
      connectors: [connector],
      shape: { kind: 'point', pos: { x: 100, y: 20 } },
      provenance: { source: 'authored' },
    },
  };
  const editor = createEditor(city);
  expect(
    editor.apply({ kind: 'setRoadLanes', roadId: road.id, lanes: road.lanes.slice(0, 1) }).ok,
  ).toBe(true);
  expect(editor.city.parking![parkingId]!.connectors[0]!.lane).toBe(0);
  expect(editor.apply({ kind: 'splitRoad', roadId: road.id, atM: 60 }).ok).toBe(true);
  const entry = editor.city.parking![parkingId]!.connectors[0]!;
  expect(entry.roadId).not.toBe(road.id);
  expect(editor.compiled.index.connector.has(connector.id)).toBe(true);
  expect(editor.apply({ kind: 'deleteRoad', roadId: entry.roadId }).ok).toBe(true);
  expect(editor.city.parking![parkingId]!.connectors).toEqual([]);
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city.parking![parkingId]!.connectors).toEqual([entry]);
});

test('a newly added place keeps one saved garage through later edits and undo', () => {
  const editor = createEditor(grid5x5());
  const place = Object.values(editor.city.places)[0]!;
  expect(
    editor.apply({ kind: 'addPlace', place: { ...place, name: 'New homes', connectors: [] } }).ok,
  ).toBe(true);
  const added = Object.values(editor.city.places).find(({ name }) => name === 'New homes')!;
  const garage = Object.values(editor.city.parking!).find(({ placeId }) => placeId === added.id)!;
  expect(garage.provenance.inferred).toContain('implicitGarage');
  expect(
    editor.apply({
      kind: 'setRoadAttributes',
      roadId: Object.keys(editor.city.roads)[0]!,
      name: 'Renamed',
    }).ok,
  ).toBe(true);
  expect(editor.compiled.parking[editor.compiled.index.parking.get(garage.id)!]!.source).toBe(
    garage,
  );
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city.places[added.id]).toBeUndefined();
  expect(editor.city.parking![garage.id]).toBeUndefined();
  expect(editor.redo()?.ok).toBe(true);
  expect(editor.city.parking![garage.id]).toEqual(garage);
  expect(editor.apply({ kind: 'deletePlace', placeId: added.id }).ok).toBe(true);
  expect(editor.city.parking![garage.id]).toBeUndefined();
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city.parking![garage.id]).toEqual(garage);
});
