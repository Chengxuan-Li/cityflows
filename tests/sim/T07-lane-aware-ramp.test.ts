import { expect, test } from 'vitest';
import { ramp } from '../../src/fixtures/ramp';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';
import { buildCity } from '../../src/fixtures/build-city';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createMerges } from '../../src/sim/merge';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { createLaneChanges } from '../../src/sim/lane-change';

test.each(['on-ramp', 'mainline'])(
  'T07 %s traffic follows the compiled merge and exit lanes',
  (origin) => {
    const city = ramp();
    const [from, to] = Object.values(city.places);
    from!.connectors = [from!.connectors[origin === 'on-ramp' ? 0 : 1]!];
    to!.connectors = [to!.connectors[0]!];
    const compiled = setup(city);
    const engine = createEngine();
    engine.load({ compiled, scenario: scenario(), trips: trips(city, 8, 2) });
    const exit = compiled.movements.find(
      (movement) =>
        movement.turn === 'diverge' &&
        compiled.roads[compiled.lanes[movement.toLane]!.road]!.roadClass === 'ramp',
    )!;
    const merges = compiled.movements.filter(
      (movement) =>
        movement.turn === 'merge' &&
        compiled.roads[compiled.lanes[movement.fromLane]!.road]!.roadClass === 'ramp',
    );
    const merged = new Set<number>();
    const exited = new Set<number>();
    let previous = new Int32Array(9).fill(-100);

    for (let i = 0; i < 900; i++) {
      engine.step();
      const snapshot = engine.snapshot();
      const lanes = new Int32Array(9).fill(-100);
      for (const [index, id] of snapshot.id.entries()) {
        const lane = snapshot.lane[index]!;
        lanes[id] = lane;
        const merge = lane < 0 ? compiled.movements[-lane - 1] : undefined;
        if (merge && merges.includes(merge) && !merged.has(id)) {
          expect(previous[id]).toBe(merge.fromLane);
          merged.add(id);
        }
        if (lane === -exit.idx - 1 && !exited.has(id)) {
          expect(previous[id]).toBe(exit.fromLane);
          exited.add(id);
        }
        if (
          origin === 'on-ramp' &&
          lane >= 0 &&
          compiled.roads[compiled.lanes[lane]!.road]!.roadClass === 'motorway'
        ) {
          expect(merged.has(id)).toBe(true);
        }
      }
      previous = lanes;
    }
    expect(merged.size).toBe(origin === 'on-ramp' ? 8 : 0);
    expect(exited.size).toBe(8);
    expect(engine.metrics().trips.completed).toBe(8);
  },
);

test('T07 mixed ramp/mainline traffic has safe entries and bounded merge braking', () => {
  const city = ramp();
  const [origin, destination] = Object.values(city.places);
  const main = structuredClone(origin!);
  main.id = 'p:900';
  main.connectors = [{ ...origin!.connectors[1]!, id: 'c:901', lane: 1, throughputPerMin: 60 }];
  city.places[main.id] = main;
  origin!.connectors = [{ ...origin!.connectors[0]!, throughputPerMin: 60 }];
  destination!.connectors = [{ ...destination!.connectors[0]!, throughputPerMin: 120 }];
  const demand = trips(city, 24, 3).flatMap((trip, i) => [
    trip,
    { ...trip, id: `main:${i}`, originPlaceId: main.id, departS: trip.departS + 0.7 },
  ]);
  const compiled = setup(city);
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: scenario(),
    trips: demand,
    params: {
      mobil: { ...DEFAULT_SIM_PARAMS.mobil, thresholdMps2: 100 },
      idm: { ...DEFAULT_SIM_PARAMS.idm, desiredSpeedSd: 0 },
    },
  });
  const merges = compiled.movements.filter(
    (m) =>
      m.turn === 'merge' && compiled.roads[compiled.lanes[m.fromLane]!.road]!.roadClass === 'ramp',
  );
  const exit = compiled.movements.find(
    (m) =>
      m.turn === 'diverge' && compiled.roads[compiled.lanes[m.toLane]!.road]!.roadClass === 'ramp',
  )!;
  const merged = new Set<number>(),
    exited = new Set<number>();
  let previous = demand.map((_, i) => engine.inspect(i + 1));
  let braking = 0;
  for (let step = 0; step < 5000; step++) {
    engine.step();
    const current = demand.map((_, i) => engine.inspect(i + 1));
    for (const [i, car] of current.entries()) {
      if (!car || car.state !== 'driving') continue;
      const before = previous[i];
      const crossing = car.lane < 0 ? compiled.movements[-car.lane - 1] : undefined;
      if (crossing && merges.includes(crossing)) merged.add(car.id);
      if (i % 2 === 0 && merges.some((m) => car.lane === m.toLane))
        expect(merged.has(car.id)).toBe(true);
      const entered = before && before.lane < 0 ? compiled.movements[-before.lane - 1] : undefined;
      if (entered && merges.includes(entered) && car.lane === entered.toLane) {
        for (const other of current) {
          if (!other || other.id === car.id || other.state !== 'driving' || other.lane !== car.lane)
            continue;
          expect(Math.abs(other.positionM - car.positionM)).toBeGreaterThanOrEqual(6.5 - 1e-8);
        }
      }
      if (car.lane === -exit.idx - 1 && !exited.has(car.id)) {
        expect(before!.lane).toBe(exit.fromLane);
        exited.add(car.id);
      }
      if (
        i % 2 === 1 &&
        before?.state === 'driving' &&
        before.lane >= 0 &&
        compiled.lanes[before.lane]!.out.some((m) => compiled.movements[m]!.turn === 'merge')
      ) {
        const acceleration = (car.speedMps - before.speedMps) / 0.1;
        if (acceleration < -0.1) braking++;
        expect(acceleration).toBeGreaterThanOrEqual(-DEFAULT_SIM_PARAMS.mobil.safeDecelMps2 - 1e-8);
      }
    }
    previous = current;
  }
  expect(braking).toBeGreaterThan(0);
  expect(merged.size).toBe(24);
  expect(exited.size).toBe(48);
  expect(engine.metrics().trips.completed).toBe(48);
  expect(engine.metrics().trips.failed).toBe(0);
});

