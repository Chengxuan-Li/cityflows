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
  attitudeAt?(
    elapsedS: number,
    pose: AircraftPose,
  ): Pick<AircraftVisualPose, 'pitch' | 'gear' | 'heightM'>;
}

export interface AircraftVisualPose {
  x: number;
  y: number;
  heightM: number;
  heading: number;
  pitch: number;
  roll: number;
  steering: number;
  /** Landing gear extension, from stowed (0) to fully down (1). */
  gear: number;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const angle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));

function ease(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}

export function goAroundAttitude(
  elapsedS: number,
  initial: Pick<AircraftVisualPose, 'pitch' | 'gear'>,
  climbGradient: number,
) {
  const pitch = Math.atan(climbGradient) + radians(6);
  return {
    pitch: initial.pitch + (pitch - initial.pitch) * ease(elapsedS / 3),
    gear: initial.gear * (1 - ease((elapsedS - 3) / 5)),
  };
}

/** Longitudinal gear stations in the model's frame, measured from its centre. */
export function fixedWingGearStations(lengthM: number) {
  return { noseX: 0.34 * lengthM, mainX: -0.08 * lengthM };
}

/** Follow the centreline with the nose wheel and let the main gear track inside the turn.
 * Integrate the bicycle model in forward body direction even when the tug pushes backwards. */
export function groundAttitude(
  path: AircraftPath,
  centreM: number,
  lengthM: number,
  reverse: boolean,
  stop?: { pos: Vec2; heading: number; centreM: number },
) {
  const { noseX, mainX } = fixedWingGearStations(lengthM);
  const wheelbase = noseX - mainX;
  const direction = reverse ? -1 : 1;
  const noseM = Math.max(0, Math.min(path.lengthM, centreM + direction * noseX));
  const { points, stationsM } = path;
  const nose = pointAtDistance(points, stationsM, noseM);
  // The initial heading's influence decays exponentially over the preceding wheelbases.
  let at = Math.max(0, Math.min(path.lengthM, noseM - direction * 6 * wheelbase));
  let lo = 0;
  let hi = stationsM.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (stationsM[mid]! < at || (!reverse && stationsM[mid] === at)) lo = mid;
    else hi = mid;
  }
  const trackHeading = (i: number) => {
    const a = points[i]!;
    const b = points[i + 1]!;
    return Math.atan2(direction * (b.y - a.y), direction * (b.x - a.x));
  };
  let heading = trackHeading(lo);
  for (let i = lo; direction * (noseM - at) > 0; i += direction) {
    const end = reverse ? Math.max(noseM, stationsM[i]!) : Math.min(noseM, stationsM[i + 1]!);
    const tangent = trackHeading(i);
    // d(heading)/ds = sin(tangent - heading) / wheelbase on each straight chord.
    const error = angle(tangent - heading);
    heading =
      tangent - 2 * Math.atan(Math.tan(error / 2) * Math.exp(-Math.abs(end - at) / wheelbase));
    at = end;
  }
  const before = pointAtDistance(points, stationsM, noseM - direction * 1.5);
  const after = pointAtDistance(points, stationsM, noseM + direction * 1.5);
  const tangent = Math.atan2(after.y - before.y, after.x - before.x);
  let { x, y } = nose;
  const alignment = stop ? ease(1 - Math.abs(centreM - stop.centreM) / (2 * wheelbase)) : 0;
  if (stop && alignment > 0) {
    // The nose wheel's track lags the path's heading after a turn. Settle into the body's pose
    // at the stop (`pos` its centre; TASK-320: the parked pose the simulation holds), using the
    // same alignment while moving off it in reverse.
    const end = pointAtDistance(points, stationsM, stop.centreM + direction * noseX);
    x += alignment * (stop.pos.x + noseX * Math.cos(stop.heading) - end.x);
    y += alignment * (stop.pos.y + noseX * Math.sin(stop.heading) - end.y);
    heading += alignment * angle(stop.heading - heading);
  }
  const steering = Math.max(-radians(75), Math.min(radians(75), angle(tangent - heading)));
  return {
    x: x - noseX * Math.cos(heading),
    y: y - noseX * Math.sin(heading),
    heading,
    steering: steering * (1 - alignment),
  };
}

/** Finish aligning with the runway over the existing line-up pause. */
export function lineUpAttitude(
  ground: Pick<AircraftVisualPose, 'x' | 'y' | 'heading' | 'steering'>,
  runway: AircraftPath,
  progress: number,
) {
  const t = ease(progress);
  const start = runway.points[0]!;
  const heading = headingAtDistance(runway.points, runway.stationsM, 0);
  return {
    x: ground.x + (start.x - ground.x) * t,
    y: ground.y + (start.y - ground.y) * t,
    heading: ground.heading + angle(heading - ground.heading) * t,
    steering: ground.steering * (1 - t),
  };
}

