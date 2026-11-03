import { segmentsIntersect } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CMovement, CNode } from './types';

function pathsIntersect(a: Vec2[], b: Vec2[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentsIntersect(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!)) return true;
    }
  }
  return false;
}

export function populateConflicts(node: CNode, movements: CMovement[]): void {
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
      }
    }
  }
}