test.each(['right', 'left'] as const)(
  'T07 a dropped lane changes before the drop (%s traffic)',
  (side) => {
    const { city, node, road, place } = buildCity('Lane drop', 1);
    city.drivingSide = side;
    const join = node(200, 0);
    const approach = road(node(0, 0), join, { lanes: 3 });
    const after = road(join, node(400, 0), { lanes: 2 });
    const dropped = side === 'right' ? 2 : 0;
    place('Start', 'residential', { x: 0, y: 0 }, [
      { road: approach, lane: dropped, direction: 'out' },
    ]);
    place('End', 'work', { x: 400, y: 0 }, [{ road: after, direction: 'in', positionM: 150 }]);
    const compiled = setup(city);
    const engine = createEngine();
    engine.load({ compiled, scenario: scenario(), trips: trips(city, 4, 3) });
    const passed = new Set<number>();
    for (let step = 0; step < 1500; step++) {
      engine.step();
      const snapshot = engine.snapshot();
      for (const [i, id] of snapshot.id.entries()) {
        const field = snapshot.lane[i]!;
        if (field >= 0) continue;
        const movement = compiled.movements[-field - 1]!;
        expect(compiled.lanes[movement.fromLane]!.lane).not.toBe(dropped);
        passed.add(id);
      }
    }
    expect(passed.size).toBe(4);
    expect(engine.metrics().trips.completed).toBe(4);
  },
);

test('T07 merge rejects unsafe target gaps and cooperates only within the braking bound', () => {
  const compiled = setup(ramp());
  const merge = compiled.movements.find(
    (m) =>
      m.turn === 'merge' && compiled.roads[compiled.lanes[m.fromLane]!.road]!.roadClass === 'ramp',
  )!;
  const main = compiled.movements.find((m) => m.toLane === merge.toLane && m.idx !== merge.idx)!;
  const vehicles = createVehicles(3, compiled.lanes.length, compiled.movements.length);
  vehicles.state.fill(DRIVING);
  vehicles.speedFactor.fill(1);
  vehicles.insert(0, merge.fromLane, compiled.lanes[merge.fromLane]!.lengthM - 10);
  vehicles.movement[0] = merge.idx;
  vehicles.speed[0] = 10;
  vehicles.insert(1, main.fromLane, compiled.lanes[main.fromLane]!.lengthM - 10);
  vehicles.movement[1] = main.idx;
  vehicles.speed[1] = 20;
  const merges = createMerges(compiled, vehicles, DEFAULT_SIM_PARAMS);
  expect(merges.canEnter(0, merge)).toBe(false);
  expect(merges.canEnter(1, main)).toBe(true);
  vehicles.position[1] = compiled.lanes[main.fromLane]!.lengthM - 60;
  vehicles.speed[1] = 15;
  expect(merges.canEnter(0, merge)).toBe(true);
  expect(merges.canEnter(1, main)).toBe(false);
  const acceleration = merges.stopAcceleration(1, main);
  expect(acceleration).toBeLessThan(0);
  expect(acceleration).toBeGreaterThanOrEqual(-DEFAULT_SIM_PARAMS.mobil.safeDecelMps2);
  // A closed ramp must not prevent the mainline from using its green phase.
  merge.neverGreen = true;
  expect(merges.canEnter(1, main)).toBe(true);
  merge.neverGreen = false;
  compiled.nodes[main.node]!.signal = {
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    cycleS: 24,
    phases: [{ durationS: 20, movements: [main.idx] }],
  };
  expect(merges.canEnter(1, main)).toBe(true);
  vehicles.insert(2, merge.toLane, 8);
  vehicles.speed[2] = 0;
  expect(merges.canEnter(0, merge)).toBe(false);
});

test('T07 a blocked exit waits before the diverge and can change at the stop line when a gap opens', () => {
  const compiled = setup(ramp());
  const exit = compiled.movements.find(
    (m) =>
      m.turn === 'diverge' && compiled.roads[compiled.lanes[m.toLane]!.road]!.roadClass === 'ramp',
  )!;
  const curb = compiled.lanes[exit.fromLane]!;
  const source = compiled.lanes[curb.left]!;
  const vehicles = createVehicles(2, compiled.lanes.length, compiled.movements.length);
  vehicles.state.fill(DRIVING);
  vehicles.speedFactor.fill(1);
  vehicles.insert(0, source.idx, source.lengthM - DEFAULT_SIM_PARAMS.idm.minGapM);
  vehicles.insert(1, curb.idx, vehicles.position[0]!);
  vehicles.destination[0] = compiled.connectors.find((c) => c.lane === exit.toLane)!.idx;
  vehicles.route[0] = {
    roads: [source.road, compiled.lanes[exit.toLane]!.road],
    movements: [exit.idx],
    targetLanes: [[curb.idx], [exit.toLane]],
    costS: 0,
  };
  const changes = createLaneChanges(compiled, vehicles, DEFAULT_SIM_PARAMS);
  changes.propose(0, source, 0, true);
  expect(changes.holding[0]).toBe(1);
  vehicles.remove(1);
  changes.propose(0, source, 1, true);
  let target = -1;
  changes.resolve(1, (_, lane) => {
    target = lane;
  });
  expect(target).toBe(curb.idx);
});
