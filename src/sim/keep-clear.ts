import type { KeepClearZone } from '../network/keep-clear';

/** TASK-169: a car held short of a keep-clear zone stands with its front this far before it. */
export const KEEP_CLEAR_STOP_M = 0.5;

/**
 * TASK-169 (architecture section 8, keep clear): where a car whose front would come to stand at
 * `standM` stands instead so that its body covers no keep-clear zone of its lane: its front
 * `KEEP_CLEAR_STOP_M` short of the first zone its body would cover there, repeated while the new
 * stand still covers one. A zone its body covers at its destination connector on the lane
 * (`arrivalM`) does not count: it leaves the lane there. A car standing at its stop line
 * (`stopLineM`) first moves up, as far as `KEEP_CLEAR_STOP_M` short of the line and past the gap
 * it keeps to the line, when its body then clears every zone. Null when the stand at `standM` is clear of
 * every zone, or when the rear would stand short of the lane's start, on the movement it came by.
 */
export function keepClearStand(
  zones: readonly KeepClearZone[],
  lengthM: number,
  standM: number,
  arrivalM = Infinity,
  stopLineM = -Infinity,
): number | null {
  // Plain loops: this runs for every car on a lane with zones, every step (TASK-176).
  let last = zones.length - 1;
  while (last >= 0 && !covers(zones[last]!, standM, lengthM, arrivalM)) last--;
  if (last < 0) return null;
  // IDM settles a little short of its stand; the rear keeps 0.2 m spare past the zone.
  const ahead = zones[last]!.toM + lengthM + 0.2;
  if (ahead <= stopLineM - KEEP_CLEAR_STOP_M) {
    let clear = true;
    for (let i = 0; clear && i < zones.length; i++)
      clear = !covers(zones[i]!, ahead, lengthM, arrivalM);
    if (clear) return ahead;
  }
  let front = standM;
  for (let i = last; i >= 0; i--)
    if (covers(zones[i]!, front, lengthM, arrivalM)) front = zones[i]!.fromM - KEEP_CLEAR_STOP_M;
  return front - lengthM < 0 ? null : front;
}

/** Whether a body `lengthM` long with its front at `front` covers `zone`, a zone it covers at its
 * arrival (`arrivalM`) never counting. */
function covers(zone: KeepClearZone, front: number, lengthM: number, arrivalM: number) {
  return (
    !(zone.fromM < arrivalM && zone.toM > arrivalM - lengthM) &&
    zone.fromM < front &&
    zone.toM > front - lengthM
  );
}

/** Whether a body over `[fromM, toM]` of the lane lies in one of its mouth zones. */
export function inMouth(zones: readonly KeepClearZone[], fromM: number, toM: number) {
  for (const zone of zones)
    if (zone.kind === 'mouth' && zone.fromM < toM && zone.toM > fromM) return true;
  return false;
}
