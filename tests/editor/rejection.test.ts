import { expect, it } from 'vitest';
import { createEditor } from '../../src/editor';
import { grid5x5 } from '../../src/fixtures/grid5x5';

it('rejects a conflicting signal batch without changing city, compiled state or undo/redo', () => {
  const city = grid5x5();
  const editor = createEditor(city);
  const roadId = Object.keys(city.roads)[0]!;
  const node = Object.values(city.nodes).find((node) => node.signal)!;
  const signal = node.signal!;

  expect(editor.apply({ kind: 'setRoadAttributes', roadId, name: 'Original edit' }).ok).toBe(true);
  expect(editor.undo()?.ok).toBe(true);
  const { city: before, compiled, history } = editor;
  const result = editor.apply({
    kind: 'batch',
    label: 'Conflicting signal',
    commands: [
      { kind: 'setRoadAttributes', roadId, name: 'Rejected edit' },
      {
        kind: 'setSignal',
        nodeId: node.id,
        signal: {
          ...signal,
          phases: [{ durationS: 30, groups: signal.phases.flatMap((phase) => phase.groups) }],
        },
      },
    ],
  });

  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'signal_conflict' }));
  expect(editor.city).toBe(before);
  expect(editor.compiled).toBe(compiled);
  expect(editor.history).toBe(history);
  expect(editor.canUndo).toBe(false);
  expect(editor.canRedo).toBe(true);
  expect(editor.redo()?.ok).toBe(true);
  expect(editor.city.roads[roadId]!.name).toBe('Original edit');
});

it('commits an edit that produces only warnings', () => {
  const editor = createEditor(grid5x5());
  const placeId = Object.keys(editor.city.places)[0]!;
  const result = editor.apply({ kind: 'setConnectors', placeId, connectors: [] });
  expect(result.ok).toBe(true);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'place_no_connector', severity: 'warning', refs: [placeId] }),
  );
  expect(editor.history).toHaveLength(1);
});
