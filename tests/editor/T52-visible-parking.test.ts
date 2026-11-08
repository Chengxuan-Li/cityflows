import { expect, test } from 'vitest';
import { createEditor } from '../../src/editor';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { openProject } from '../../src/project/open';
import { saveProject } from '../../src/project/save';
import { allocateId, type City } from '../../src/schema';

function fixture() {
  const { city, node, road, place } = buildCity('Parking edit', 1);
  const street = road(node(0, 0), node(120, 0));
  place('Homes', 'residential', { x: 60, y: 15 }, [
    { road: street, direction: 'both', positionM: 60 },
  ]);
  city.places[Object.keys(city.places)[0]!]!.population = 10;
  return { city, roadId: street.id };
}

const strips = (city: City, roadId: string, side = 'right') =>
  Object.values(city.parking ?? {}).filter(
    ({ strip }) => strip?.roadId === roadId && strip.side === side,
  );

test('T52 strip edits respect driveway and junction clearance, undo exactly and save history', async () => {
  const { city, roadId } = fixture();
  const editor = createEditor(city);
  const original = editor.city;
  // Connector distances start at the trimmed lane, whereas strip stations start at the node.
  const lane =
    editor.compiled.lanes[
      editor.compiled.roads[editor.compiled.index.road.get(roadId)!]!.lanes[0]!
    ]!;
  const drivewayM = lane.polyline[0]!.x + 60;
  expect(
    editor.apply({ kind: 'setRoadParking', roadId, side: 'right', layout: 'parallel' }).ok,
  ).toBe(true);
  const added = editor.city;
  const runs = strips(added, roadId);
  expect(runs).toHaveLength(2);
  for (const facility of runs) {
    const strip = facility.strip!;
    expect(strip.fromM).toBeGreaterThanOrEqual(5);
    expect(strip.toM).toBeLessThanOrEqual(115);
    expect(Math.max(drivewayM - strip.toM, strip.fromM - drivewayM)).toBeGreaterThanOrEqual(
      3 - 1e-8,
    );
    expect(facility.capacity).toBe(Math.floor((strip.toM - strip.fromM) / 5.5));
    expect(facility.provenance).toEqual({ source: 'authored' });
  }
  expect(editor.city.roads).toEqual(original.roads);
  expect(editor.city.nodes).toEqual(original.nodes);
  expect(editor.city.places).toEqual(original.places);
  expect(
    editor.apply({
      kind: 'setRoadParking',
      roadId,
      side: 'right',
      layout: 'perpendicular',
      access: 'private',
    }).ok,
  ).toBe(true);
  const changed = editor.city;
  expect(
    strips(changed, roadId).every(
      (p) => p.strip!.layout === 'perpendicular' && p.access === 'private',
    ),
  ).toBe(true);
  expect(strips(changed, roadId).reduce((sum, p) => sum + p.capacity, 0)).toBeGreaterThan(
    runs.reduce((sum, p) => sum + p.capacity, 0),
  );
  expect(editor.apply({ kind: 'setRoadParking', roadId, side: 'right', layout: null }).ok).toBe(
    true,
  );
  expect(strips(editor.city, roadId)).toEqual([]);
  expect(editor.undo()?.ok).toBe(true);
  expect({ ...editor.city, version: changed.version }).toEqual(changed);
  expect(editor.undo()?.ok).toBe(true);
  expect({ ...editor.city, version: added.version }).toEqual(added);
  expect(editor.undo()?.ok).toBe(true);
  expect({ ...editor.city, version: original.version }).toEqual(original);
  expect(editor.redo()?.ok).toBe(true);
  expect({ ...editor.city, version: added.version }).toEqual(added);
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
});

test('T52 strips follow road splits, reversals and deletion with exact undo', () => {
  const { city, roadId } = fixture();
  const editor = createEditor(city);
  expect(
    editor.apply({ kind: 'setRoadParking', roadId, side: 'right', layout: 'parallel' }).ok,
  ).toBe(true);
  const original = editor.city;
  expect(editor.apply({ kind: 'splitRoad', roadId, atM: 60 }).ok).toBe(true);
  const downstream = Object.values(editor.city.roads).find((road) => road.id !== roadId)!;
  const afterSplit = Object.values(editor.city.parking!).filter((p) => p.kind === 'roadside');
  expect(afterSplit).toHaveLength(2);
  expect(strips(editor.city, downstream.id)).toHaveLength(1);
  expect(strips(editor.city, roadId)[0]!.strip!.toM).toBeLessThanOrEqual(60);
  expect(strips(editor.city, downstream.id)[0]!.strip!.fromM).toBeGreaterThanOrEqual(0);
  const split = editor.city;
  expect(editor.apply({ kind: 'mergeRoads', roadId, otherRoadId: downstream.id }).ok).toBe(true);
  expect(strips(editor.city, roadId)).toHaveLength(2);
  expect(strips(editor.city, downstream.id)).toEqual([]);
  expect(editor.undo()?.ok).toBe(true);
  expect({ ...editor.city, version: split.version }).toEqual(split);
  expect(editor.undo()?.ok).toBe(true);
  expect({ ...editor.city, version: original.version }).toEqual(original);
  expect(editor.apply({ kind: 'reverseRoad', roadId }).ok).toBe(true);
  expect(strips(editor.city, roadId)).toEqual([]);
  const reversed = strips(editor.city, roadId, 'left');
  expect(reversed).toHaveLength(2);
  expect(reversed.map((p) => [p.strip!.fromM, p.strip!.toM]).sort((a, b) => a[0]! - b[0]!)).toEqual(
    strips(original, roadId)
      .map((p) => [120 - p.strip!.toM, 120 - p.strip!.fromM])
      .sort((a, b) => a[0]! - b[0]!),
  );
  expect(editor.undo()?.ok).toBe(true);
  expect({ ...editor.city, version: original.version }).toEqual(original);
  expect(editor.apply({ kind: 'deleteRoad', roadId }).ok).toBe(true);
  expect(Object.values(editor.city.parking!).filter((p) => p.kind === 'roadside')).toEqual([]);
  expect(editor.undo()?.ok).toBe(true);
  expect({ ...editor.city, version: original.version }).toEqual(original);
});

