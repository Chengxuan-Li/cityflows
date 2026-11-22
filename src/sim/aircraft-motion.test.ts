import { describe, expect, test } from 'vitest';
import { sampleArc } from '../geo/polyline';
import { aircraftTypes } from '../schema/aircraft';
import {
  aircraftPath,
  approachProfile,
  helicopterLandingProfile,
  helicopterTakeoffProfile,
  hoverTaxiProfile,
  pushbackProfile,
  takeoffProfile,
  taxiProfile,
  towProfile,
} from './aircraft-motion';

const fixedWing = aircraftTypes.flatMap(({ id, performance }) =>
  performance.kind === 'fixedWing' ? [{ id, performance }] : [],
);
const helicopters = aircraftTypes.flatMap(({ id, performance }) =>
  performance.kind === 'helicopter' ? [{ id, performance }] : [],
);
const regional = fixedWing.find(({ id }) => id === 'E190')!.performance;
const line = (lengthM: number) =>
  aircraftPath([
    { x: 0, y: 0 },
    { x: lengthM, y: 0 },
  ]);

describe('aircraft motion', () => {
  test.each(fixedWing)(
    '$id reaches rotation and taxi speed at its nominal roll lengths',
    ({ performance }) => {
      const departure = takeoffProfile(line(10_000), performance);
      const rotationS = (2 * performance.takeoffRollM) / performance.rotationSpeedMps;
      expect(departure.sample(rotationS - 0.01).phase).toBe('takeoff-roll');
      expect(departure.sample(rotationS)).toMatchObject({
        phase: 'rotation',
        stationM: performance.takeoffRollM,
        speedMps: performance.rotationSpeedMps,
        heightM: 0,
      });
      const climb = departure.sample(departure.durationS);
      expect(climb).toMatchObject({
        phase: 'climb',
        stationM: 10_000,
        speedMps: performance.climbSpeedMps,
      });
      expect(climb.heightM).toBeGreaterThan(0);
      expect(climb.heightM - departure.sample(departure.durationS - 1).heightM).toBeCloseTo(
        performance.climbGradient * performance.climbSpeedMps,
      );

      const approach = approachProfile(line(14_000), performance, {
        aimingStationM: 10_000,
        glideAngleRad: Math.PI / 60,
      });
      expect(approach.sample(10_000 / performance.approachSpeedMps)).toMatchObject({
        phase: 'landing-roll',
        stationM: 10_000,
        heightM: 0,
        speedMps: performance.approachSpeedMps,
      });
      expect(approach.sample(approach.durationS + 10)).toMatchObject({
        stationM: 10_000 + performance.landingRollM,
        speedMps: performance.taxiStraightMps,
        heightM: 0,
      });
    },
  );

  test.each([3, 5.5])('flies a %s degree glide slope and flares to the aiming point', (degrees) => {
    const path = aircraftPath([
      { x: 50, y: -10_000 },
      { x: 50, y: 3_000 },
    ]);
    const slope = Math.tan((degrees * Math.PI) / 180);
    const profile = approachProfile(path, regional, {
      aimingStationM: 10_000,
      glideAngleRad: (degrees * Math.PI) / 180,
      flareDistanceM: 120,
      exitStationM: 11_200,
      exitSpeedMps: regional.taxiTurnMps,
    });
    const at = (stationM: number) => profile.sample(stationM / regional.approachSpeedMps);
    expect((at(1000).heightM - at(2000).heightM) / 1000).toBeCloseTo(slope, 10);
    expect(at(9940).phase).toBe('flare');
    expect(at(9940).heightM).toBeCloseTo(15 * slope, 10);
    expect(at(9999).heightM).toBeGreaterThan(0);
    expect(at(10_000)).toMatchObject({
      heightM: 0,
      headingRad: Math.PI / 2,
      position: { x: 50, y: 0 },
    });
    expect(profile.sample(profile.durationS)).toMatchObject({
      position: { x: 50, y: 1200 },
      speedMps: regional.taxiTurnMps,
    });
  });

  test('brakes before a curve and never exceeds its lateral limit', () => {
    const radiusM = 20;
    const curve = sampleArc({ x: 0, y: radiusM }, radiusM, -Math.PI / 2, Math.PI / 2);
    const path = aircraftPath([{ x: -300, y: 0 }, ...curve, { x: 20, y: 120 }]);
    const performance = { ...regional, maxLateralAccelerationMps2: 0.5, taxiTurnMps: 5 };
    const profile = taxiProfile(path, performance);
    let peakCurveSpeedMps = 0;
    let peakStraightSpeedMps = 0;
    for (let timeS = 0; timeS < profile.durationS; timeS += 0.07) {
      const { stationM, speedMps } = profile.sample(timeS);
      if (stationM < 250) peakStraightSpeedMps = Math.max(peakStraightSpeedMps, speedMps);
      if (stationM >= 300 && stationM <= 331)
        peakCurveSpeedMps = Math.max(peakCurveSpeedMps, speedMps);
    }
    expect(peakStraightSpeedMps).toBeCloseTo(performance.taxiStraightMps);
    expect(peakCurveSpeedMps ** 2 / radiusM).toBeCloseTo(0.5, 8);
  });

  test('carries taxiway speed through a broad curve while respecting its lateral limit', () => {
    const radiusM = 140;
    const curve = sampleArc({ x: 0, y: radiusM }, radiusM, -Math.PI / 2, Math.PI / 3);
    const path = aircraftPath([{ x: -200, y: 0 }, ...curve]);
    const motion = taxiProfile(path, regional);
    const speeds = Array.from({ length: Math.ceil(motion.durationS * 10) }, (_, i) =>
      motion.sample(i / 10),
    )
      .filter(({ stationM }) => stationM > 220 && stationM < 280)
      .map(({ speedMps }) => speedMps);
    expect(Math.min(...speeds)).toBeGreaterThan(8);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(
      Math.sqrt(radiusM * regional.maxLateralAccelerationMps2) + 1e-6,
    );
  });

  test('stops exactly at a station inside a segment from a moving start', () => {
    const profile = taxiProfile(line(300), regional, {
      startStationM: 30,
      startSpeedMps: 5,
      stopStationM: 137.5,
    });
    expect(profile.sample(0).stationM).toBe(30);
    expect(profile.sample(0).speedMps).toBe(5);
    expect(profile.sample(profile.durationS - 0.1).stationM).toBeLessThan(137.5);
    const stopped = { stationM: 137.5, position: { x: 137.5, y: 0 }, speedMps: 0 };
    expect(profile.sample(profile.durationS)).toMatchObject(stopped);
    expect(profile.sample(profile.durationS + 100)).toMatchObject(stopped);
    expect(() => taxiProfile(line(300), regional, { startSpeedMps: 5, stopStationM: 0.5 })).toThrow(
      /stop/,
    );
  });

  test('rejects a taxi path that doubles back through a zero-radius turn', () => {
    const path = aircraftPath([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 25, y: 0 },
    ]);
    expect(() => taxiProfile(path, regional)).toThrow(/reversal/);
  });

  test('rejects a runway exit that would require braking above the type limit', () => {
    expect(() =>
      approachProfile(line(14_000), regional, {
        aimingStationM: 10_000,
        glideAngleRad: Math.PI / 60,
        exitStationM: 10_030,
      }),
    ).toThrow(/too close/);
  });

  test('pushback faces against travel and towing follows its own speed limit', () => {
    const path = line(50);
    const push = pushbackProfile(path, regional);
    const tow = towProfile(path, regional);
    expect(push.sample(push.durationS / 2)).toMatchObject({
      phase: 'pushback',
      headingRad: Math.PI,
      speedMps: regional.pushbackSpeedMps,
    });
    expect(tow.sample(tow.durationS / 2)).toMatchObject({
      phase: 'tow',
      headingRad: 0,
      speedMps: regional.towSpeedMps,
    });
    expect(push.sample(push.durationS).stationM).toBe(50);
    expect(tow.sample(tow.durationS).speedMps).toBe(0);
  });

  test.each(helicopters)('$id climbs and descends vertically at the pad', ({ performance }) => {
    const path = line(1000);
    const takeoff = helicopterTakeoffProfile(path, performance);
    const landing = helicopterLandingProfile(path, performance);
    expect(takeoff.sample(1)).toMatchObject({
      phase: 'vertical-climb',
      position: { x: 0, y: 0 },
      heightM: performance.verticalClimbMps,
      speedMps: 0,
    });
    expect(takeoff.sample(takeoff.durationS)).toMatchObject({
      phase: 'helicopter-climb',
      speedMps: performance.transitionSpeedMps,
    });
    expect(landing.sample(landing.durationS - 1)).toMatchObject({
      phase: 'vertical-descent',
      position: { x: 1000, y: 0 },
      speedMps: 0,
    });
    expect(landing.sample(landing.durationS).heightM).toBe(0);
    const hover = hoverTaxiProfile(path, performance, { stopStationM: 50 });
    expect(hover.sample(hover.durationS / 2)).toMatchObject({
      phase: 'hover-taxi',
      speedMps: performance.hoverTaxiMps,
    });
    expect(hover.sample(hover.durationS)).toMatchObject({ stationM: 50, speedMps: 0 });
  });

  test('elapsed-time samples replay exactly regardless of tick size or sampling order', () => {
    const performance = regional;
    const makeProfile = () => taxiProfile(line(99), performance);
    const first = makeProfile();
    const times = [0, 0.3, 4.75, 2.4, first.durationS + 1, first.durationS];
    const expected = times.map((time) => first.sample(time));
    const replay = makeProfile();
    expect(
      times
        .toReversed()
        .map((time) => replay.sample(time))
        .toReversed(),
    ).toEqual(expected);
  });
});
