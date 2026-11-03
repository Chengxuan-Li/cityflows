import { expect, it } from 'vitest';
import { createEditor } from '../../src/editor';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { allocateId } from '../../src/schema';

it('clamps connectors to a remaining curb lane and drops only rules with removed lanes', () => {
  const city = grid5x5();
  const road = Object.values(city.roads).find((road) => road.lanes.length === 2)!;
  const outgoing = Object.values(city.roads).find((other) => other.from === road.to)!;
  const place = Object.values(city.places)[0]!;
  const connector = {
    ...place.connectors[0]!,
    id: allocateId(city, 'c'),
    roadId: road.id,
    lane: 1,
  };
  place.connectors.push(connector);
  const kept = {
    from: road.id,
    to: outgoing.id,
    fromLane: 0,
    allowed: false,
    provenance: road.provenance,
  };
  city.nodes[road.to]!.turnRules.push(kept, { ...kept, fromLane: 1 });
  const editor = createEditor(city);

  const result = editor.apply({
    kind: 'setRoadLanes',
    roadId: road.id,
    lanes: road.lanes.slice(0, 1),
  });
  expect(result.ok).toBe(true);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: 'warning',
      refs: expect.arrayContaining([connector.id]),
    }),
  );
  expect(editor.city.places[place.id]!.connectors).toContainEqual({ ...connector, lane: 0 });
  expect(editor.city.nodes[road.to]!.turnRules).toEqual([kept]);
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city).toEqual({ ...city, version: 2 });
});
