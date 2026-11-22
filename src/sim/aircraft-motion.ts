import { cumulativeLengths, headingAtDistance, pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { FixedWingPerformance, HelicopterPerformance } from '../schema/aircraft';

export interface AircraftPath {
  points: readonly Vec2[];
  stationsM: Float64Array;
  lengthM: number;
}

export function aircraftPath(points: readonly Vec2[]): AircraftPath {
  const line = points.filter((point, i) => {
    const previous = points[i - 1];
    return !previous || point.x !== previous.x || point.y !== previous.y;
  });
  if (line.length < 2) throw new Error('An aircraft path needs two distinct points');
  const stationsM = cumulativeLengths(line);
  return { points: line, stationsM, lengthM: stationsM.at(-1)! };
}

type GroundPhase = 'taxi' | 'pushback' | 'tow' | 'hover-taxi';
export type AircraftPhase =
  | GroundPhase
  | 'takeoff-roll'
  | 'rotation'
  | 'climb'
  | 'approach'
  | 'flare'
  | 'landing-roll'
  | 'vertical-climb'
  | 'helicopter-climb'
  | 'helicopter-approach'
  | 'vertical-descent';

interface AircraftMotion {
  stationM: number;
  /** Height relative to runway or pad elevation. */
  heightM: number;
  /** Horizontal speed along the path. */
  speedMps: number;
  phase: AircraftPhase;
}

export interface AircraftPose extends AircraftMotion {
  position: Vec2;
  headingRad: number;
}

export interface AircraftMotionProfile {
  durationS: number;
  sample(elapsedS: number): AircraftPose;
}

function profile(
  path: AircraftPath,
  durationS: number,
  motionAt: (elapsedS: number) => AircraftMotion,
  reverseHeading = false,
): AircraftMotionProfile {
  return {
    durationS,
    sample(elapsedS) {
      const motion = motionAt(Math.max(0, Math.min(elapsedS, durationS)));
      const { stationM } = motion;
      const heading = headingAtDistance(path.points, path.stationsM, stationM);
      return {
        ...motion,
        position: pointAtDistance(path.points, path.stationsM, stationM),
        headingRad: reverseHeading ? heading + (heading > 0 ? -Math.PI : Math.PI) : heading,
      };
    },
  };
}

/** Constant acceleration between two stations with known endpoint speeds. */
function leg(fromM: number, toM: number, fromMps: number, toMps: number) {
  const durationS = (2 * (toM - fromM)) / (fromMps + toMps);
  return {
    durationS,
    at(timeS: number) {
      if (timeS <= 0) return { stationM: fromM, speedMps: fromMps };
      if (timeS >= durationS) return { stationM: toM, speedMps: toMps };
      const speedMps = fromMps + ((toMps - fromMps) * timeS) / durationS;
      return {
        stationM: Math.min(toM, fromM + ((fromMps + speedMps) * timeS) / 2),
        speedMps,
      };
    },
  };
}

function accelerateToLimit(
  fromM: number,
  endM: number,
  fromMps: number,
  limitMps: number,
  accelerationMps2: number,
) {
  const fullSpeedM = fromM + (limitMps ** 2 - fromMps ** 2) / (2 * accelerationMps2);
  const stationM = Math.min(fullSpeedM, endM);
  const speedMps =
    fullSpeedM <= endM
      ? limitMps
      : Math.sqrt(fromMps ** 2 + 2 * accelerationMps2 * (stationM - fromM));
  return { stationM, speedMps, ...leg(fromM, stationM, fromMps, speedMps) };
}

export interface GroundProfileOptions {
  startStationM?: number;
  startSpeedMps?: number;
  stopStationM?: number;
}

const travelAccelerationMps2 = 0.8;

/** Stations of the path's vertices from start to stop, each segment's speed limit, and the
 * fastest speed at each station that still keeps every later limit and stops at the stop. */
function groundEnvelope(
  path: AircraftPath,
  speedLimitMps: number,
  brakeMps2: number,
  startStationM: number,
  stopStationM: number,
  performance?: FixedWingPerformance,
) {
  const stations = [startStationM];
  const segmentLimits: number[] = [];
  const nodeLimits = [speedLimitMps];
  const { points, stationsM } = path;
  const turnLimits = points.map((b, i) => {
    const a = points[i - 1];
    const c = points[i + 1];
    if (!performance || !a || !c) return speedLimitMps;
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const sine = Math.abs(ux * vy - uy * vx) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    if (sine < 1e-9) {
      if (ux * vx + uy * vy < 0 && startStationM < stationsM[i]! && stationsM[i]! < stopStationM)
        throw new Error('Aircraft path contains a reversal with no turn radius');
      return speedLimitMps;
    }
    // Radius of the circle through the preceding, current and following path points.
    const radiusM = Math.hypot(c.x - a.x, c.y - a.y) / (2 * sine);
    return Math.min(
      speedLimitMps,
      performance.taxiTurnMps,
      Math.sqrt(performance.maxLateralAccelerationMps2 * radiusM),
    );
  });

  for (let i = 1; i < stationsM.length; i++) {
    const fromM = stationsM[i - 1]!;
    const toM = stationsM[i]!;
    if (toM <= startStationM) continue;
    if (fromM >= stopStationM) break;
    const lengthM = toM - fromM;
    const beforeM = fromM - (stationsM[i - 2] ?? -Infinity);
    const afterM = (stationsM[i + 1] ?? Infinity) - toM;
    // A tight bend sampled by short chords must not cap a long straight next to it.
    // At a join the vertex still has a limit, so braking starts before the bend.
    const segmentLimit = Math.min(
      speedLimitMps,
      lengthM <= 4 * beforeM ? turnLimits[i - 1]! : speedLimitMps,
      lengthM <= 4 * afterM ? turnLimits[i]! : speedLimitMps,
    );
    const last = nodeLimits.length - 1;
    nodeLimits[last] = Math.min(
      nodeLimits[last]!,
      segmentLimit,
      fromM >= startStationM ? turnLimits[i - 1]! : speedLimitMps,
    );
    nodeLimits.push(segmentLimit);
    stations.push(Math.min(toM, stopStationM));
    segmentLimits.push(segmentLimit);
  }

  // Pass backwards from the stop to bound entry speed, then forwards to bound acceleration.
  const speeds = nodeLimits;
  speeds[speeds.length - 1] = 0;
  for (let i = speeds.length - 2; i >= 0; i--) {
    const distanceM = stations[i + 1]! - stations[i]!;
    speeds[i] = Math.min(speeds[i]!, Math.sqrt(speeds[i + 1]! ** 2 + 2 * brakeMps2 * distanceM));
  }
  return { stations, segmentLimits, speeds };
}

function groundProfile(
  path: AircraftPath,
  phase: GroundPhase,
  speedLimitMps: number,
  brakeMps2: number,
  options: GroundProfileOptions,
  performance?: FixedWingPerformance,
): AircraftMotionProfile {
  const { startStationM = 0, stopStationM = path.lengthM, startSpeedMps = 0 } = options;
  if (!(0 <= startStationM && startStationM <= stopStationM && stopStationM <= path.lengthM))
    throw new Error('Aircraft start and stop must be ordered stations on the path');
  const heightM = phase === 'hover-taxi' ? 1.5 : 0;
  const stopped = { stationM: stopStationM, heightM, speedMps: 0, phase };
  if (startStationM === stopStationM && startSpeedMps === 0)
    return profile(path, 0, () => stopped, phase === 'pushback');

  const { stations, segmentLimits, speeds } = groundEnvelope(
    path,
    speedLimitMps,
    brakeMps2,
    startStationM,
    stopStationM,
    performance,
  );
  // TASK-298: a replanned aircraft starts at its sampled speed, which may exceed the envelope by
  // rounding.
  if (!(startSpeedMps >= 0 && startSpeedMps <= speeds[0]! + 1e-6))
    throw new Error('Aircraft cannot stop or meet the curve speed from the given start speed');
  speeds[0] = Math.min(startSpeedMps, speeds[0]!);
  const legs: (ReturnType<typeof leg> & { startS: number })[] = [];
  let durationS = 0;
  const addLeg = (fromM: number, toM: number, fromMps: number, toMps: number) => {
    if (toM <= fromM) return;
    const section = leg(fromM, toM, fromMps, toMps);
    legs.push({ ...section, startS: durationS });
    durationS += section.durationS;
  };
  for (let i = 0; i < segmentLimits.length; i++) {
    const fromM = stations[i]!;
    const toM = stations[i + 1]!;
    const fromMps = speeds[i]!;
    const distanceM = toM - fromM;
    const accelMps2 = travelAccelerationMps2;
    const toMps = Math.min(speeds[i + 1]!, Math.sqrt(fromMps ** 2 + 2 * accelMps2 * distanceM));
    speeds[i + 1] = toMps;
    // Where the acceleration and braking envelopes meet, or the intervening cruise limit.
    const peakMps = Math.min(
      segmentLimits[i]!,
      Math.sqrt(
        (2 * accelMps2 * brakeMps2 * distanceM +
          brakeMps2 * fromMps ** 2 +
          accelMps2 * toMps ** 2) /
          (accelMps2 + brakeMps2),
      ),
    );
    const peakStartM = Math.min(
      toM,
      fromM + Math.max(0, peakMps ** 2 - fromMps ** 2) / (2 * accelMps2),
    );
    const peakEndM = Math.max(
      peakStartM,
      toM - Math.max(0, peakMps ** 2 - toMps ** 2) / (2 * brakeMps2),
    );
    addLeg(fromM, peakStartM, fromMps, peakMps);
    addLeg(peakStartM, peakEndM, peakMps, peakMps);
    addLeg(peakEndM, toM, peakMps, toMps);
  }
  return profile(
    path,
    durationS,
    (timeS) => {
      if (timeS >= durationS) return stopped;
      let lo = 0;
      let hi = legs.length;
      while (hi - lo > 1) {
        const mid = (hi + lo) >>> 1;
        if (timeS < legs[mid]!.startS) hi = mid;
        else lo = mid;
      }
      const section = legs[lo]!;
      return { ...section.at(timeS - section.startS), heightM, phase };
    },
    phase === 'pushback',
  );
}

export function taxiProfile(
  path: AircraftPath,
  p: FixedWingPerformance,
  options: GroundProfileOptions = {},
) {
  return groundProfile(path, 'taxi', p.taxiStraightMps, p.brakingDecelerationMps2, options, p);
}

/** TASK-298: the fastest an aircraft may enter `path` at its start station (a landing's handover
 * to taxi) and still meet every turn limit and stop at the stop station. */
export function taxiEntrySpeedMps(
  path: AircraftPath,
  p: FixedWingPerformance,
  { startStationM = 0, stopStationM = path.lengthM }: GroundProfileOptions = {},
) {
  return groundEnvelope(
    path,
    p.taxiStraightMps,
    p.brakingDecelerationMps2,
    startStationM,
    stopStationM,
    p,
  ).speeds[0]!;
}

export function pushbackProfile(
  path: AircraftPath,
  p: FixedWingPerformance,
  options: GroundProfileOptions = {},
) {
  return groundProfile(path, 'pushback', p.pushbackSpeedMps, p.brakingDecelerationMps2, options, p);
}

export function towProfile(
  path: AircraftPath,
  p: FixedWingPerformance,
  options: GroundProfileOptions = {},
) {
  return groundProfile(path, 'tow', p.towSpeedMps, p.brakingDecelerationMps2, options, p);
}

export function hoverTaxiProfile(
  path: AircraftPath,
  p: HelicopterPerformance,
  options: GroundProfileOptions = {},
) {
  return groundProfile(path, 'hover-taxi', p.hoverTaxiMps, travelAccelerationMps2, options);
}

/** The path starts at brake release and includes the extended departure centreline. */
export function takeoffProfile(path: AircraftPath, p: FixedWingPerformance): AircraftMotionProfile {
  const roll = leg(0, p.takeoffRollM, 0, p.rotationSpeedMps);
  const rotationS = 3;
  const rotationM = p.rotationSpeedMps * rotationS;
  const climbStartM = p.takeoffRollM + rotationM;
  if (path.lengthM <= climbStartM) throw new Error('Take-off path must extend beyond rotation');
  const rotation = leg(p.takeoffRollM, climbStartM, p.rotationSpeedMps, p.rotationSpeedMps);
  const acceleration = accelerateToLimit(
    climbStartM,
    path.lengthM,
    p.rotationSpeedMps,
    p.climbSpeedMps,
    1.2,
  );
  const { stationM: atClimbSpeedM, speedMps: climbSpeedMps } = acceleration;
  const climb = leg(atClimbSpeedM, path.lengthM, climbSpeedMps, climbSpeedMps);
  const climbStartS = roll.durationS + rotation.durationS;
  const accelerationEndS = climbStartS + acceleration.durationS;
  const durationS = accelerationEndS + climb.durationS;
  return profile(path, durationS, (timeS) => {
    if (timeS < roll.durationS) return { ...roll.at(timeS), phase: 'takeoff-roll', heightM: 0 };
    if (timeS < climbStartS) {
      const motion = rotation.at(timeS - roll.durationS);
      // Blend from level to the climb gradient over rotation.
      const liftedM = motion.stationM - p.takeoffRollM;
      return {
        ...motion,
        phase: 'rotation',
        heightM: (p.climbGradient * liftedM ** 2) / (2 * rotationM),
      };
    }
    const motion =
      timeS >= durationS
        ? { stationM: path.lengthM, speedMps: climbSpeedMps }
        : timeS < accelerationEndS
          ? acceleration.at(timeS - climbStartS)
          : climb.at(timeS - accelerationEndS);
    return {
      ...motion,
      phase: 'climb',
      heightM: p.climbGradient * (motion.stationM - climbStartM + rotationM / 2),
    };
  });
}

export interface ApproachProfileOptions {
  aimingStationM: number;
  glideAngleRad: number;
  flareDistanceM?: number;
  exitStationM?: number;
  exitSpeedMps?: number;
}

/** The path follows the extended inbound centreline through the aiming point to the runway exit. */
export function approachProfile(
  path: AircraftPath,
  p: FixedWingPerformance,
  {
    aimingStationM,
    glideAngleRad,
    flareDistanceM = 150,
    exitStationM = aimingStationM + p.landingRollM,
    exitSpeedMps = p.taxiStraightMps,
  }: ApproachProfileOptions,
): AircraftMotionProfile {
  if (!(
    0 < flareDistanceM &&
    flareDistanceM <= aimingStationM &&
    aimingStationM < exitStationM &&
    exitStationM <= path.lengthM
  ))
    throw new Error('Approach path must contain the flare, aiming point and rollout exit in order');
  if (!(0 < glideAngleRad && glideAngleRad < Math.PI / 2)) throw new Error('Invalid glide angle');
  if (!(0 <= exitSpeedMps && exitSpeedMps <= p.approachSpeedMps))
    throw new Error('Invalid rollout exit speed');
  const brakingMps2 =
    (p.approachSpeedMps ** 2 - exitSpeedMps ** 2) / (2 * (exitStationM - aimingStationM));
  if (brakingMps2 > p.brakingDecelerationMps2)
    throw new Error('Runway exit is too close for the requested rollout speed');
  const slope = Math.tan(glideAngleRad);
  const touchdownS = aimingStationM / p.approachSpeedMps;
  const rollout = leg(aimingStationM, exitStationM, p.approachSpeedMps, exitSpeedMps);
  const durationS = touchdownS + rollout.durationS;
  return profile(path, durationS, (timeS) => {
    if (timeS >= touchdownS) {
      const motion =
        timeS >= durationS
          ? { stationM: exitStationM, speedMps: exitSpeedMps }
          : rollout.at(timeS - touchdownS);
      return { ...motion, heightM: 0, phase: 'landing-roll' };
    }
    const stationM = timeS * p.approachSpeedMps;
    const remainingM = aimingStationM - stationM;
    // Match the glide slope at flare entry and flatten the trajectory exactly at touchdown.
    const flaring = remainingM <= flareDistanceM;
    const heightM =
      slope * (flaring ? remainingM ** 2 / (2 * flareDistanceM) : remainingM - flareDistanceM / 2);
    return {
      stationM,
      heightM,
      speedMps: p.approachSpeedMps,
      phase: flaring ? 'flare' : 'approach',
    };
  });
}

function helicopterProfile(
  path: AircraftPath,
  p: HelicopterPerformance,
  padClearanceM: number,
  landing: boolean,
) {
  if (!(padClearanceM > 0)) throw new Error('Helicopter pad clearance must be positive');
  const verticalS = padClearanceM / p.verticalClimbMps;
  const transition = accelerateToLimit(0, path.lengthM, 0, p.transitionSpeedMps, 1.5);
  const { stationM: transitionEndM, speedMps } = transition;
  const cruise = leg(transitionEndM, path.lengthM, speedMps, speedMps);
  const cruiseStartS = verticalS + transition.durationS;
  const durationS = cruiseStartS + cruise.durationS;
  return profile(path, durationS, (timeS) => {
    const outboundS = landing ? durationS - timeS : timeS;
    if (outboundS < verticalS)
      return {
        stationM: landing ? path.lengthM : 0,
        heightM: outboundS * p.verticalClimbMps,
        speedMps: 0,
        phase: landing ? 'vertical-descent' : 'vertical-climb',
      };
    const motion =
      outboundS >= durationS
        ? { stationM: path.lengthM, speedMps }
        : outboundS < cruiseStartS
          ? transition.at(outboundS - verticalS)
          : cruise.at(outboundS - cruiseStartS);
    return {
      stationM: landing ? path.lengthM - motion.stationM : motion.stationM,
      heightM: padClearanceM + (motion.stationM * p.verticalClimbMps) / p.transitionSpeedMps,
      speedMps: motion.speedMps,
      phase: landing ? 'helicopter-approach' : 'helicopter-climb',
    };
  });
}

/** The pad is the first point of a departure path. */
export function helicopterTakeoffProfile(
  path: AircraftPath,
  p: HelicopterPerformance,
  padClearanceM = 15,
) {
  return helicopterProfile(path, p, padClearanceM, false);
}

/** The pad is the last point of an arrival path. */
export function helicopterLandingProfile(
  path: AircraftPath,
  p: HelicopterPerformance,
  padClearanceM = 15,
) {
  return helicopterProfile(path, p, padClearanceM, true);
}