test('T52 roadside edits leave no slots on a bus-only curb lane', () => {
  const { city, roadId } = fixture();
  city.roads[roadId]!.lanes[0]!.allowed = ['bus'];
  const editor = createEditor(city);
  const result = editor.apply({
    kind: 'setRoadParking',
    roadId,
    side: 'right',
    layout: 'parallel',
  });
  expect(result.ok).toBe(true);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'parking_unreachable', severity: 'warning' }),
  );
  expect(strips(editor.city, roadId)).toEqual([]);
  expect(editor.compiled.parkingSpaces ?? []).toEqual([]);
});

test('T52 wider edited strips keep saved building exclusions with surroundings disabled', () => {
  const { city, roadId } = fixture();
  const editor = createEditor(city);
  expect(
    editor.apply({ kind: 'setRoadParking', roadId, side: 'right', layout: 'parallel' }).ok,
  ).toBe(true);
  const exclusion = [
    { x: 20, y: 4 },
    { x: 40, y: 4 },
    { x: 40, y: 6 },
    { x: 20, y: 6 },
  ];
  const loaded = createEditor({
    ...editor.city,
    parking: Object.fromEntries(
      Object.entries(editor.city.parking!).map(([id, p]) => [
        id,
        p.strip ? { ...p, exclusions: [exclusion] } : p,
      ]),
    ),
  });
  expect(loaded.city.context).toBeUndefined();
  expect(
    loaded.apply({ kind: 'setRoadParking', roadId, side: 'right', layout: 'perpendicular' }).ok,
  ).toBe(true);
  const runs = strips(loaded.city, roadId);
  expect(runs.length).toBeGreaterThan(0);
  for (const p of runs) {
    expect(p.exclusions).toContainEqual(exclusion);
    expect(p.strip!.toM <= 19 || p.strip!.fromM >= 41).toBe(true);
  }
});

test('T52 shortening a stripped street keeps distinct slots inside the safe run and undoes exactly', () => {
  const { city, roadId } = fixture();
  const id = allocateId(city, 'pk');
  const exclusion = [
    { x: 15, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 15 },
    { x: 15, y: 15 },
  ];
  city.parking = {
    [id]: {
      id,
      kind: 'roadside',
      name: 'Mapped curb',
      capacity: 8,
      access: 'private',
      placeId: null,
      connectors: [],
      shape: null,
      strip: { roadId, side: 'right', fromM: 65.5, toM: 110, layout: 'parallel' },
      provenance: { source: 'osm', osmIds: [103], inferred: ['capacity'] },
      exclusions: [exclusion],
    },
  };
  const editor = createEditor(city),
    original = editor.city;
  expect(
    editor.apply({ kind: 'moveNode', nodeId: city.roads[roadId]!.to, pos: { x: 60, y: 0 } }).ok,
  ).toBe(true);
  const facility = editor.city.parking![id]!;
  expect(facility).toBeDefined();
  expect(facility.strip!.fromM).toBeGreaterThanOrEqual(5);
  expect(facility.strip!.toM).toBeLessThanOrEqual(55);
  expect(facility.strip!.layout).toBe('parallel');
  expect(facility.access).toBe('private');
  expect(facility.provenance).toEqual(original.parking![id]!.provenance);
  expect(facility.exclusions).toEqual([exclusion]);
  const spaces = editor.compiled.parkingSpaces!;
  expect(spaces.length).toBeGreaterThan(0);
  expect(new Set(spaces.map((space) => `${space.position.x}:${space.position.y}`)).size).toBe(
    spaces.length,
  );
  for (const space of spaces) {
    expect(space.position.x).toBeGreaterThanOrEqual(5);
    expect(space.position.x).toBeLessThanOrEqual(55);
  }
  expect(editor.undo()?.ok).toBe(true);
  expect({ ...editor.city, version: original.version }).toEqual(original);
});
