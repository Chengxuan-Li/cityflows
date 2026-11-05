import { expect, it } from 'vitest';
import { disconnected } from '../../src/fixtures/disconnected';
import { buildCity } from '../../src/fixtures/build-city';
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

it.each(['right', 'left'] as const)(
  'names the lane that must merge before a narrowing under %s-hand traffic',
  (side) => {
    const { city, node, road } = buildCity('Narrowing diagnostic', 1);
    city.drivingSide = side;
    const join = node(100, 0);
    const from = road(node(0, 0), join, { lanes: 2 });
    const to = road(join, node(200, 0));
    const result = compile(city);
    expect(result.ok).toBe(true);
    const lane = `${from.id}#${side === 'right' ? 1 : 0}`;
    const notes = result.diagnostics.filter((d) => d.code === 'lane_requires_merge');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe('info');
    expect(notes[0]!.refs).toEqual([lane, to.id, join.id]);
    expect(notes[0]!.message).toContain(lane);
  },
);
