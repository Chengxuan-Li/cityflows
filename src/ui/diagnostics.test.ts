import { expect, it } from 'vitest';
import { grid5x5 } from '../fixtures/grid5x5';
import { compile } from '../network';
import { groupDiagnostics } from './diagnostics';

it('keeps the grid lane drops as 15 notes outside the validation badge count', () => {
  const result = compile(grid5x5());
  expect(result.ok).toBe(true);
  const { issues, notes } = groupDiagnostics(result.diagnostics);
  expect(issues).toHaveLength(0);
  expect(notes).toHaveLength(15);
  expect(notes.every((note) => note.code === 'lane_requires_merge')).toBe(true);
});

it('counts errors and warnings as issues in severity order, leaving notes last', () => {
  const diagnostic = { code: 'test', refs: [], message: 'Test diagnostic' };
  const groups = groupDiagnostics([
    { ...diagnostic, severity: 'info' },
    { ...diagnostic, severity: 'warning' },
    { ...diagnostic, severity: 'error' },
    { ...diagnostic, severity: 'warning' },
  ]);
  expect(groups.issues.map((d) => d.severity)).toEqual(['error', 'warning', 'warning']);
  expect(groups.notes.map((d) => d.severity)).toEqual(['info']);
});
