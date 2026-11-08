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

test.each(['left', 'merge'] as const)(
  'T22: a far %s grant lets a crossing car clear first',
  (turn) => {
    const { compiled, left, through, vehicles, intersections, request } = opposing();
    left.turn = turn;
    if (turn === 'merge') compiled.roads[compiled.lanes[left.fromLane]!.road]!.roadClass = 'ramp';
    const start = left.conflictZones[left.conflicts.indexOf(through.idx)]![0];
    vehicles.position[0] = compiled.lanes[left.fromLane]!.lengthM + start - 40;
    vehicles.speed[1] = 13;
    request(0);
    expect(intersections.grants[0]).toBe(left.idx);
    request(1);
    expect(intersections.grants[1]).toBe(through.idx);
  },
);

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
      DEFAULT_SIM_PARAMS.vehicleClasses.car.lengthM + DEFAULT_SIM_PARAMS.idm.minGapM,
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
    DEFAULT_SIM_PARAMS.vehicleClasses.car.lengthM + DEFAULT_SIM_PARAMS.idm.minGapM,
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

test.each([-2, 0])(
  'T22: a far grant uses its expected acceleration (%s), not full throttle',
  (acceleration) => {
    const { compiled, left, through, vehicles, intersections, request } = opposing(
      DEFAULT_SIM_PARAMS,
      { acceleration: () => acceleration },
    );
    const start = left.conflictZones[left.conflicts.indexOf(through.idx)]![0];
    vehicles.position[0] = compiled.lanes[left.fromLane]!.lengthM + start - 20;
    vehicles.speed[0] = acceleration < 0 ? 3 : 1;
    request(0);
    request(1);
    expect(intersections.grants[0]).toBe(left.idx);
    expect(intersections.grants[1]).toBe(through.idx);
  },
);

test('T22: newly granted cars predict acceleration without their former stop-line obstacle', () => {
  const { city, left, through } = opposing();
  for (const node of Object.values(city.nodes)) {
    node.control = 'uncontrolled';
    node.signal = null;
  }
  const all = movementTrips(city);
  const requests = [left, through].map((m) => all.find((trip) => trip.id === `${m.id}:0`)!);
  const compiled = setup(city);
  for (const m of [left, through]) {
    compiled.connectors.find((c) => c.lane === m.fromLane && c.direction === 'out')!.positionM =
      compiled.lanes[m.fromLane]!.lengthM - 2;
  }
  const granted: number[] = [];
  const engine = createEngine();
  engine.load({
    compiled,
    trips: requests,
    scenario: scenario(),
    intersectionObserver: (_id, m, reason) => {
      if (reason === 'granted') granted.push(m.idx);
    },
  });
  engine.step();
  expect(granted).toHaveLength(1);
});

test('T22: a candidate may arrive after a moving holder clears its zone', () => {
  const { left, through, vehicles, intersections, request } = opposing();
  request(0);
  const end = left.conflictZones[left.conflicts.indexOf(through.idx)]![1];
  vehicles.remove(0);
  vehicles.insert(0, -left.idx - 1, end + DEFAULT_SIM_PARAMS.vehicleClasses.car.lengthM - 0.1);
  vehicles.speed[0] = 5;
  request(1);
  expect(intersections.grants[1]).toBe(through.idx);
});

test('T22: shared-exit reservations follow projected clearance but still guard the departing rear', () => {
  const { compiled, left, vehicles, intersections, request } = opposing();
  const other = compiled.movements.find(
    (m) => m.toLane === left.toLane && left.conflicts.includes(m.idx),
  )!;
  vehicles.remove(1);
  vehicles.movement[1] = other.idx;
  vehicles.insert(1, other.fromLane, compiled.lanes[other.fromLane]!.lengthM - 15);
  request(0);
  vehicles.remove(0);
  vehicles.insert(0, -left.idx - 1, left.lengthM - 0.1);
  vehicles.speed[0] = 10;
  request(1);
  expect(intersections.grants[1]).toBe(other.idx);
  const start = other.conflictZones[other.conflicts.indexOf(left.idx)]![0];
  expect(intersections.zoneStop(other, 0)).toBe(start);
  vehicles.remove(0);
  intersections.release(0);
  vehicles.insert(0, left.toLane, 0.1);
  expect(intersections.zoneStop(left, 0)).toBe(Infinity); // Same-path following is not a conflict.
  expect(intersections.zoneStop(other, 0)).toBe(start);
  vehicles.position[0] = DEFAULT_SIM_PARAMS.vehicleClasses.car.lengthM;
  expect(intersections.zoneStop(other, 0)).toBe(Infinity);
});

