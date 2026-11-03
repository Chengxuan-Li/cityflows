import { expect, it } from 'vitest';
import { disconnected } from '../../src/fixtures/disconnected';
import { compile } from '../../src/network';

it('reports disconnected lanes, dead ends, and unreachable connectors as warnings', () => {
  const result = compile(disconnected());
  expect(result.ok).toBe(true);
  for (const code of ['disconnected_component', 'dead_end', 'connector_unreachable']) {
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code,
        severity: 'warning',
        refs: expect.arrayContaining([expect.any(String)]),
      }),
    );
  }
});
