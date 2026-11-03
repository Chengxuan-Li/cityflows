import { expect, it } from 'vitest';
import {
  offsetPolyline,
  pointAtDistance,
  headingAtDistance,
  cumulativeLengths,
  segmentsIntersect,
} from './polyline';

const line = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];

it('offsets straight and right-angle lines toward the right', () => {
  expect(offsetPolyline(line.slice(0, 2), 2)).toEqual([
    { x: 0, y: 2 },
    { x: 10, y: 2 },
  ]);
  expect(offsetPolyline(line, 2)).toEqual([
    { x: 0, y: 2 },
    { x: 8, y: 2 },
    { x: 8, y: 10 },
  ]);
});

it('samples position and heading at arc distance', () => {
  const cumulative = cumulativeLengths(line);
  expect(pointAtDistance(line, cumulative, 14)).toEqual({ x: 10, y: 4 });
  expect(headingAtDistance(line, cumulative, 14)).toBe(Math.PI / 2);
});

it('detects crossings and collinear overlaps but excludes disjoint segments', () => {
  const [a, b] = line as [(typeof line)[number], (typeof line)[number]];
  expect(segmentsIntersect(a, b, { x: 4, y: -1 }, { x: 4, y: 1 })).toBe(true);
  expect(segmentsIntersect(a, b, { x: 5, y: 0 }, { x: 15, y: 0 })).toBe(true);
  expect(segmentsIntersect(a, b, { x: 11, y: 0 }, { x: 15, y: 0 })).toBe(false);
});
