import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { junctions } from '../../src/fixtures/junctions';
import { compile } from '../../src/network';
import { createEditor } from '../../src/editor';
import { ramp } from '../../src/fixtures/ramp';
import { junctionOverlaps, movementsOutside } from './junction-audit';

test('T20: fixture lanes do not cross and movements stay inside the outline', () => {
  const result = compile(junctions());
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(junctionOverlaps(result.compiled)).toEqual([]);
  expect(movementsOutside(result.compiled)).toEqual([]);
  const merge = result.compiled.nodes.find((n) => n.pos.x === 550 && n.pos.y === 550)!;
  // Both two-lane approaches overlap the same two exit lanes: crossing movements remain a junction.
  // TASK-074: the approaches are one direction now, and the slip road's curved block crosses
  // the motorway's 15 to 20 m out, so the TASK-061 rule between them caps both (was 4.5).
  // TASK-083: the cut is square to the road's own reference line and measured along it, and the
  // cap is the widest neighbouring end's extent plus 1 m where that exceeds 10 m (as before), so
  // the first approach is cut at 11.5 m.
  expect(merge.setbacks).toEqual([11.5, 4.5, 10]);
  const tees = result.compiled.nodes.filter((n) => n.pos.y === 550 && [0, 75].includes(n.pos.x));
  expect(
    result.compiled.roads.filter(
      (r) => tees.some((n) => n.idx === r.from) && tees.some((n) => n.idx === r.to),
    ),
  ).toHaveLength(2);
});

test('T20: through sections have zero setbacks and no junction surface', () => {
  const { city, node, road } = buildCity('Through', 1);
  const center = node(0, 0);
  road(node(-100, 0), center, { lanes: 2 });
  road(center, node(100, 0), { lanes: 2 });
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const compiled = result.compiled.nodes[result.compiled.index.node.get(center.id)!]!;
  expect(compiled.setbacks).toEqual([0, 0]);
  expect(compiled.outline).toEqual([]);
});

test('T20: aligned displaced lane blocks ease into a continuous surface', () => {
  const { city, node, road } = buildCity('Displaced continuation', 1);
  const center = node(0, 0);
  road(node(-100, 0), center, { lanes: 2 });
  road(center, node(100, 0), { lanes: 2 }).lateralOffsetM = 10;
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const compiled = result.compiled.nodes[result.compiled.index.node.get(center.id)!]!;
  expect(compiled.setbacks).toEqual([0, 0]);
  expect(compiled.outline).toEqual([]);
  expect(movementsOutside(result.compiled)).toEqual([]);
});

test.each([0.49, 0.51])('T20: continuation aligns small lateral offsets (%s)', (offset) => {
  const { city, node, road } = buildCity('Nearly collinear', 1);
  const center = node(0, 0);
  road(node(-100, 0), center);
  road(center, node(100, 0)).lateralOffsetM = offset;
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.compiled.movements[0]!.polyline).toHaveLength(2);
  expect(result.compiled.movements[0]!.lengthM).toBeLessThan(0.01);
});

test.each(['right', 'left'] as const)(
  'T20: a 60 m ramp-only curb lane drops, removal and undo are exact (%s)',
  (side) => {
    const city = ramp();
    city.drivingSide = side;
    const roads = Object.values(city.roads);
    const motorway = roads.find((r) => r.centerline[0]!.x === 0)!;
    const source = roads.find((r) => r.roadClass === 'ramp' && r.centerline[0]!.x < 0)!;
    const editor = createEditor(city);
    const initial = editor.city;
    const result = editor.apply({
      kind: 'addRamp',
      from: { roadId: source.id, atM: 30 },
      to: { roadId: motorway.id, atM: 100 },
    });
    expect(result.ok).toBe(true);
    const added = Object.values(editor.city.roads).find(
      (r) => !city.roads[r.id] && r.roadClass === 'ramp' && r.centerline.length > 2,
    )!;
    const taper = Object.values(editor.city.roads).find((r) => r.from === added.to)!;
    const end = editor.city.nodes[taper.to]!;
    expect(end.pos.x - editor.city.nodes[added.to]!.pos.x).toBeCloseTo(60);
    expect(taper.lanes).toHaveLength(3);
    const curb = side === 'right' ? 2 : 0;
    const lane = editor.compiled.lanes[editor.compiled.index.lane.get(`${taper.id}#${curb}`)!]!;
    expect(
      lane.in.map(
        (i) =>
          editor.compiled.roads[
            editor.compiled.lanes[editor.compiled.movements[i]!.fromLane]!.road
          ]!.id,
      ),
    ).toEqual([added.id]);
    expect(
      result.ok &&
        result.diagnostics.some(
          (d) => d.code === 'lane_requires_merge' && d.refs.includes(lane.id),
        ),
    ).toBe(true);
    const built = structuredClone(editor.city);
    expect(editor.apply({ kind: 'removeRamp', roadId: added.id }).ok).toBe(true);
    expect(editor.city.roads).toEqual(city.roads);
    expect(editor.city.nodes).toEqual(city.nodes);
    expect(editor.undo()!.ok).toBe(true);
    expect(editor.city).toEqual({ ...built, version: editor.city.version });
    expect(editor.undo()!.ok).toBe(true);
    expect(editor.city).toEqual({ ...initial, version: editor.city.version });
  },
);

test('T20: acute Y converging legs set back farther than the stem', () => {
  const city = junctions();
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const net = result.compiled;
  const center = net.nodes[net.index.node.get('n:1')!]!;
  const ends = net.roads.filter((r) => r.from === center.idx || r.to === center.idx);
  const stem = ends.findIndex(
    (r) =>
      city.nodes[r.from === center.idx ? net.nodes[r.to]!.id : net.nodes[r.from]!.id]!.pos.x > 0,
  );
  expect(Math.max(...center.setbacks)).toBeGreaterThan(center.setbacks[stem]!);
  expect(center.outline[0]).toEqual(center.outline.at(-1));
  for (const m of net.movements) {
    expect(m.polyline[0]).toEqual(net.lanes[m.fromLane]!.polyline.at(-1));
    expect(m.polyline.at(-1)).toEqual(net.lanes[m.toLane]!.polyline[0]);
  }
});
