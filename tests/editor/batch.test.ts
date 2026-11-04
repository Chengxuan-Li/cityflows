import { expect, it } from 'vitest';
import { createEditor } from '../../src/editor';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import type { Command } from '../../src/schema';

it('20 lane-count changes commit as one history entry and undo restores every road', () => {
  const city = grid5x5();
  const editor = createEditor(city);
  const roads = Object.values(city.roads).slice(0, 20);
  const commands: Command[] = roads.map((road) => ({
    kind: 'setRoadLanes',
    roadId: road.id,
    lanes: [road.lanes[0]!, road.lanes[0]!],
  }));
  expect(editor.apply({ kind: 'batch', label: 'Widen streets', commands }).ok).toBe(true);
  expect(editor.history).toHaveLength(1);
  for (const road of roads) expect(editor.city.roads[road.id]!.lanes).toHaveLength(2);
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city).toEqual({ ...city, version: editor.city.version });
  expect(editor.canUndo).toBe(false);
  expect(editor.redo()?.ok).toBe(true);
  for (const road of roads) expect(editor.city.roads[road.id]!.lanes).toHaveLength(2);
});

it.each([false, true])(
  'an invalid member commits nothing (nested: %s)',
  (nested) => {
    const editor = createEditor(grid5x5());
    editor.apply({ kind: 'setRoadAttributes', roadId: 'r:26', speedLimitMps: 10 });
    editor.undo();
    const { city, compiled, history } = editor;
    const commands: Command[] = [
      { kind: 'setRoadAttributes', roadId: 'r:28', speedLimitMps: 12 },
      { kind: 'setRoadLanes', roadId: 'r:26', lanes: [] },
    ];
    const result = editor.apply({
      kind: 'batch',
      label: 'Invalid batch',
      commands: nested ? [{ kind: 'batch', label: 'Inner', commands }] : commands,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.some(({ code }) => code === 'lane_invalid')).toBe(true);
    expect(editor.city).toBe(city);
    expect(editor.compiled).toBe(compiled);
    expect(editor.history).toBe(history);
    expect(editor.canRedo).toBe(true);
    expect(editor.redo()?.ok).toBe(true);
    expect(editor.city.roads['r:26']!.speedLimitMps).toBe(10);
  },
);
