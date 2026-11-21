import { expect, it } from 'vitest';
import {
  offsetPolyline,
  pointAtDistance,
  headingAtDistance,
  cumulativeLengths,
  segmentsIntersect,
  nearestOnPolyline,
  polylineNearest,
} from './polyline';
import { createRandom } from './random';

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

// TASK-278: the indexed lookup answers as the plain scan, to the bit.
it('finds the nearest point of a polyline as nearestOnPolyline does, on random lines', () => {
  const random = createRandom(278);
  for (let n = 0; n < 200; n++) {
    const count = 1 + Math.floor(random.next() * 60);
    const points = [{ x: random.uniform(-100, 100), y: random.uniform(-100, 100) }];
    for (let i = 1; i < count; i++) {
      const last = points.at(-1)!;
      // One vertex in six repeats the last: a zero-length segment.
      points.push(
        random.next() < 1 / 6
          ? { ...last }
          : { x: last.x + random.uniform(-20, 20), y: last.y + random.uniform(-20, 20) },
      );
    }
    const find = polylineNearest(points);
    for (let q = 0; q < 50; q++) {
      const p = { x: random.uniform(-300, 300), y: random.uniform(-300, 300) };
      expect(find(p)).toStrictEqual(nearestOnPolyline(points, p));
    }
    for (const p of points) expect(find(p)).toStrictEqual(nearestOnPolyline(points, p));
  }
});

it('gives a tie to the lower segment when a later run of segments is searched first', () => {
  // Segment 0 and segment 10 are both 1 m from the origin; the second run's box holds the origin,
  // so it is searched first.
  const points = [
    { x: -1, y: 1 },
    { x: 1, y: 1 },
    ...Array.from({ length: 8 }, (_, i) => ({ x: 1, y: 2 + i })),
    { x: -3, y: 9 },
    { x: -3, y: -1 },
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 3, y: -1 },
  ];
  const origin = { x: 0, y: 0 };
  expect(nearestOnPolyline(points, origin)).toMatchObject({ along: 1, away: 1 });
  expect(polylineNearest(points)(origin)).toStrictEqual(nearestOnPolyline(points, origin));
});
