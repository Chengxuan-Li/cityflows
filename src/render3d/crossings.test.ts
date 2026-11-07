import { expect, it } from 'vitest';
import { signalApproach } from '../fixtures/signal-approach';
import { compile } from '../network';
import { crossingStripes } from '../render/layers/roads';
import { buildGeometry } from './geometry';
import { heightAt, roadStation } from './heights';

it('drapes the existing pedestrian stripes over the road height', () => {
  const source = signalApproach(98);
  const result = compile(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const city = result.compiled;
  const geometry = buildGeometry(city, source);
  const positions = geometry.crossings.getAttribute('position');
  expect(positions.count).toBeGreaterThan(0);
  const road = city.roads[0]!;
  const stripe = crossingStripes(city, road, true, source)[0]!;
  expect(stripe).toBeDefined();
  const p = stripe[0]!;
  const z = heightAt(geometry.heights.roads[road.idx]!, roadStation(road, p)) + 0.02;
  expect(
    Array.from({ length: positions.count }, (_, i) => i).some(
      (i) =>
        Math.hypot(positions.getX(i) - p.x, positions.getZ(i) - p.y, positions.getY(i) - z) < 0.001,
    ),
  ).toBe(true);
  for (const buffer of [
    geometry.surfaces,
    geometry.slabs,
    geometry.markings,
    geometry.crossings,
    geometry.places,
  ])
    buffer.dispose();
});
