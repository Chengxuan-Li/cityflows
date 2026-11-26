import { nearestOnPolyline } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { runwayIntersectionAreas, type AirsideGraph } from '../../src/network/airside';
import { aircraftTypes } from '../../src/schema/aircraft';
import type { AircraftPoseSnapshot } from '../../src/sim/aircraft';

// TASK-298: the gates' checks on aircraft snapshots. An aircraft's body is its fuselage
// (length by a tenth of it), its wing (span by a fifth of the length, at the middle) and its
// tailplane (a third of the span by a tenth of the length, at the tail): rectangles in the plan.

type Box = Vec2[];

function rectangle(pose: AircraftPoseSnapshot, x: number, lengthM: number, widthM: number): Box {
  const c = Math.cos(pose.heading),
    s = Math.sin(pose.heading);
  return [
    [x - lengthM / 2, -widthM / 2],
    [x + lengthM / 2, -widthM / 2],
    [x + lengthM / 2, widthM / 2],
    [x - lengthM / 2, widthM / 2],
  ].map(([u, v]) => ({ x: pose.x + u! * c - v! * s, y: pose.y + u! * s + v! * c }));
}

export function body(pose: AircraftPoseSnapshot): Box[] {
  const type = aircraftTypes.find((t) => t.id === pose.typeId)!;
  const { lengthM: l, spanM: span } = type;
  return [
    rectangle(pose, 0, l, 0.1 * l),
    rectangle(pose, 0.02 * l, 0.2 * l, span),
    rectangle(pose, -0.43 * l, 0.12 * l, span / 3),
  ];
}

function separated(a: Box, b: Box) {
  for (const box of [a, b])
    for (let i = 0; i < 4; i++) {
      const p = box[i]!,
        q = box[(i + 1) % 4]!;
      const nx = q.y - p.y,
        ny = p.x - q.x;
      const project = (r: Box) => r.map((v) => v.x * nx + v.y * ny);
      const pa = project(a),
        pb = project(b);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return true;
    }
  return false;
}

/** Pairs of aircraft on the ground (or within 20 m of it) whose bodies overlap. */
export function overlaps(poses: readonly AircraftPoseSnapshot[]) {
  const found: [string, string][] = [];
  const low = poses.filter((p) => p.heightM < 20);
  const bodies = low.map(body);
  for (let i = 0; i < low.length; i++)
    for (let j = i + 1; j < low.length; j++)
      if (Math.hypot(low[i]!.x - low[j]!.x, low[i]!.y - low[j]!.y) < 160)
        if (bodies[i]!.some((a) => bodies[j]!.some((b) => !separated(a, b))))
          found.push([low[i]!.registration, low[j]!.registration]);
  return found;
}

/** Aircraft on a runway at once: more than one is a conflict. */
export const onRunway = (poses: readonly AircraftPoseSnapshot[]) =>
  poses.filter((p) => p.onRunway).map((p) => p.registration);

/** Conflicts measured from physical poses: two aircraft on the same runway, or two within
 * the same protected intersection. An aircraft can pass a junction with another runway
 * occupied elsewhere along it. */
/** TASK-345: pairs on one runway the owner approved as sharing it by design (2026-11-24): two
 * crossing aircraft; a crossing aircraft at least 150 m behind a landing roll along its heading; an
 * aircraft lining up behind a departure rolling away (take-off roll, rotation or climb). */
export function exemptRunwayPair(a: AircraftPoseSnapshot, b: AircraftPoseSnapshot) {
  const crossing = (p: AircraftPoseSnapshot) => p.state === 'taxi' || p.state === 'tow';
  const behind = (p: AircraftPoseSnapshot, ahead: AircraftPoseSnapshot) =>
    (ahead.x - p.x) * Math.cos(ahead.heading) + (ahead.y - p.y) * Math.sin(ahead.heading);
  if (crossing(a) && crossing(b)) return true;
  if (crossing(a) !== crossing(b)) {
    const [mover, crosser] = crossing(a) ? [b, a] : [a, b];
    return mover.state === 'landing-roll' && behind(crosser, mover) >= 150;
  }
  const rolling = (p: AircraftPoseSnapshot) =>
    p.state === 'takeoff-roll' || p.state === 'rotation' || p.state === 'climb';
  const [lineUp, roll] = a.state === 'line-up' ? [a, b] : [b, a];
  return lineUp.state === 'line-up' && rolling(roll) && behind(lineUp, roll) >= 0;
}

/** Runway conflicts: pairs on one runway or in one runway intersection area. `exempt` (the
 * default) leaves out the pairs `exemptRunwayPair` approves on one runway. */
export function runwayConflictCheck(graph: AirsideGraph, { exempt = true } = {}) {
  const areas = runwayIntersectionAreas(graph, (graph.maxSpanM || 36) / 2 + 12);
  return (poses: readonly AircraftPoseSnapshot[]) => {
    const on = poses.filter((p) => p.onRunway);
    if (on.length < 2) return 0;
    const runway = on.map((pose) => {
      let closest = -1;
      let away = Infinity;
      for (const r of graph.runways) {
        const near = nearestOnPolyline(r.line, pose);
        if (near.away > r.widthM / 2 + 5) continue;
        if (
          pose.state !== 'taxi' &&
          pose.state !== 'tow' &&
          r.ends.some((end) => end.designator === pose.runwayEnd)
        )
          return r.idx;
        if (near.away < away) {
          away = near.away;
          closest = r.idx;
        }
      }
      return closest;
    });
    const within = on.map(({ x, y }) =>
      areas.filter(({ pos, bands }) =>
        bands.every(({ axis, min, max }) => {
          const u = (x - pos.x) * axis.x + (y - pos.y) * axis.y;
          return u >= min && u <= max;
        }),
      ),
    );
    let count = 0;
    for (let i = 0; i < on.length; i++)
      for (let j = i + 1; j < on.length; j++)
        if (
          (runway[i]! >= 0 &&
            runway[i] === runway[j] &&
            !(exempt && exemptRunwayPair(on[i]!, on[j]!))) ||
          within[i]!.some((area) => within[j]!.includes(area))
        )
          count++;
    return count;
  };
}
