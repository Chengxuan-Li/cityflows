import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { signalApproach } from '../fixtures/signal-approach';
import { compile } from '../network';
import { cityHeights } from './heights';
import { signalLayout, signalRotationY } from './signals';

it('faces all four approaches upstream and hangs their heads from curbside supports', () => {
  const source = signalApproach(98);
  const result = compile(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const city = result.compiled;
  const layout = signalLayout(city, cityHeights(city, source));
  expect(layout.supports).toHaveLength(4);
  expect(layout.heads.length).toBeGreaterThan(4);
  for (const head of layout.heads) {
    const normal = new Vector3(0, 0, 1).applyAxisAngle(
      new Vector3(0, 1, 0),
      signalRotationY(head.heading),
    );
    expect(normal.x * Math.cos(head.heading) + normal.z * Math.sin(head.heading)).toBeCloseTo(-1);
    const support = layout.supports.find(
      (support) => support.road === city.lanes[head.lane]!.road,
    )!;
    const right = { x: -Math.sin(head.heading), y: Math.cos(head.heading) };
    expect((support.x - head.x) * right.x + (support.y - head.y) * right.y).toBeGreaterThan(0.5);
    expect(support.clearanceM).toBeGreaterThanOrEqual(5);
  }
});
