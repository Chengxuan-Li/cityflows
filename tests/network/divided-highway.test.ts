import { expect, it } from 'vitest';
import { dividedHighway } from '../../src/fixtures/divided-highway';
import { compile } from '../../src/network';

it('only joins roads at shared nodes, including at the at-grade crossing', () => {
  const city = dividedHighway();
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { roads, lanes, movements } = result.compiled;
  const bridge = new Set(
    Object.values(city.roads)
      .filter((r) => city.nodes[r.from]!.layer === 1)
      .map((r) => r.id),
  );
  expect(bridge.size).toBeGreaterThan(0);
  let atGradeTurns = 0;
  for (const movement of movements) {
    const from = roads[lanes[movement.fromLane]!.road]!;
    const to = roads[lanes[movement.toLane]!.road]!;
    expect(from.to).toBe(to.from);
    expect(bridge.has(from.id)).toBe(bridge.has(to.id));
    if (from.roadClass === 'primary' && to.roadClass === 'residential') atGradeTurns++;
    if (from.roadClass === 'primary' && to.roadClass === 'primary') {
      expect(movement.turn).toBe('through');
    }
  }
  expect(atGradeTurns).toBe(4);
});
