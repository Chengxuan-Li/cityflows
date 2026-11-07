import { expect, test } from 'vitest';
import { createEditor } from '../../src/editor';
import { buildCity } from '../../src/fixtures/build-city';
import { pointAtDistance } from '../../src/geo/polyline';

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
    expect(ramp.lanes[0]!.allowed).toContain('van');
    expect(
      Object.values(editor.city.roads).every((r) =>
        r.lanes.every((lane) => lane.allowed.includes('van')),
      ),
    ).toBe(true);
    expect(ramp.speedLimitMps).toBe(to.speedLimitMps);
    expect(ramp.centerline.length).toBeGreaterThan(2);
    const lane = editor.compiled.index.lane.get(`${ramp.id}#0`)!;
    // Right traffic: the curb lane feeds the ramp. Left traffic: the curb lane (lane 0) still
    // does, and since TASK-085 so does lane 1, which lines up with the ramp on its right.
    expect(
      editor.compiled.lanes[lane]!.in.map(
        (i) => editor.compiled.lanes[editor.compiled.movements[i]!.fromLane]!.id,
      ),
    ).toEqual(side === 'right' ? [`${from.id}#1`] : [`${from.id}#0`, `${from.id}#1`]);
    expect(editor.compiled.lanes[lane]!.in.map((i) => editor.compiled.movements[i]!.turn)).toEqual(
      side === 'right' ? ['diverge'] : ['diverge', 'diverge'],
    );
    expect(editor.compiled.lanes[lane]!.out.map((i) => editor.compiled.movements[i]!.turn)).toEqual(
      ['merge'],
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

test('removing a taper does not discard intervening turn edits', () => {
  const { city, node, road } = buildCity('Edited taper', 1);
  const a = road(node(0, 0), node(400, 0), { lanes: 2 });
  const b = road(node(0, 100), node(400, 100), { lanes: 2 });
  const editor = createEditor(city);
  expect(
    editor.apply({
      kind: 'addRamp',
      from: { roadId: a.id, atM: 100 },
      to: { roadId: b.id, atM: 200 },
    }).ok,
  ).toBe(true);
  const ramp = Object.values(editor.city.roads).find((r) => r.roadClass === 'ramp')!;
  const rule = editor.city.nodes[ramp.to]!.turnRules.find((r) => r.from !== ramp.id && r.allowed)!;
  expect(
    editor.apply({ kind: 'setTurnRule', nodeId: ramp.to, rule: { ...rule, allowed: false } }).ok,
  ).toBe(true);
  const before = editor.city;
  expect(() => editor.apply({ kind: 'removeRamp', roadId: ramp.id })).toThrow(/intervening edits/);
  expect(editor.city).toBe(before);
});

test.each(['right', 'left'] as const)(
  'removing a taper preserves connector world positions (%s)',
  (side) => {
    const { city, node, road, place } = buildCity('Taper connector', 1);
    city.drivingSide = side;
    const a = road(node(0, 0), node(400, 0), { lanes: 2 });
    const b = road(node(0, 100), node(400, 100), { lanes: 2 });
    place('Destination', 'work', { x: 230, y: 100 }, [
      { road: b, lane: 0, positionM: 230, direction: 'in' },
    ]);
    const editor = createEditor(city);
    const position = () => {
      const c = editor.compiled.connectors[0]!;
      const lane = editor.compiled.lanes[c.lane]!;
      return pointAtDistance(lane.polyline, lane.cumulative, c.positionM);
    };
    const before = position();
    expect(
      editor.apply({
        kind: 'addRamp',
        from: { roadId: a.id, atM: 100 },
        to: { roadId: b.id, atM: 200 },
      }).ok,
    ).toBe(true);
    expect(position().x).toBeCloseTo(before.x, 8);
    const ramp = Object.values(editor.city.roads).find((r) => r.roadClass === 'ramp')!;
    expect(editor.apply({ kind: 'removeRamp', roadId: ramp.id }).ok).toBe(true);
    expect(position().x).toBeCloseTo(before.x, 8);
    expect(position().y).toBeCloseTo(before.y, 8);
  },
);

test('ramps on paired streets diverge from the curb, enter the taper lane and undo exactly', () => {
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
  expect(exits.map((m) => m.turn)).toEqual(['merge']);
  expect(editor.compiled.lanes[entries[0]!.fromLane]!.lane).toBe(1);
  expect(exits.map((m) => editor.compiled.lanes[m.toLane]!.lane)).toEqual([2]);
  expect(editor.undo()!.ok).toBe(true);
  expect(editor.city).toEqual({ ...city, version: editor.city.version });
});
