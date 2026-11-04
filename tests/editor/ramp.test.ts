import { expect, test } from 'vitest';
import { createEditor } from '../../src/editor';
import { buildCity } from '../../src/fixtures/build-city';

test.each(['right', 'left'] as const)(
  'ramp splits, compiles and undoes exactly (%s traffic)',
  (side) => {
    const { city, node, road, place } = buildCity('Ramp editing', 1);
    city.drivingSide = side;
    const from = road(node(0, 0), node(400, 0), { lanes: 2 });
    const to = road(node(0, 100), node(400, 100), {
      lanes: 2,
      roadClass: 'motorway',
      speedKmh: 100,
    });
    place('Origin', 'residential', { x: 0, y: 0 }, [
      { road: from, direction: 'out', positionM: 20 },
    ]);
    place('Destination', 'work', { x: 400, y: 100 }, [
      { road: to, direction: 'in', positionM: 350 },
    ]);
    const before = structuredClone(city);
    const editor = createEditor(city);
    const result = editor.apply({
      kind: 'addRamp',
      from: { roadId: from.id, atM: 100 },
      to: { roadId: to.id, atM: 300 },
    });
    expect(result.ok).toBe(true);
    const ramp = Object.values(editor.city.roads).find((r) => r.roadClass === 'ramp')!;
    expect(ramp.lanes).toHaveLength(1);
    expect(ramp.speedLimitMps).toBe(to.speedLimitMps);
    expect(ramp.centerline.length).toBeGreaterThan(2);
    const lane = editor.compiled.index.lane.get(`${ramp.id}#0`)!;
    expect(editor.compiled.lanes[lane]!.in.map((i) => editor.compiled.movements[i]!.turn)).toEqual([
      'diverge',
    ]);
    expect(editor.compiled.lanes[lane]!.out.map((i) => editor.compiled.movements[i]!.turn)).toEqual(
      ['merge', 'merge'],
    );
    const built = structuredClone(editor.city);
    expect(editor.apply({ kind: 'removeRamp', roadId: ramp.id }).ok).toBe(true);
    expect(editor.city.roads).toEqual(before.roads);
    expect(editor.city.nodes).toEqual(before.nodes);
    expect(editor.undo()!.ok).toBe(true);
    expect(editor.city).toEqual({ ...built, version: editor.city.version });
    expect(editor.undo()!.ok).toBe(true);
    expect(editor.city).toEqual({ ...before, version: editor.city.version });
    expect(city).toEqual(before);
  },
);

test('invalid ramp endpoints leave city and history untouched', () => {
  const { city, node, road } = buildCity('Invalid ramp', 1);
  const a = road(node(0, 0), node(100, 0));
  const b = road(node(0, 20), node(100, 20));
  const editor = createEditor(city);
  expect(() =>
    editor.apply({
      kind: 'addRamp',
      from: { roadId: a.id, atM: 0 },
      to: { roadId: b.id, atM: 50 },
    }),
  ).toThrow(/inside/);
  expect(editor.city).toBe(city);
  expect(editor.canUndo).toBe(false);
});

test('ramps on paired streets diverge from the curb, merge into both lanes and undo exactly', () => {
  const { city, node, street } = buildCity('Paired ramp', 1);
  const [from] = street(node(0, 0), node(400, 0), 2);
  const [to] = street(node(0, 100), node(400, 100), 2);
  const editor = createEditor(city);
  expect(
    editor.apply({
      kind: 'addRamp',
      from: { roadId: from.id, atM: 100 },
      to: { roadId: to.id, atM: 300 },
    }).ok,
  ).toBe(true);
  const ramp = Object.values(editor.city.roads).find((r) => r.roadClass === 'ramp')!;
  const lane = editor.compiled.lanes[editor.compiled.index.lane.get(`${ramp.id}#0`)!]!;
  const entries = lane.in.map((i) => editor.compiled.movements[i]!);
  const exits = lane.out.map((i) => editor.compiled.movements[i]!);
  expect(entries.map((m) => m.turn)).toEqual(['diverge']);
  expect(exits.map((m) => m.turn)).toEqual(['merge', 'merge']);
  expect(editor.compiled.lanes[entries[0]!.fromLane]!.lane).toBe(1);
  expect(exits.map((m) => editor.compiled.lanes[m.toLane]!.lane)).toEqual([0, 1]);
  expect(editor.undo()!.ok).toBe(true);
  expect(editor.city).toEqual({ ...city, version: editor.city.version });
});
