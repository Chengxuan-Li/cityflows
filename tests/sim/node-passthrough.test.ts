import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createEngine } from '../../src/sim/engine';
import { createIntersections } from '../../src/sim/intersection';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles } from '../../src/sim/vehicle';
import { scenario, setup, trips } from './fixtures';

function corridor(split: boolean, branch = false) {
  const { city, node, road, place } = buildCity('Continuation', 1);
  const nodes = (split ? [0, 100, 200, 300] : [0, 300]).map((x) => node(x, 0));
  const roads = nodes.slice(1).map((end, i) => road(nodes[i]!, end));
  if (branch) road(nodes[1]!, node(100, 100));
  place('Origin', 'residential', { x: 10, y: 10 }, [
    { road: roads[0]!, direction: 'out', positionM: 5 },
  ]);
  place('Destination', 'work', { x: 290, y: 10 }, [
    { road: roads.at(-1)!, direction: 'in', positionM: split ? 80 : 280 },
  ]);
  return city;
}

function run(split: boolean, branch: boolean, count: number) {
  const city = corridor(split, branch);
  const compiled = setup(city);
  // Compare the same world-space destination as the unsplit road (x = 282.5 m).
  for (const connector of compiled.connectors) {
    if (connector.direction === 'out') continue;
    connector.positionM = 282.5 - compiled.lanes[connector.lane]!.polyline[0]!.x;
  }
  expect(compiled.movements.every((movement) => movement.conflicts.length === 0)).toBe(true);
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: scenario(),
    trips: trips(city, count),
    params: { idm: { ...DEFAULT_SIM_PARAMS.idm, desiredSpeedSd: 0 } },
  });
  engine.step(1500);
  expect(engine.metrics().trips.completed).toBe(count);
  return Array.from({ length: count }, (_, i) => engine.inspect(i + 1)!.arrivedS!);
}

test.each([1, 10])(
  'a %i-car platoon crosses two degree-two nodes within one step of an unsplit road',
  (count) => {
    const unsplit = run(false, false, count);
    const split = run(true, false, count);
    split.forEach((arrival, i) =>
      expect(Math.abs(arrival - unsplit[i]!)).toBeLessThanOrEqual(0.10000001),
    );
  },
);

test.each([1, 10])('a conflict-free one-way T-junction preserves %i-car arrival times', (count) => {
  const unsplit = run(false, false, count);
  const split = run(true, true, count);
  split.forEach((arrival, i) =>
    expect(Math.abs(arrival - unsplit[i]!)).toBeLessThanOrEqual(0.10000001),
  );
});

test('a blocked continuation follows the downstream rear across the node without overlapping', () => {
  const city = corridor(true);
  const compiled = setup(city);
  const target = compiled.places.find((place) => place.connectorsIn.length > 0)!;
  const destination = compiled.connectors[target.connectorsIn[0]!]!;
  destination.positionM = 3;
  target.capacity = 0;
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: scenario(),
    trips: trips(city, 10).map((trip, i) => ({ ...trip, departS: i === 0 ? 100 : 160 + 2 * i })),
  });
  const movement = compiled.movements.find((path) => path.toLane === destination.lane)!;
  const approach = compiled.lanes[movement.fromLane]!;
  for (let step = 0; step < 1500; step++) {
    engine.step();
    const positions: number[] = [];
    for (let id = 1; id <= 10; id++) {
      const vehicle = engine.inspect(id);
      if (!vehicle || vehicle.state === 'queued_origin') continue;
      if (vehicle.lane === approach.idx) positions.push(vehicle.positionM);
      if (vehicle.lane === -movement.idx - 1) positions.push(approach.lengthM + vehicle.positionM);
      if (vehicle.lane === destination.lane)
        positions.push(approach.lengthM + movement.lengthM + vehicle.positionM);
    }
    positions.sort((a, b) => b - a);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i - 1]! - positions[i]!).toBeGreaterThanOrEqual(6.5 - 1e-8);
    }
  }
  expect(engine.inspect(1)?.state).toBe('queued_destination');
  expect(movement.lengthM).toBe(0);
  expect(engine.inspect(2)?.lane).toBe(approach.idx);
  target.capacity = null;
  engine.step(1500);
  expect(engine.metrics().trips.completed).toBe(10);
});

test.each([
  'uncontrolled',
  'stop',
  'yield',
  'signal',
  'merge',
  'conflict',
  'neverGreen',
  'turnOnRed',
] as const)('only an uncontrolled conflict-free movement bypasses reservations (%s)', (kind) => {
  const compiled = setup(corridor(true));
  const movement = compiled.movements[0]!;
  const node = compiled.nodes[movement.node]!;
  if (kind === 'stop' || kind === 'yield' || kind === 'signal') node.control = kind;
  if (kind === 'merge') movement.turn = 'merge';
  if (kind === 'conflict') movement.conflicts = [1];
  if (kind === 'neverGreen') movement.neverGreen = true;
  if (kind === 'turnOnRed') movement.turnOnRed = true;
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  const intersections = createIntersections(compiled, vehicles, DEFAULT_SIM_PARAMS);
  expect(intersections.continuations[movement.idx]).toBe(kind === 'uncontrolled');
});

