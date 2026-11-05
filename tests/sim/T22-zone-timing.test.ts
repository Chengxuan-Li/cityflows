import { expect, test } from 'vitest';
import { simParamsSchema } from '../../src/schema/demand.schema';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup } from './fixtures';
import { sampleConflictZones } from './conflict-zone-safety';
import { movementTrips, opposing } from './zone-fixtures';

test('T22: legacy intersection settings receive defaults and custom timing settings survive parsing', () => {
  const legacy = { decisionDistanceM: 15, gapS: 4, creepSpeedMps: 1 };
  expect(simParamsSchema.parse({ intersection: legacy }).intersection).toEqual({
    ...legacy,
    zoneMarginS: 1,
    boxWaitS: 10,
  });
  const intersection = { ...legacy, zoneMarginS: 0.5, boxWaitS: 20 };
  expect(simParamsSchema.parse({ intersection }).intersection).toEqual(intersection);
});

test('T22: a far left-turn grant lets an opposing through car clear first', () => {
  const { compiled, left, through, vehicles, intersections, request } = opposing();
  const start = left.conflictZones[left.conflicts.indexOf(through.idx)]![0];
  vehicles.position[0] = compiled.lanes[left.fromLane]!.lengthM + start - 40;
  vehicles.speed[1] = 13;
  request(0);
  expect(intersections.grants[0]).toBe(left.idx);
  request(1);
  expect(intersections.grants[1]).toBe(through.idx);
});

test.each([0, 1])('T22: the same slow crossing car respects a %s second margin', (zoneMarginS) => {
  const { compiled, left, through, vehicles, intersections, request } = opposing({
    ...DEFAULT_SIM_PARAMS,
    intersection: { ...DEFAULT_SIM_PARAMS.intersection, zoneMarginS },
  });
  const start = left.conflictZones[left.conflicts.indexOf(through.idx)]![0];
  vehicles.position[0] = compiled.lanes[left.fromLane]!.lengthM + start - 40;
  request(0);
  request(1);
  expect(intersections.grants[1]).toBe(zoneMarginS === 0 ? through.idx : -1);
});

test.each([2, 10])(
  'T22: a stopped exit queue holds a candidate for %s seconds at the line',
  (boxWaitS) => {
    const { left, vehicles, intersections, request } = opposing({
      ...DEFAULT_SIM_PARAMS,
      intersection: { ...DEFAULT_SIM_PARAMS.intersection, boxWaitS },
    });
    vehicles.remove(1);
    vehicles.insert(
      1,
      left.toLane,
      DEFAULT_SIM_PARAMS.vehicleLengthM + DEFAULT_SIM_PARAMS.idm.minGapM,
    );
    vehicles.junctionWaiting[0] = 100; // Time approaching the line does not count.
    request(0);
    expect(intersections.grants[0]).toBe(-1);
    vehicles.stopped[0] = boxWaitS - 0.1;
    request(0);
    expect(intersections.grants[0]).toBe(-1);
    vehicles.stopped[0] = boxWaitS;
    request(0);
    expect(intersections.grants[0]).toBe(left.idx);
  },
);

test('T22: a moving exit queue projected clear lets the candidate enter immediately', () => {
  const { left, vehicles, intersections, request } = opposing();
  vehicles.remove(1);
  vehicles.insert(
    1,
    left.toLane,
    DEFAULT_SIM_PARAMS.vehicleLengthM + DEFAULT_SIM_PARAMS.idm.minGapM,
  );
  vehicles.speed[1] = 3;
  request(0);
  expect(intersections.grants[0]).toBe(left.idx);
});