test.each([0.001, 6.5])(
  'T22: shared-exit commits prevent overlapping insertion and preserve an existing gap (%s m)',
  (secondRemaining) => {
    const { city, compiled: net, left } = opposing();
    const other = net.movements.find(
      (m) => m.toLane === left.toLane && left.conflicts.includes(m.idx),
    )!;
    for (const node of Object.values(city.nodes)) {
      node.control = 'uncontrolled';
      node.signal = null;
    }
    const all = movementTrips(city);
    const requests = [left, other].map((m) => all.find((trip) => trip.id === `${m.id}:0`)!);
    const compiled = setup(city);
    compiled.lanes[left.toLane]!.speedLimitMps = 1;
    const engine = createEngine();
    engine.load({ compiled, trips: requests, scenario: scenario() });
    let checked = false;
    for (let step = 0; step < 2000; step++) {
      engine.step();
      const cars = [engine.inspect(1)!, engine.inspect(2)!];
      if (!cars.every((c) => c.lane < 0 && c.speedMps > 0.2 && c.speedMps < 1.1)) continue;
      const next = setup(city);
      next.lanes[left.toLane]!.speedLimitMps = 1;
      for (const car of cars) {
        const path = next.movements[-car.lane - 1]!;
        path.lengthM = car.positionM + (car.id === 1 ? 0.001 : secondRemaining);
        path.conflictZones = path.conflicts.map(() => [path.lengthM, path.lengthM]);
      }
      engine.patch(next);
      engine.step();
      const exited = [engine.inspect(1)!, engine.inspect(2)!].filter((c) => c.lane === left.toLane);
      expect(exited).toHaveLength(1);
      if (secondRemaining === 6.5) {
        const follower = engine.inspect(2)!;
        expect(
          next.movements[-follower.lane - 1]!.lengthM + exited[0]!.positionM - follower.positionM,
        ).toBeGreaterThanOrEqual(
          DEFAULT_SIM_PARAMS.vehicleClasses.car.lengthM + DEFAULT_SIM_PARAMS.idm.minGapM - 1e-8,
        );
      }
      checked = true;
      break;
    }
    expect(checked).toBe(true);
  },
);

test('T22: a departing rear still blocks an end-reaching crossing with a different exit lane', () => {
  const { left, through, vehicles, intersections, request } = opposing();
  expect(left.toLane).not.toBe(through.toLane);
  left.conflictZones[left.conflicts.indexOf(through.idx)]![1] = left.lengthM;
  request(0);
  vehicles.remove(0);
  vehicles.insert(0, -left.idx - 1, left.lengthM);
  intersections.release(0);
  vehicles.remove(0);
  vehicles.insert(0, left.toLane, 0.1);
  const start = through.conflictZones[through.conflicts.indexOf(left.idx)]![0];
  expect(intersections.zoneStop(through, 0)).toBe(start);
  vehicles.position[0] = DEFAULT_SIM_PARAMS.vehicleClasses.car.lengthM;
  expect(intersections.zoneStop(through, 0)).toBe(Infinity);
});

test('T22: speed-limit braking does not reserve a long zone forever', () => {
  const { city, left, through } = opposing();
  for (const node of Object.values(city.nodes)) {
    node.control = 'uncontrolled';
    node.signal = null;
  }
  const all = movementTrips(city);
  const requests = [left, through].map((m, i) => ({
    ...all.find((trip) => trip.id === `${m.id}:0`)!,
    departS: i === 0 ? 100 : 120,
  }));
  const compiled = setup(city);
  compiled.movements[left.idx]!.lengthM = 500;
  compiled.movements[through.idx]!.lengthM = 200;
  compiled.movements[left.idx]!.conflictZones[left.conflicts.indexOf(through.idx)] = [0, 500];
  compiled.movements[through.idx]!.conflictZones[through.conflicts.indexOf(left.idx)] = [60, 70];
  compiled.connectors.find((c) => c.lane === through.fromLane && c.direction === 'out')!.positionM =
    compiled.lanes[through.fromLane]!.lengthM - 2;
  const granted: number[] = [];
  const engine = createEngine();
  engine.load({
    compiled,
    trips: requests,
    scenario: scenario(),
    params: { idm: { ...DEFAULT_SIM_PARAMS.idm, desiredSpeedSd: 0 } },
    intersectionObserver: (id, _m, reason) => {
      if (reason === 'granted') granted.push(id);
    },
  });
  engine.step(200);
  const holder = engine.inspect(1)!;
  expect(holder.lane).toBe(-left.idx - 1);
  expect(holder.speedMps).toBeGreaterThan(4);
  const next = setup(city);
  for (const path of [left, through]) {
    next.movements[path.idx]!.lengthM = compiled.movements[path.idx]!.lengthM;
    next.movements[path.idx]!.conflictZones = compiled.movements[path.idx]!.conflictZones.map(
      ([a, b]) => [a, b],
    );
  }
  next.connectors.find((c) => c.lane === through.fromLane && c.direction === 'out')!.positionM =
    next.lanes[through.fromLane]!.lengthM - 2;
  next.lanes[left.toLane]!.speedLimitMps = 4;
  next.movements[left.idx]!.conflictZones[left.conflicts.indexOf(through.idx)] = [
    0,
    holder.positionM + 10,
  ];
  engine.patch(next);
  engine.step();
  expect(granted).toContain(1);
  sampleConflictZones(engine, next);
});

test('T22: an approach grant uses the lower movement limit beyond its stop line', () => {
  const { compiled, left, through, vehicles, intersections, request } = opposing(
    DEFAULT_SIM_PARAMS,
    { acceleration: () => 0 },
  );
  compiled.lanes[left.fromLane]!.speedLimitMps = 20;
  compiled.lanes[left.toLane]!.speedLimitMps = 2;
  left.lengthM = 100;
  left.conflictZones[left.conflicts.indexOf(through.idx)]!.splice(0, 2, 30, 40);
  vehicles.speed[0] = 10;
  vehicles.speed[1] = 10;
  request(0);
  request(1);
  expect(intersections.grants[1]).toBe(through.idx);
});
