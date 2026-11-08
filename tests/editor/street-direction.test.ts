import { expect, it } from 'vitest';
import { createEditor } from '../../src/editor';
import { grid5x5 } from '../../src/fixtures/grid5x5';

it('makes a street one-way, removes stale references and recreates the opposite road', () => {
  const city = createEditor(grid5x5()).city;
  const place = Object.values(city.places)[0]!;
  const connector = place.connectors[0]!;
  const removed = city.roads[connector.roadId]!;
  const streetGroupId = removed.streetGroupId!;
  const kept = Object.values(city.roads).find(
    (road) => road.streetGroupId === streetGroupId && road.id !== removed.id,
  )!;
  const junction = city.nodes[removed.from]!;
  junction.turnRules = [
    { from: kept.id, to: removed.id, allowed: true, provenance: kept.provenance },
  ];
  const editor = createEditor(city);

  const result = editor.apply({ kind: 'setStreetDirection', streetGroupId, direction: kept.id });
  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning',
        refs: expect.arrayContaining([connector.id]),
      }),
      expect.objectContaining({
        severity: 'warning',
        refs: expect.arrayContaining([junction.id, removed.id]),
      }),
    ]),
  );
  expect(editor.city.roads[removed.id]).toBeUndefined();
  expect(editor.city.roads[kept.id]!.lateralOffsetM).toBe(0);
  expect(editor.city.nodes[junction.id]!.turnRules).toEqual([]);
  expect(editor.city.places[place.id]!.connectors).not.toContainEqual(connector);

  expect(editor.apply({ kind: 'setStreetDirection', streetGroupId, direction: 'both' }).ok).toBe(
    true,
  );
  const opposite = editor.city.roads[`r:${city.nextId}`];
  expect(opposite).toMatchObject({
    from: kept.to,
    to: kept.from,
    centerline: [...kept.centerline].reverse(),
    streetGroupId,
    lateralOffsetM: 1.5,
  });
  expect(editor.city.roads[kept.id]!.lateralOffsetM).toBe(1.5);
  expect(editor.city.nextId).toBe(city.nextId + 1);
});