test('a connector just beyond a continuation cannot spawn into approaching traffic', () => {
  const city = corridor(true);
  const [origin, destination] = Object.values(city.places);
  const middle = Object.values(city.roads)[1]!;
  city.places['p:900'] = {
    ...origin!,
    id: 'p:900',
    connectors: [
      {
        ...origin!.connectors[0]!,
        id: 'c:901',
        roadId: middle.id,
        positionM: 0.1,
      },
    ],
  };
  const compiled = setup(city);
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: scenario(),
    trips: [
      ...trips(city, 10),
      ...trips(city, 10, 2).map((trip, i) => ({
        ...trip,
        id: `injection:${i}`,
        originPlaceId: 'p:900' as const,
        destinationPlaceId: destination!.id,
        departS: 110 + 2 * i,
      })),
    ],
  });
  for (let step = 0; step < 2000; step++) {
    engine.step();
    const positions: number[] = [];
    for (const id of engine.snapshot().id) {
      const vehicle = engine.inspect(id)!;
      const path =
        vehicle.lane < 0 ? compiled.movements[-vehicle.lane - 1]! : compiled.lanes[vehicle.lane]!;
      positions.push(path.polyline[0]!.x + vehicle.positionM);
    }
    positions.sort((a, b) => b - a);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i - 1]! - positions[i]!).toBeGreaterThanOrEqual(6.5 - 1e-8);
    }
  }
  expect(engine.metrics().trips.completed).toBe(20);
});

test('a conflicting follower can reserve behind a continuing leader', () => {
  const { city, node, road, place } = buildCity('Mixed movements', 1);
  const junction = node(0, 0);
  const west = road(node(-200, 0), junction);
  const north = road(node(0, -200), junction);
  const east = road(junction, node(200, 0));
  const south = road(junction, node(0, 200));
  junction.turnRules = [
    { from: north.id, to: south.id, allowed: false, provenance: { source: 'generated' } },
  ];
  place('Origin', 'residential', { x: -190, y: 10 }, [{ road: west, direction: 'out' }]);
  place('South', 'work', { x: 10, y: 190 }, [{ road: south, direction: 'in', positionM: 180 }]);
  place('East', 'work', { x: 190, y: 10 }, [{ road: east, direction: 'in', positionM: 180 }]);
  place('North', 'residential', { x: 10, y: -100 }, [
    { road: north, direction: 'out', positionM: 100 },
  ]);
  const compiled = setup(city);
  const lane = compiled.lanes[compiled.roads[compiled.index.road.get(west.id)!]!.lanes[0]!]!;
  const right = compiled.movements.find(
    (movement) => movement.fromLane === lane.idx && movement.turn === 'right',
  )!;
  const through = compiled.movements.find(
    (movement) => movement.fromLane === lane.idx && movement.turn === 'through',
  )!;
  expect(right.conflicts).toHaveLength(0);
  expect(through.conflicts.length).toBeGreaterThan(0);
  const requests = trips(city, 2);
  requests[1]!.destinationPlaceId = Object.values(city.places)[2]!.id;
  const arrivals: number[] = [];
  let competingDepartS = Infinity;
  for (const competing of [false, true]) {
    const engine = createEngine();
    engine.load({
      compiled,
      scenario: scenario(),
      trips: competing
        ? [
            ...requests,
            {
              ...requests[1]!,
              id: 'north',
              originPlaceId: Object.values(city.places)[3]!.id,
              departS: competingDepartS,
            },
          ]
        : requests,
      params: {
        idm: { ...DEFAULT_SIM_PARAMS.idm, desiredSpeedSd: 0 },
        intersection: { ...DEFAULT_SIM_PARAMS.intersection, decisionDistanceM: 100 },
      },
    });
    for (let step = 0; step < 1000; step++) {
      engine.step();
      const lead = engine.inspect(1);
      const follower = engine.inspect(2);
      if (
        !competing &&
        competingDepartS === Infinity &&
        lead?.lane === lane.idx &&
        follower?.lane === lane.idx &&
        follower.state === 'driving' &&
        lane.lengthM - follower.positionM < 95
      )
        competingDepartS = engine.timeS + 0.1;
    }
    expect(Number.isFinite(competingDepartS)).toBe(true);
    expect(engine.metrics().trips.completed).toBe(competing ? 3 : 2);
    arrivals.push(engine.inspect(2)!.arrivedS!);
  }
  expect(arrivals[1]).toBe(arrivals[0]);
});
