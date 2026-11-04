import { expect, test } from 'vitest';
import { PlaceBrush, insideRing, ringArea } from './place-brush';

test('round brush unions sparse pointer samples without filling a concave bend', () => {
  const brush = new PlaceBrush();
  brush.paint({ x: 0, y: 0 });
  brush.paint({ x: 100, y: 0 });
  brush.paint({ x: 100, y: 100 });
  const ring = brush.ring();
  expect(ring.length).toBeLessThanOrEqual(48);
  expect(insideRing({ x: 50, y: 0 }, ring)).toBe(true);
  expect(insideRing({ x: 100, y: 50 }, ring)).toBe(true);
  expect(insideRing({ x: 50, y: 50 }, ring)).toBe(false);
  expect(ringArea(ring)).toBeGreaterThan(7000);
  expect(ringArea(ring)).toBeLessThan(8500);
});

test('extending preserves the old area and loop strokes produce a bounded single ring', () => {
  const first = new PlaceBrush();
  first.paint({ x: 0, y: 0 });
  first.paint({ x: 80, y: 0 });
  const old = first.ring();
  const extended = new PlaceBrush();
  extended.include(old);
  extended.paint({ x: 80, y: 0 });
  extended.paint({ x: 80, y: 80 });
  extended.paint({ x: 0, y: 80 });
  extended.paint({ x: 0, y: 0 });
  const ring = extended.ring();
  expect(ring.length).toBeLessThanOrEqual(48);
  expect(ringArea(ring)).toBeGreaterThan(ringArea(old));
  expect(insideRing({ x: 40, y: 0 }, ring)).toBe(true);
  expect(insideRing({ x: 40, y: 40 }, ring)).toBe(true);
});
