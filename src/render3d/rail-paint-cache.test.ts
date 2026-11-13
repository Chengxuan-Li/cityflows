import { expect, test } from 'vitest';
import { Box3, Matrix4, Vector2, Vector3 } from 'three';
import { railViewMatches } from './rail-paint-cache';

const bounds = new Box3(new Vector3(-1000, -1, -750), new Vector3(1000, 30, 750));
const size = new Vector2(1440, 960);

test('rail view tolerates floating reconstruction drift across its whole bounds', () => {
  const cached = new Matrix4();
  const next = cached.clone();
  next.elements[13]! += 1e-13;
  expect(railViewMatches(cached, next, bounds, size)).toBe(true);
});

test('rail view compares cumulative motion against the captured view', () => {
  const cached = new Matrix4();
  const next = new Matrix4().makeTranslation(0.00001, 0, 0);
  expect(railViewMatches(cached, next, bounds, size)).toBe(true);
  next.elements[12]! *= 2;
  expect(railViewMatches(cached, next, bounds, size)).toBe(false);
});

test('rail view preserves depth when only clipping changes', () => {
  const cached = new Matrix4();
  const next = new Matrix4().makeTranslation(0, 0, 1e-5);
  expect(railViewMatches(cached, next, bounds, size)).toBe(false);
});

test('perspective drift is bounded over the entire rail extent', () => {
  const cached = new Matrix4();
  const next = cached.clone();
  next.elements[3] = 1e-8;
  expect(railViewMatches(cached, next, bounds, size)).toBe(false);
});

test('a changed view crossing the camera plane keeps the mesh', () => {
  const cached = new Matrix4();
  cached.elements[3] = 0.002;
  const next = cached.clone();
  next.elements[13]! += 1e-13;
  expect(railViewMatches(cached, next, bounds, size)).toBe(false);
  expect(railViewMatches(cached, cached, bounds, size)).toBe(true);
});