/** Coordinated bank from signed path curvature. Short chords smooth the tangent across vertices. */
export function airborneAttitude(
  path: AircraftPath,
  stationM: number,
  speedMps: number,
  heightM: number,
) {
  const { points, stationsM } = path;
  const at = (s: number) => pointAtDistance(points, stationsM, s);
  const centre = at(stationM);
  const lookM = Math.max(10, speedMps * 0.65);
  const a = at(stationM - lookM);
  const b = at(stationM + lookM);
  const inbound = Math.atan2(centre.y - a.y, centre.x - a.x);
  const outbound = Math.atan2(b.y - centre.y, b.x - centre.x);
  const curvature =
    a !== centre && b !== centre
      ? (2 * angle(outbound - inbound)) /
        Math.max(1, Math.min(path.lengthM, stationM + lookM) - Math.max(0, stationM - lookM))
      : 0;
  const bank = Math.atan((speedMps ** 2 * curvature) / 9.81);
  return {
    heading: Math.atan2(b.y - a.y, b.x - a.x),
    roll: Math.max(-radians(25), Math.min(radians(25), bank)) * ease(heightM / 15),
  };
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
    // The tight-turn speed caps manoeuvring near the minimum radius. On broader curves,
    // scale it with radius at constant lateral acceleration, up to the taxiway limit.
    const turnSpeedMps =
      performance.taxiTurnMps * Math.sqrt(Math.max(1, radiusM / performance.minTurnRadiusM));
    return Math.min(
      speedLimitMps,
      turnSpeedMps,
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
export function takeoffProfile(path: AircraftPath, p: FixedWingPerformance) {
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
  const motionProfile = profile(path, durationS, (timeS) => {
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
  const climbPitch = Math.atan(p.climbGradient) + radians(6);
  return {
    ...motionProfile,
    attitudeAt(elapsedS: number, pose: AircraftPose) {
      const rotatingS = elapsedS - roll.durationS;
      const liftOffS = 0.8;
      return {
        pitch: climbPitch * ease(rotatingS / rotationS),
        // During the first part of rotation the body pivots on the main wheels. Meet
        // the climb profile again by the end of rotation.
        heightM: pose.heightM * ease((rotatingS - liftOffS) / (rotationS - liftOffS)),
        gear: 1 - ease((pose.heightM - 150) / 30),
      };
    },
  };
}

export interface ApproachProfileOptions {
  aimingStationM: number;
  glideAngleRad: number;
  flareDistanceM?: number;
  exitStationM?: number;
  exitSpeedMps?: number;
}

export const approachFinalM = 10_000;
export const approachFlareM = 150;
/** ICAO aiming point, in metres beyond the threshold. */
export const approachAimingM = (landingDistanceM: number) => Math.min(300, 0.2 * landingDistanceM);

/** Match the glide slope at flare entry and flatten the trajectory exactly at touchdown. */
export function approachHeightM(remainingM: number, slope: number, flareDistanceM = approachFlareM) {
  return slope * (remainingM <= flareDistanceM
    ? remainingM ** 2 / (2 * flareDistanceM)
    : remainingM - flareDistanceM / 2);
}

/** The path follows the extended inbound centreline through the aiming point to the runway exit. */
export function approachProfile(
  path: AircraftPath,
  p: FixedWingPerformance,
  {
    aimingStationM,
    glideAngleRad,
    flareDistanceM = approachFlareM,
    exitStationM = aimingStationM + p.landingRollM,
    exitSpeedMps = p.taxiStraightMps,
  }: ApproachProfileOptions,
) {
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
  const motionProfile = profile(path, durationS, (timeS) => {
    if (timeS >= touchdownS) {
      const motion =
        timeS >= durationS
          ? { stationM: exitStationM, speedMps: exitSpeedMps }
          : rollout.at(timeS - touchdownS);
      return { ...motion, heightM: 0, phase: 'landing-roll' };
    }
    const stationM = timeS * p.approachSpeedMps;
    const remainingM = aimingStationM - stationM;
    const flaring = remainingM <= flareDistanceM;
    const heightM = approachHeightM(remainingM, slope, flareDistanceM);
    return {
      stationM,
      heightM,
      speedMps: p.approachSpeedMps,
      phase: flaring ? 'flare' : 'approach',
    };
  });
  const approachPitch = Math.min(radians(2), radians(5) - glideAngleRad);
  const flarePitch = radians(6);
  const flareS = flareDistanceM / p.approachSpeedMps;
  return {
    ...motionProfile,
    attitudeAt(elapsedS: number, pose: AircraftPose) {
      return {
        heightM: pose.heightM,
        pitch:
          elapsedS < touchdownS
            ? approachPitch +
              (flarePitch - approachPitch) * ease(1 + (elapsedS - touchdownS) / flareS)
            : flarePitch * (1 - ease((elapsedS - touchdownS) / Math.min(3, rollout.durationS))),
        gear: ease((600 - pose.heightM) / 80),
      };
    },
  };
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
