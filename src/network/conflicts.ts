import { segmentsIntersect } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CLane, CMovement, CNode } from './types';

function pointSegmentDistanceSquared(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

function contacts(a: Vec2, b: Vec2, path: Vec2[], widthSquared: number): boolean {
  for (let j = 1; j < path.length; j++) {
    const c = path[j - 1]!;
    const d = path[j]!;
    if (
      segmentsIntersect(a, b, c, d) ||
      Math.min(
        pointSegmentDistanceSquared(a, c, d),
        pointSegmentDistanceSquared(b, c, d),
        pointSegmentDistanceSquared(c, a, b),
        pointSegmentDistanceSquared(d, a, b),
      ) < widthSquared
    )
      return true;
  }
  return false;
}

function conflictZone(a: CMovement, b: CMovement, width: number): [number, number] {
  let start = a.lengthM;
  let end = 0;
  for (let i = 1; i < a.polyline.length; i++) {
    const from = a.polyline[i - 1]!;
    const to = a.polyline[i]!;
    const offset = a.cumulative[i - 1]!;
    const length = a.cumulative[i]! - offset;
    const steps = Math.max(1, Math.ceil(length));
    let previous = from;
    for (let k = 1; k <= steps; k++) {
      const point = {
        x: from.x + ((to.x - from.x) * k) / steps,
        y: from.y + ((to.y - from.y) * k) / steps,
      };
      // Test entire sample segments, not only their endpoints: a narrow crossing can lie
      // between samples. Retaining the contacting segment rounds both boundaries outward.
      if (contacts(previous, point, b.polyline, width * width)) {
        start = Math.min(start, offset + (length * (k - 1)) / steps);
        end = offset + (length * k) / steps;
      }
      previous = point;
    }
  }
  return [start, a.toLane === b.toLane ? a.lengthM : end];
}

function pathsIntersect(a: Vec2[], b: Vec2[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentsIntersect(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!)) return true;
    }
  }
  return false;
}

export function populateConflicts(node: CNode, movements: CMovement[], lanes: CLane[]): void {
  for (const [i, idx] of node.movements.entries()) {
    const a = movements[idx]!;
    for (let j = i + 1; j < node.movements.length; j++) {
      const b = movements[node.movements[j]!]!;
      if (
        a.fromLane !== b.fromLane &&
        (a.toLane === b.toLane || pathsIntersect(a.polyline, b.polyline))
      ) {
        a.conflicts.push(b.idx);
        b.conflicts.push(a.idx);
        const width = (lanes[a.fromLane]!.widthM + lanes[b.fromLane]!.widthM) / 2;
        a.conflictZones.push(conflictZone(a, b, width));
        b.conflictZones.push(conflictZone(b, a, width));
      }
    }
  }
}
