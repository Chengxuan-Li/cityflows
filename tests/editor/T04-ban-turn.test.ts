import { expect, it } from 'vitest';
import { createEditor } from '../../src/editor';
import { grid5x5 } from '../../src/fixtures/grid5x5';

it('T04 removes a banned turn from the compiled network and restores it when cleared', () => {
  const city = grid5x5();
  const initial = createEditor(city);
  const movement = initial.compiled.movements.find(({ turn }) => turn === 'right')!;
  const nodeId = initial.compiled.nodes[movement.node]!.id;
  const roadId = (lane: number) => initial.compiled.roads[initial.compiled.lanes[lane]!.road]!.id;
  const rule = { from: roadId(movement.fromLane), to: roadId(movement.toLane) };
  const existing = { ...rule, allowed: true, provenance: { source: 'authored' as const } };
  city.nodes[nodeId]!.turnRules = [existing, { ...existing }];
  const editor = createEditor(city);

  expect(
    editor.apply({
      kind: 'setTurnRule',
      nodeId,
      rule: { ...rule, allowed: false, provenance: { source: 'authored' } },
    }).ok,
  ).toBe(true);
  expect(editor.compiled.index.movement.has(movement.id)).toBe(false);
  expect(editor.apply({ kind: 'clearTurnRule', nodeId, rule }).ok).toBe(true);
  expect(editor.compiled.index.movement.has(movement.id)).toBe(true);
});
