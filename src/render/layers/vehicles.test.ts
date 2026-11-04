import { expect, it } from 'vitest';
import { cumulativeLengths } from '../../geo/polyline';
import type { CMovement } from '../../network';
import { advanceAlong, distanceAlong, laneChangePose } from './vehicles';

it('advances around a polyline corner and stops at the segment end', () => {
  const polyline = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  const segment = { polyline, cumulative: cumulativeLengths(polyline), lengthM: 20 } as CMovement;
  const distance = distanceAlong(segment, 8, 0);
  expect(distance).toBe(8);
  expect(advanceAlong(segment, distance, 10, 0.5)).toEqual({ x: 10, y: 3, heading: Math.PI / 2 });
  expect(advanceAlong(segment, distance, 10, 100)).toEqual({ x: 10, y: 10, heading: Math.PI / 2 });
  expect(advanceAlong(segment, distance, 0, 100)).toEqual({ x: 8, y: 0, heading: 0 });
  // A fresh snapshot replaces the old estimate, including braking back along the segment.
  expect(advanceAlong(segment, distanceAlong(segment, 9, 0), 2, 0.25).x).toBe(9.5);
});

it('eases either direction over the configured duration with a small heading change', () => {
  expect(laneChangePose(3.5, 3.5, 2, 0)).toEqual({ lateral: 3.5, yaw: -0 });
  expect(laneChangePose(3.5, 3.5, 2, 0.5).lateral).toBeCloseTo(3.5 * 0.84375);
  expect(laneChangePose(3.5, 3.5, 2, 1)).toEqual({ lateral: 1.75, yaw: -0.12 });
  expect(laneChangePose(-3.5, 3.5, 2, 1)).toEqual({ lateral: -1.75, yaw: 0.12 });
  expect(laneChangePose(3.5, 3.5, 2, 3).lateral).toBe(0);
  expect(laneChangePose(0, 0, 2, 1)).toEqual({ lateral: 0, yaw: 0 });
  expect(laneChangePose(3.5, 3.5, 0, 1)).toEqual({ lateral: 0, yaw: 0 });
  // A later linear-offset snapshot produces the same point in the eased animation.
  expect(laneChangePose(1.75, 3.5, 2, 0.25)).toEqual(laneChangePose(3.5, 3.5, 2, 1.25));
});
