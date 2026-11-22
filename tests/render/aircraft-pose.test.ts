import { expect, test } from 'vitest';
import { sampleArc } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { AircraftPoseTrack } from '../../src/render/aircraft-pose';
import type { AircraftPose } from '../../src/render/types';
import { aircraftTypes } from '../../src/schema/aircraft';
import { createAircraftFleet } from '../../src/sim/aircraft';
import {
  aircraftPath,
  airborneAttitude,
  approachProfile,
  fixedWingGearStations,
  groundAttitude,
  takeoffProfile,
  taxiProfile,
} from '../../src/sim/aircraft-motion';
import { airportFixture } from '../sim/airside-fixture';

const aircraft = aircraftTypes.find(({ id }) => id === 'E190')!;
const performance = aircraft.performance;
if (performance.kind !== 'fixedWing') throw new Error('Expected fixed-wing performance');
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const runway = aircraftPath([
  { x: 0, y: 0 },
  { x: 14_000, y: 0 },
]);

test('rotates at Vr, holds climb pitch and retracts gear after liftoff', () => {
  const flight = takeoffProfile(runway, performance);
  const vrS = (2 * performance.takeoffRollM) / performance.rotationSpeedMps;
  const at = (t: number) => flight.attitudeAt(t, flight.sample(t));
  expect(flight.sample(vrS).speedMps).toBe(performance.rotationSpeedMps);
  expect(at(vrS - 0.01)).toMatchObject({ pitch: 0, gear: 1, heightM: 0 });
  expect(at(vrS).pitch).toBe(0);
  expect(at(vrS + 0.75).pitch).toBeGreaterThan(radians(1));
  expect(at(vrS + 0.75).heightM).toBe(0);
  expect(at(vrS + 1.5).heightM).toBeGreaterThan(0);
  expect(at(vrS + 1).pitch).toBeGreaterThan(0);
  expect(at(vrS + 1).pitch).toBeLessThan(at(vrS + 3).pitch);
  expect(at(vrS + 3).pitch).toBeGreaterThan(radians(8));
  expect(at(vrS + 3).gear).toBe(1);
  for (let t = vrS + 3; t < flight.durationS; t += 0.1) {
    const { heightM } = flight.sample(t);
    if (heightM < 150) expect(at(t).gear).toBe(1);
    if (heightM > 180) expect(at(t).gear).toBe(0);
    if (heightM > 155 && heightM < 175) {
      expect(at(t).gear).toBeGreaterThan(0);
      expect(at(t).gear).toBeLessThan(1);
    }
  }
});

test('extends gear on final and holds flare pitch through main-gear touchdown', () => {
  const flight = approachProfile(runway, performance, {
    aimingStationM: 10_000,
    glideAngleRad: radians(5.5),
  });
  const touchdownS = 10_000 / performance.approachSpeedMps;
  const at = (t: number) => flight.attitudeAt(t, flight.sample(t));
  expect(at(0).gear).toBe(0);
  expect(at(touchdownS - 120).gear).toBeLessThan(1);
  expect(at(touchdownS - 20).gear).toBe(1);
  const flare = at(touchdownS).pitch;
  expect(flare).toBeGreaterThan(at(touchdownS - 3).pitch);
  expect(at(touchdownS - 0.01).pitch).toBeCloseTo(flare, 4);
  expect(flight.sample(touchdownS).heightM).toBe(0);
  expect(at(touchdownS + 1).pitch).toBeGreaterThan(0);
  expect(at(touchdownS + 1).pitch).toBeLessThan(flare);
  expect(at(touchdownS + 4)).toMatchObject({ pitch: 0, gear: 1, heightM: 0 });
});

test('keeps the nose on a 90-degree centreline turn while the main gear tracks inside', () => {
  const radiusM = 30;
  const curve = sampleArc({ x: 0, y: radiusM }, radiusM, -Math.PI / 2, Math.PI / 2);
  const path = aircraftPath([{ x: -100, y: 0 }, ...curve, { x: 30, y: 150 }]);
  const taxi = taxiProfile(path, performance);
  const { noseX, mainX } = fixedWingGearStations(aircraft.lengthM);
  let previousHeading = 0;
  let previousMain: { x: number; y: number } | undefined;
  let greatestSteer = 0;
  for (let t = 0; t < taxi.durationS; t += 0.05) {
    const motion = taxi.sample(t);
    const pose = groundAttitude(path, motion.stationM, aircraft.lengthM, false);
    const x = pose.x + noseX * Math.cos(pose.heading);
    const y = pose.y + noseX * Math.sin(pose.heading);
    const wheelbase = noseX - mainX;
    const main = {
      x: x - wheelbase * Math.cos(pose.heading),
      y: y - wheelbase * Math.sin(pose.heading),
    };
    if (x > 1 && x < 29 && y < 29) {
      expect(Math.abs(Math.hypot(x, y - radiusM) - radiusM)).toBeLessThan(0.1);
      if (x > 25) expect(Math.hypot(main.x, main.y - radiusM)).toBeLessThan(radiusM);
    }
    if (previousMain) {
      const heading = (previousHeading + pose.heading) / 2;
      const lateralM =
        -(main.x - previousMain.x) * Math.sin(heading) +
        (main.y - previousMain.y) * Math.cos(heading);
      expect(Math.abs(lateralM)).toBeLessThan(0.005);
    }
    greatestSteer = Math.max(greatestSteer, pose.steering);
    expect(Math.abs(pose.heading - previousHeading)).toBeLessThan(radians(35) * 0.05);
    previousHeading = pose.heading;
    previousMain = main;
  }
  expect(greatestSteer).toBeGreaterThan(radians(15));
  expect(previousHeading).toBeCloseTo(Math.PI / 2, 2);
});

