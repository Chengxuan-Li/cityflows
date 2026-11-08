import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import type { Control } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { createIntersections } from '../../src/sim/intersection';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { scenario, setup, trips } from './fixtures';
import { sampleConflictZones } from './conflict-zone-safety';

function cross(control: Control, equalRank = false, leftHand = false, blocked = false) {
  const { city, node, road, place } = buildCity('Crossing traffic', 1);
  const junction = node(0, 0);
  const west = road(node(-100, 0), junction, { roadClass: equalRank ? 'residential' : 'primary' });
  const north = road(node(0, -100), junction);
  const east = road(junction, node(100, 0));
  const south = road(junction, node(0, 100));
  junction.control = control;
  if (!equalRank) junction.minorRoads = [north.id];
  city.drivingSide = leftHand ? 'left' : 'right';
  place('North', 'residential', { x: 10, y: -25 }, [
    { road: north, direction: 'out', positionM: 83 },
  ]);
  place('South', 'work', { x: 10, y: 75 }, [{ road: south, direction: 'in', positionM: 70 }]);
  place('West', 'residential', { x: -50, y: 10 }, [
    { road: west, direction: 'out', positionM: control === 'yield' ? 42 : 83 },
  ]);
  place('East', 'work', { x: 75, y: 10 }, [
    { road: east, direction: 'in', positionM: blocked ? 4 : 70 },
  ]);

  const compiled = setup(city);
  if (blocked) compiled.places[3]!.capacity = 0;
  const northLane = compiled.roads[compiled.index.road.get(north.id)!]!.lanes[0]!;
  const westLane = compiled.roads[compiled.index.road.get(west.id)!]!.lanes[0]!;
  const northRequests = trips(city, 20, 1);
  const [westPlace, eastPlace] = compiled.places.slice(2);
  const westRequests = northRequests.map((trip) => ({
    ...trip,
    id: 'west:' + trip.id,
    originPlaceId: westPlace!.id,
    destinationPlaceId: eastPlace!.id,
  }));
  return { compiled, northLane, westLane, northRequests, westRequests };
}

test.each([
  { equalRank: false, leftHand: false, winner: 'west' },
  { equalRank: true, leftHand: false, winner: 'west' },
  { equalRank: true, leftHand: true, winner: 'north' },
])(
  'arbitrates conflicting approaches under load ($equalRank, $leftHand)',
  ({ equalRank, leftHand, winner }) => {
    const { compiled, northRequests, westRequests } = cross('uncontrolled', equalRank, leftHand);
    const engine = createEngine();
    engine.load({
      compiled,
      scenario: scenario(),
      trips: [...northRequests, ...westRequests],
      params: { idm: { ...DEFAULT_SIM_PARAMS.idm, desiredSpeedSd: 0 } },
    });
    const crossed = new Set<number>();
    for (let i = 0; i < 500; i++) {
      engine.step();
      const view = engine.snapshot();
      sampleConflictZones(engine, compiled);
      for (const [index, id] of view.id.entries()) {
        const field = view.lane[index]!;
        if (field >= 0) continue;
        if (!crossed.size) expect(id <= northRequests.length ? 'north' : 'west').toBe(winner);
        crossed.add(id);
      }
    }
    expect(crossed.size).toBeGreaterThan(5);
  },
);

test('a minor-road vehicle stops for a full step at a stop node', () => {
  const { compiled, northRequests, northLane } = cross('stop');
  const engine = createEngine();
  engine.load({ compiled, scenario: scenario(), trips: northRequests.slice(0, 1) });
  let fullStop = false;
  let crossed = false;
  for (let i = 0; i < 300; i++) {
    const previous = engine.inspect(1);
    engine.step();
    const detail = engine.inspect(1)!;
    if (
      detail.lane === northLane &&
      detail.speedMps === 0 &&
      previous?.positionM === detail.positionM &&
      previous.speedMps === 0
    )
      fullStop = true;
    if (detail.lane < 0) {
      expect(fullStop).toBe(true);
      crossed = true;
      break;
    }
  }
  expect(crossed).toBe(true);
});

