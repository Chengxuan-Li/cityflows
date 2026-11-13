/** TASK-128: S-Bahn riders who get off at a station, per stop at full population
 * (`personsPerResident = 1`); scaled by the scenario's `personsPerResident`. Constants only. */
export const riderProfile = {
  /** Commuters per stop by the train's arrival hour. */
  commutersByHour: { 5: 10, 6: 30, 7: 50, 8: 50, 9: 30, 10: 15 } as Record<number, number>,
  /** Visitors per stop for arrivals from 11:00 to 21:59; none from 22:00 to 04:59. */
  visitorsPerStop: 10,
  visitorHours: { from: 11, to: 21 },
  /** Destinations within this straight-line radius of the station, weighted by exp(-d / decay). */
  radiusM: 1500,
  decayM: 600,
  /** Platform-to-door and stay walks: straight line times this, at the walking speed. */
  detour: 1.3,
  /** The default walking speed (`DEFAULT_SIM_PARAMS.walkSpeedMps`), unless the scenario sets one. */
  walkSpeedMps: 1.4,
  /** A visitor stays a uniform 1 to 3 hours; a commuter the scenario's work duration. */
  visitStayS: { min: 3600, max: 3 * 3600 },
};

export type RiderKind = 'commuter' | 'visitor';

export function riderKind(hour: number): RiderKind | null {
  if (riderProfile.commutersByHour[hour] !== undefined) return 'commuter';
  const { from, to } = riderProfile.visitorHours;
  return hour >= from && hour <= to ? 'visitor' : null;
}

export function ridersPerStop(hour: number): number {
  const kind = riderKind(hour);
  return kind === 'commuter'
    ? riderProfile.commutersByHour[hour]!
    : kind === 'visitor'
      ? riderProfile.visitorsPerStop
      : 0;
}