test.each([false, true])(
  'T22: the movement backstop clamps and counts a zone stop (occupied at step start: %s)',
  (occupiedAtStart) => {
    const { city, left, through } = opposing();
    for (const node of Object.values(city.nodes)) {
      node.control = 'uncontrolled';
      node.signal = null;
    }
    const all = movementTrips(city);
    const requests = [
      all.find((trip) => trip.id === `${left.id}:0`)!,
      { ...all.find((trip) => trip.id === `${through.id}:0`)!, departS: 102 },
    ];
    const compiled = setup(city);
    compiled.lanes[left.toLane]!.speedLimitMps = 1;
    const engine = createEngine();
    engine.load({
      compiled,
      trips: requests,
      scenario: scenario(),
      params: {
        // Small headway keeps IDM's soft braking from hiding a missing hard clamp.
        idm: { ...DEFAULT_SIM_PARAMS.idm, headwayS: 0, bMps2: 1e6, desiredSpeedSd: 0 },
      },
    });
    let stopped = false;
    for (let step = 0; step < 1000; step++) {
      engine.step();
      const holder = engine.inspect(1)!;
      const follower = engine.inspect(2)!;
      if (
        holder.lane !== -left.idx - 1 ||
        follower.lane !== -through.idx - 1 ||
        follower.speedMps < 1
      )
        continue;
      const next = setup(city);
      next.lanes[left.toLane]!.speedLimitMps = 1;
      const stop = follower.positionM + 0.01;
      next.movements[left.idx]!.conflictZones[left.conflicts.indexOf(through.idx)] = [
        occupiedAtStart ? 0 : holder.positionM + 0.01,
        left.lengthM,
      ];
      next.movements[through.idx]!.conflictZones[through.conflicts.indexOf(left.idx)] = [
        stop,
        through.lengthM,
      ];
      engine.patch(next);
      const before = engine.metrics().zoneStops;
      engine.step();
      expect(engine.inspect(2)!.positionM).toBe(stop);
      expect(engine.metrics().zoneStops).toBe(before + 1);
      sampleConflictZones(engine, next);
      for (let i = 0; i < 1000; i++) {
        engine.step();
        sampleConflictZones(engine, next);
      }
      expect(engine.metrics().trips.completed).toBe(2);
      stopped = true;
      break;
    }
    expect(stopped).toBe(true);
  },
);

test('T22: an approach grant cannot bypass the zone clamp during movement entry', () => {
  const { city, left, through } = opposing();
  for (const node of Object.values(city.nodes)) {
    node.control = 'uncontrolled';
    node.signal = null;
  }
  const all = movementTrips(city);
  const requests = [
    all.find((trip) => trip.id === `${left.id}:0`)!,
    { ...all.find((trip) => trip.id === `${through.id}:0`)!, departS: 104 },
  ];
  const compiled = setup(city);
  for (const path of [left, through]) {
    const origin = compiled.connectors.find(
      (c) => c.lane === path.fromLane && c.direction === 'out',
    )!;
    origin.positionM = compiled.lanes[path.fromLane]!.lengthM - 2;
  }
  // A contact late on the turn, at the start of the crossing movement. The coarse step
  // deliberately makes the timing prediction stale before the granted approach enters.
  compiled.movements[left.idx]!.conflictZones[left.conflicts.indexOf(through.idx)] = [
    left.lengthM * 0.75,
    left.lengthM,
  ];
  compiled.movements[through.idx]!.conflictZones[through.conflicts.indexOf(left.idx)] = [0, 0];
  const engine = createEngine();
  engine.load({
    compiled,
    trips: requests,
    scenario: scenario(),
    params: {
      dtS: 4,
      idm: { ...DEFAULT_SIM_PARAMS.idm, headwayS: 0, bMps2: 1e6, desiredSpeedSd: 0 },
    },
  });
  engine.step(2);
  expect(engine.inspect(1)!.lane).toBe(-left.idx - 1);
  expect(engine.inspect(2)!.lane).toBe(through.fromLane);
  expect(engine.metrics().zoneStops).toBe(0);
  engine.step();
  expect(engine.inspect(2)).toMatchObject({ lane: -through.idx - 1, positionM: 0 });
  expect(engine.metrics().zoneStops).toBe(1);
  sampleConflictZones(engine, compiled);
});