test('a yielding vehicle waits for a higher-priority approach outside the entry request zone', () => {
  const { compiled, northRequests, westRequests, northLane, westLane } = cross('yield');
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: scenario(),
    trips: [{ ...northRequests[0]!, departS: 106 }, westRequests[0]!],
  });
  engine.step(60);
  const major = engine.inspect(2)!;
  const distance = compiled.lanes[westLane]!.lengthM - major.positionM;
  expect(distance).toBeGreaterThan(DEFAULT_SIM_PARAMS.intersection.decisionDistanceM);
  expect(distance / major.speedMps).toBeLessThan(DEFAULT_SIM_PARAMS.intersection.gapS);
  let majorCrossed = false;
  let minorCrossed = false;
  for (let i = 0; i < 300; i++) {
    engine.step();
    const west = engine.inspect(2)!;
    const north = engine.inspect(1)!;
    if (west.lane < 0) majorCrossed = true;
    if (!majorCrossed) expect(north.lane).toBe(northLane);
    if (north.lane < 0) {
      expect(majorCrossed).toBe(true);
      if (west.lane < 0) {
        const majorPath = compiled.movements[-west.lane - 1]!;
        const minorPath = -north.lane - 1;
        const end = majorPath.conflictZones[majorPath.conflicts.indexOf(minorPath)]![1];
        expect(west.positionM).toBeGreaterThanOrEqual(
          end + DEFAULT_SIM_PARAMS.vehicleClasses.car.lengthM,
        );
      }
      minorCrossed = true;
      break;
    }
  }
  expect(minorCrossed).toBe(true);
});

test('an occupied exit start prevents a grant until it clears', () => {
  const { compiled, westRequests, westLane } = cross('uncontrolled', false, false, true);
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: scenario(),
    trips: [westRequests[0]!, { ...westRequests[1]!, departS: 120 }],
  });
  engine.step(200);
  expect(engine.inspect(1)?.state).toBe('queued_destination');
  for (let i = 0; i < 200; i++) {
    engine.step();
    expect(engine.inspect(2)?.lane).toBe(westLane);
  }
  compiled.places[3]!.capacity = null;
  engine.step(300);
  expect(engine.metrics().trips.completed).toBe(2);
});

test('a platoon shares one movement through a green', () => {
  const { city, node, road, place } = buildCity('Platoon', 1);
  const junction = node(0, 0);
  const west = road(node(-150, 0), junction, { lanes: 1 });
  const east = road(junction, node(150, 0), { lanes: 1 });
  // A wide crossing street makes the through movement long enough for two cars at once.
  const north = road(node(0, -100), junction, { lanes: 8, roadClass: 'primary' });
  const south = road(junction, node(0, 100), { lanes: 8, roadClass: 'primary' });
  junction.control = 'signal';
  junction.signal = {
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [
      { durationS: 60, groups: [{ from: west.id, to: east.id }] },
      { durationS: 20, groups: [{ from: north.id, to: south.id }] },
    ],
  };
  place('West', 'residential', { x: -120, y: 10 }, [
    { road: west, direction: 'out', positionM: 10 },
  ]);
  place('East', 'work', { x: 120, y: 10 }, [{ road: east, direction: 'in', positionM: 120 }]);
  const compiled = setup(city);
  const engine = createEngine();
  engine.load({ compiled, scenario: scenario(), trips: trips(city, 8, 1) });
  let largestPlatoon = 0;
  for (let i = 0; i < 1200; i++) {
    engine.step();
    const view = engine.snapshot();
    const onMovement = new Map<number, number>();
    for (let index = 0; index < view.count; index++) {
      const field = view.lane[index]!;
      if (field < 0) onMovement.set(field, (onMovement.get(field) ?? 0) + 1);
    }
    largestPlatoon = Math.max(largestPlatoon, ...onMovement.values());
  }
  expect(largestPlatoon).toBeGreaterThanOrEqual(2);
  expect(engine.metrics().trips.completed).toBe(8);
});

test('a nonconflicting lead car does not hide the higher-priority follower', () => {
  const { compiled, westLane, northLane } = cross('yield');
  const west = compiled.lanes[westLane]!;
  const north = compiled.lanes[northLane]!;
  const lead =
    compiled.movements[west.out.find((idx) => compiled.movements[idx]!.turn === 'right')!]!;
  const follow =
    compiled.movements[west.out.find((idx) => compiled.movements[idx]!.turn === 'through')!]!;
  const minor =
    compiled.movements[north.out.find((idx) => compiled.movements[idx]!.turn === 'left')!]!;
  expect(minor.conflicts).toContain(follow.idx);
  expect(minor.conflicts).not.toContain(lead.idx);

  const vehicles = createVehicles(3, compiled.lanes.length, compiled.movements.length);
  for (const [id, path] of [lead, follow, minor].entries()) {
    vehicles.state[id] = DRIVING;
    vehicles.movement[id] = path.idx;
    vehicles.speed[id] = 10;
    vehicles.insert(
      id,
      path.fromLane,
      compiled.lanes[path.fromLane]!.lengthM - (id === 1 ? 20 : 10),
    );
  }
  const junctions = createIntersections(compiled, vehicles, DEFAULT_SIM_PARAMS);
  junctions.request(0, lead);
  junctions.request(2, minor);
  junctions.resolve();
  expect(junctions.grants[0]).toBe(lead.idx);
  expect(junctions.grants[2]).toBe(-1);
});
