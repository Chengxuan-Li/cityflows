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

const corners = (pose: ParkingPose, lengthM: number, widthM: number) =>
  [0, -lengthM].flatMap((along) =>
    [-widthM / 2, widthM / 2].map((across) => ({
      x: pose.x + Math.cos(pose.heading) * along - Math.sin(pose.heading) * across,
      y: pose.y + Math.sin(pose.heading) * along + Math.cos(pose.heading) * across,
    })),
  );

/** TASK-157: `bodyClearLane`, also clear where the whole body lies beyond either end of the
 * lane, which `bodyClearLane` extends without limit. */
export function bodyClearOf(pose: ParkingPose, lane: CLane, lengthM: number, widthM: number) {
  const beyond = (at: number, sign: number) => {
    const end = pointAtDistance(lane.polyline, lane.cumulative, at),
      heading = headingAtDistance(lane.polyline, lane.cumulative, at);
    return corners(pose, lengthM, widthM).every(
      (p) => sign * ((p.x - end.x) * Math.cos(heading) + (p.y - end.y) * Math.sin(heading)) > 0,
    );
  };
  return (
    bodyClearLane(pose, lane, lengthM, widthM) || beyond(lane.lengthM, 1) || beyond(0, -1)
  );
}

/** The farthest progress along a path whose pose passes `clear`; -1 if none does. */
function farthestClear(path: MotionPath, clear: (pose: ParkingPose) => boolean) {
  const clearAt = (at: number) => clear(pathPose(path, at));
  let unclear = path.lengthM;
  if (clearAt(unclear)) return unclear;
  let at = unclear;
  do {
    unclear = at;
    at = Math.max(0, at - 0.5);
    if (clearAt(at)) {
      while (unclear - at > 0.01) {
        const mid = (at + unclear) / 2;
        if (clearAt(mid)) at = mid;
        else unclear = mid;
      }
      return at;
    }
  } while (at > 0);
  return -1;
}

/** TASK-150: the farthest progress along a lot's drive-out path whose whole body stands clear
 * of the exit lane, where the car holds until it is granted the lane; -1 if no pose is clear. */
export function holdProgress(path: MotionPath, lane: CLane, lengthM: number, widthM: number) {
  return farthestClear(path, (pose) => bodyClearLane(pose, lane, lengthM, widthM));
}

/** TASK-157: a lot exit's hold, clear of its exit lane (as TASK-150) and of every other lane of
 * `street` its body would stand in there, such as the near lane of a two-way street whose far
 * lane it joins, or a lane ending at the mouth's junction. A lane the held body still touches
 * joins the set until a pose is clear of all of them; with none clear, it keeps TASK-150's hold
 * (Sindelfingen pk:1482, whose exit and near lanes are 7.9 m stubs). */
export function lotHold(
  path: MotionPath,
  exit: CLane,
  street: CLane[],
  lengthM: number,
  widthM: number,
) {
  const lanes: CLane[] = [];
  for (;;) {
    const holdM = farthestClear(
      path,
      (pose) =>
        bodyClearLane(pose, exit, lengthM, widthM) &&
        lanes.every((lane) => bodyClearOf(pose, lane, lengthM, widthM)),
    );
    if (holdM < 0) return Math.max(0, holdProgress(path, exit, lengthM, widthM));
    const pose = pathPose(path, holdM);
    const touched = street.filter(
      (l) => l !== exit && !lanes.includes(l) && !bodyClearOf(pose, l, lengthM, widthM),
    );
    if (!touched.length) return holdM;
    lanes.push(...touched);
  }
}

export interface LaneCrossing {
  lane: number;
  /** Station span the body covers on the crossed lane during the merge. */
  fromM: number;
  toM: number;
  /** Merge progress after which the body has left the crossed lane. */
  untilM: number;
}

/** TASK-157: the lanes of `street` other than the exit lane that a merge's body crosses, each
 * with the station span it covers there and the merge progress at which it has left. */
export function laneCrossings(
  merge: MotionPath,
  exit: CLane,
  street: CLane[],
  lengthM: number,
  widthM: number,
) {
  const crossings: LaneCrossing[] = [];
  for (const lane of street) {
    if (lane === exit) continue;
    let fromM = Infinity,
      toM = -Infinity,
      untilM = -1;
    for (let i = 0; i < merge.points.length; i++) {
      const pose = { ...merge.points[i]!, heading: merge.headings![i]! };
      if (bodyClearOf(pose, lane, lengthM, widthM)) continue;
      for (const corner of corners(pose, lengthM, widthM)) {
        const at = nearestOnPolyline(lane.polyline, corner).along;
        fromM = Math.min(fromM, at);
        toM = Math.max(toM, at);
      }
      untilM = merge.cumulative[i + 1] ?? merge.lengthM;
    }
    if (untilM >= 0) crossings.push({ lane: lane.idx, fromM, toM, untilM });
  }
  return crossings;
}

/** TASK-150: the lane station where a held car's front bumper joins: past the hold's nearest
 * lane station by its distance from the lane centre, so the merge turns into the lane instead
 * of hooking back to a station straight ahead. A drive-out path that runs along the lane (an
 * aisle mapped on a road) joins where it meets the lane, not at its connector further on. */
export function joinStation(hold: ParkingPose, lane: CLane, connectorM: number) {
  const hit = nearestOnPolyline(lane.polyline, hold);
  return Math.min(hit.along + hit.away, Math.max(connectorM, lane.stopM));
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