test('steers with the same body orientation when the nose follows a turn in reverse', () => {
  const curve = sampleArc({ x: 0, y: 30 }, 30, -Math.PI / 2, Math.PI / 2);
  const path = aircraftPath([{ x: -100, y: 0 }, ...curve, { x: 30, y: 150 }]);
  const reverse = aircraftPath(path.points.toReversed());
  const outbound = groundAttitude(path, 118, aircraft.lengthM, false);
  const pushback = groundAttitude(reverse, path.lengthM - 118, aircraft.lengthM, true);
  expect(pushback.x).toBeCloseTo(outbound.x, 8);
  expect(pushback.y).toBeCloseTo(outbound.y, 8);
  expect(pushback.heading).toBeCloseTo(outbound.heading, 8);
  expect(pushback.steering).toBeCloseTo(outbound.steering, 8);
});

test('lines up at a stand with a short lead-in and retraces the pose on pushback', () => {
  const path = aircraftPath([
    { x: -60, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 21 },
  ]);
  const reverse = aircraftPath(path.points.toReversed());
  const centreM = path.lengthM - aircraft.lengthM / 2;
  const stand = { pos: { x: 0, y: 21 }, heading: Math.PI / 2, centreM };
  const parked = groundAttitude(path, centreM, aircraft.lengthM, false, stand);
  expect(parked.x).toBeCloseTo(0);
  expect(parked.y).toBeCloseTo(21 - aircraft.lengthM / 2);
  expect(parked.heading).toBeCloseTo(Math.PI / 2);
  expect(parked.steering).toBe(0);
  const leaving = groundAttitude(reverse, reverse.lengthM - centreM, aircraft.lengthM, true, {
    ...stand,
    centreM: reverse.lengthM - centreM,
  });
  expect(leaving.x).toBeCloseTo(parked.x);
  expect(leaving.y).toBeCloseTo(parked.y);
  expect(leaving.heading).toBeCloseTo(parked.heading);
});

test('banks into a curved climb and levels off on the straight', () => {
  const path = aircraftPath([
    ...sampleArc({ x: 0, y: 500 }, 500, -Math.PI / 2, Math.PI / 2),
    { x: 500, y: 1500 },
  ]);
  expect(airborneAttitude(path, 300, 70, 100).roll).toBeGreaterThan(radians(20));
  expect(airborneAttitude(path, path.lengthM - 300, 70, 100).roll).toBe(0);
});

test('continues a departure line-up into its takeoff roll without a jump', () => {
  const { city, stands } = airportFixture();
  const result = compile(city);
  if (!result.ok || !result.compiled.airside) throw new Error('Expected a compiled airport');
  const fleet = createAircraftFleet(result.compiled.airside, 1);
  const aircraft = fleet.spawnParked({ typeId: 'BCS3', stand: stands.E2 });
  if (!aircraft.ok) throw new Error(aircraft.reason);
  expect(fleet.requestDeparture(aircraft.id, '27').ok).toBe(true);

  let previous = fleet.snapshot()[0]!;
  for (let step = 1; step < 4000; step++) {
    fleet.step(step / 10);
    const current = fleet.snapshot()[0]!;
    if (previous.state === 'line-up' && current.state === 'takeoff-roll') {
      const a = previous.visual!;
      const b = current.visual!;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(0.25);
      const delta = b.heading - a.heading;
      expect(Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)))).toBeLessThan(radians(3.5));
      return;
    }
    previous = current;
  }
  throw new Error('Expected the aircraft to begin its takeoff roll');
});

test('interpolates position and attitude across the angle wrap and settles when paused', () => {
  const snapshot: AircraftPose = {
    id: 1,
    registration: 'G-TEST',
    typeId: 'E190',
    x: 0,
    y: 0,
    heightM: 10,
    heading: radians(179),
    speedMps: 70,
    state: 'climb',
    enginesRunning: true,
    onRunway: false,
    airborne: true,
    gearDown: true,
    stand: null,
    runwayEnd: null,
    route: [],
  };
  const track = new AircraftPoseTrack(snapshot, 10);
  track.update(
    {
      ...snapshot,
      x: -7,
      heading: radians(-179),
      visual: {
        x: -7,
        y: 0,
        heightM: 10,
        heading: radians(-179),
        pitch: radians(10),
        roll: radians(8),
        steering: 0,
        gear: 0.5,
      },
    },
    10.1,
    1,
  );
  track.sample(0.05, true);
  expect(track.pose.x).toBeCloseTo(-3.5);
  expect(Math.abs(track.pose.heading)).toBeCloseTo(Math.PI);
  expect(track.pose.visual.pitch).toBeCloseTo(radians(5));
  expect(track.pose.visual.roll).toBeCloseTo(radians(4));
  expect(track.pose.visual.gear).toBeCloseTo(0.75);
  track.sample(0, false);
  expect(track.pose.x).toBe(-7);
  expect(track.pose.visual.gear).toBe(0.5);

  const fast = new AircraftPoseTrack(snapshot, 20);
  fast.update({ ...snapshot, x: -140, heading: radians(-177) }, 22, 20);
  expect(fast.pose.x).toBe(0);
  fast.sample(1, true);
  expect(fast.pose.x).toBe(-70);
  expect(Math.abs(fast.pose.heading - radians(181))).toBeLessThan(1e-9);
  fast.update({ ...snapshot, x: -700 }, 30, 0);
  expect(fast.pose.x).toBe(-700);
});
