import type { KeepClearZone } from '../network/keep-clear';

/** TASK-169: a car held short of a keep-clear zone stands with its front this far before it. */
export const KEEP_CLEAR_STOP_M = 0.5;

/**
 * TASK-169 (architecture section 8, keep clear): where a car whose front would come to stand at
 * `standM` stands instead so that its body covers no keep-clear zone of its lane: its front
 * `KEEP_CLEAR_STOP_M` short of the first zone its body would cover there, repeated while the new
 * stand still covers one. A zone its body covers at its destination connector on the lane
 * (`arrivalM`) does not count: it leaves the lane there. A car standing at its stop line
 * (`stopLineM`) first moves up to `KEEP_CLEAR_STOP_M` short of the line, past the gap it keeps to
 * the line, when its body then clears every zone. Null when the stand at `standM` is clear of
 * every zone, or when the rear would stand short of the lane's start, on the movement it came by.
 */
export function keepClearStand(
  zones: readonly KeepClearZone[],
  lengthM: number,
  standM: number,
  arrivalM = Infinity,
  stopLineM = -Infinity,
): number | null {
  const covers = (zone: KeepClearZone, front: number) =>
    !(zone.fromM < arrivalM && zone.toM > arrivalM - lengthM) &&
    zone.fromM < front &&
    zone.toM > front - lengthM;
  const last = zones.findLast((zone) => covers(zone, standM));
  if (!last) return null;
  const ahead = last.toM + lengthM;
  if (ahead <= stopLineM - KEEP_CLEAR_STOP_M && !zones.some((zone) => covers(zone, ahead)))
    return ahead;
  let front = standM;
  for (let i = zones.length - 1; i >= 0; i--)
    if (covers(zones[i]!, front)) front = zones[i]!.fromM - KEEP_CLEAR_STOP_M;
  return front - lengthM < 0 ? null : front;
}

/** Whether a body over `[fromM, toM]` of the lane lies in one of its mouth zones. */
export const inMouth = (zones: readonly KeepClearZone[], fromM: number, toM: number) =>
  zones.some((zone) => zone.kind === 'mouth' && zone.fromM < toM && zone.toM > fromM);
