import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CLane, CParkingSpace } from '../network';

export interface ParkingPose extends Vec2 {
  heading: number;
}
export interface MotionPath {
  points: Vec2[];
  headings?: number[];
  cumulative: Float64Array;
  lengthM: number;
}
export const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));
export function motionPath(points: Vec2[], headings?: number[]): MotionPath {
  const cumulative = cumulativeLengths(points);
  return { points, headings, cumulative, lengthM: cumulative.at(-1) ?? 0 };
}
export function pathPose(path: MotionPath, positionM: number): ParkingPose {
  const p = pointAtDistance(path.points, path.cumulative, positionM);
  let heading =
    path.points.length > 1 ? headingAtDistance(path.points, path.cumulative, positionM) : 0;
  if (path.headings) {
    let i = 0;
    while (i < path.points.length - 2 && path.cumulative[i + 1]! < positionM) i++;
    const t = Math.max(
      0,
      Math.min(
        1,
        (positionM - path.cumulative[i]!) /
          Math.max(1e-9, path.cumulative[i + 1]! - path.cumulative[i]!),
      ),
    );
    heading = path.headings[i]! + angleDelta(path.headings[i]!, path.headings[i + 1]!) * t;
  }
  return { ...p, heading };
}
export function parkedPose(space: CParkingSpace, lengthM: number): ParkingPose {
  return {
    x: space.position.x + (Math.cos(space.heading) * lengthM) / 2,
    y: space.position.y + (Math.sin(space.heading) * lengthM) / 2,
    heading: space.heading,
  };
}

/** Front-bumper curves, with body heading retained during reverse travel. */
export function manoeuvrePath(
  from: ParkingPose,
  to: ParkingPose,
  parallel: boolean,
  leaving = false,
): MotionPath {
  if (leaving) {
    const path = manoeuvrePath(to, from, parallel);
    return motionPath([...path.points].reverse(), [...path.headings!].reverse());
  }
  const points: Vec2[] = [],
    headings: number[] = [];
  const curve = (a: ParkingPose, b: ParkingPose, reverse: boolean) => {
    const span = Math.max(1, distance(a, b)) * 0.55,
      sign = reverse ? -1 : 1;
    const c = {
      x: a.x + Math.cos(a.heading) * span * sign,
      y: a.y + Math.sin(a.heading) * span * sign,
    };
    const d = {
      x: b.x - Math.cos(b.heading) * span * sign,
      y: b.y - Math.sin(b.heading) * span * sign,
    };
    for (let i = 0; i <= 48; i++) {
      if (points.length && i === 0) continue;
      const t = i / 48,
        u = 1 - t;
      points.push({
        x: u * u * u * a.x + 3 * u * u * t * c.x + 3 * u * t * t * d.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c.y + 3 * u * t * t * d.y + t * t * t * b.y,
      });
      const dx = 3 * u * u * (c.x - a.x) + 6 * u * t * (d.x - c.x) + 3 * t * t * (b.x - d.x),
        dy = 3 * u * u * (c.y - a.y) + 6 * u * t * (d.y - c.y) + 3 * t * t * (b.y - d.y);
      headings.push(Math.atan2(dy, dx) + (reverse ? Math.PI : 0));
    }
  };
  if (parallel) {
    const approach = {
      x: from.x + Math.cos(from.heading) * 5.5,
      y: from.y + Math.sin(from.heading) * 5.5,
      heading: from.heading,
    };
    curve(from, approach, false);
    curve(approach, to, true);
  } else curve(from, to, false);
  headings[0] = from.heading;
  headings[headings.length - 1] = to.heading;
  return motionPath(points, headings);
}

export function bodyClearLane(pose: ParkingPose, lane: CLane, lengthM: number, widthM: number) {
  const offsets = [];
  for (const along of [0, -lengthM]) {
    const p = {
      x: pose.x + Math.cos(pose.heading) * along,
      y: pose.y + Math.sin(pose.heading) * along,
    };
    const hit = nearestOnPolyline(lane.polyline, p),
      on = pointAtDistance(lane.polyline, lane.cumulative, hit.along);
    const heading = headingAtDistance(lane.polyline, lane.cumulative, hit.along);
    const lateral = -(p.x - on.x) * Math.sin(heading) + (p.y - on.y) * Math.cos(heading);
    const half = (widthM / 2) * Math.abs(Math.cos(pose.heading - heading));
    offsets.push(lateral - half, lateral + half);
  }
  return (
    Math.min(...offsets) > lane.widthM / 2 + 0.01 || Math.max(...offsets) < -lane.widthM / 2 - 0.01
  );
}

/** Longitudinal envelope of every body corner while a manoeuvre intersects the lane. */
export function manoeuvreLaneBounds(
  path: MotionPath,
  lane: CLane,
  lengthM: number,
  widthM: number,
) {
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i < path.points.length; i++) {
    const pose = { ...path.points[i]!, heading: path.headings![i]! };
    if (bodyClearLane(pose, lane, lengthM, widthM)) continue;
    for (const along of [0, -lengthM])
      for (const across of [-widthM / 2, widthM / 2]) {
        const p = {
          x: pose.x + Math.cos(pose.heading) * along - Math.sin(pose.heading) * across,
          y: pose.y + Math.sin(pose.heading) * along + Math.cos(pose.heading) * across,
        };
        const at = nearestOnPolyline(lane.polyline, p).along;
        low = Math.min(low, at);
        high = Math.max(high, at);
      }
  }
  return low === Infinity ? null : { low, high };
}

/** Farthest occupied lane station during a pull-in, including its forward setup. */
export function manoeuvreLaneReach(path: MotionPath, lane: CLane, lengthM: number, widthM: number) {
  let reach = 0;
  for (let i = 0; i < path.points.length; i++) {
    const pose = { ...path.points[i]!, heading: path.headings![i]! };
    if (bodyClearLane(pose, lane, lengthM, widthM)) continue;
    for (const along of [0, -lengthM])
      for (const across of [-widthM / 2, widthM / 2]) {
        const p = {
          x: pose.x + Math.cos(pose.heading) * along - Math.sin(pose.heading) * across,
          y: pose.y + Math.sin(pose.heading) * along + Math.cos(pose.heading) * across,
        };
        reach = Math.max(reach, nearestOnPolyline(lane.polyline, p).along);
      }
  }
  return reach;
}
