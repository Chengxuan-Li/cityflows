import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { town } from '../../src/fixtures/town';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { createEngine } from '../../src/sim/engine';
import { setup } from './fixtures';
import { buildCity } from '../../src/fixtures/build-city';
import type { VehicleClass } from '../../src/schema';
import { scenario, trips } from './fixtures';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { createLaneChanges } from '../../src/sim/lane-change';
import { opposing, movementTrips } from './zone-fixtures';
import { sampleConflictZones } from './conflict-zone-safety';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { vehicleClasses } from '../../src/schema';

const allCars = { car: 1, van: 0, truck: 0, bus: 0 };
// TASK-116: re-pinned after feasible lane targets enabled queue passing for every car. Lead,
// TASK-112: access walks shift departure/traffic timing; person legs also enter the hash.
// TASK-125: claim arrays enter the parking hash; completions and travel times are unchanged.
const before = {
  grid5x5: {
    completed: 28,
    meanTravelTimeS: 87.4571428571427,
    meanDelayS: 27.280803928948625,
    hash: 1210534642,
    trips: 56,
  },
  town: {
    // Phase 3's downstream lane choice saves 0.5 vehicle-seconds across the same 207 trips.
    completed: 207,
    meanTravelTimeS: 139.12512077294687,
    meanDelayS: 46.17046404032686,
    hash: 3659696175,
    trips: 414,
  },
};

test.each([
  ['grid5x5', grid5x5],
  ['town', town],
] as const)(
  'T46 cars-only %s matches legacy trips on this tree and pins completion, times and state',
  (name, fixture) => {
    const city = fixture(19);
    const scenario = defaultScenario(name, 19);
    scenario.endS = 9.5 * 3600;
    scenario.demand.personsPerResident = 0.03;
    Object.assign(scenario.demand, { classShares: { local: allCars, through: allCars } });
    // The legacy trips all drive: TASK-113's mode choice off.
    scenario.demand.modeChoice = { enabled: false };
    const requests = scheduleTrips(city, generatePopulation(city, scenario.demand), scenario);
    const engine = createEngine();
    engine.load({ compiled: setup(city), scenario, trips: requests });
    engine.step(Math.round((scenario.endS - scenario.startS) / 0.1));
    const metrics = engine.metrics();
    const observed = {
      completed: metrics.trips.completed,
      meanTravelTimeS: metrics.meanTravelTimeS,
      meanDelayS: metrics.meanDelayS,
      hash: engine.stateHash(),
      trips: requests.length,
    };
    const legacy = createEngine();
    legacy.load({
      compiled: setup(city),
      scenario,
      trips: requests.map((trip) => {
        // Exercise runtime defaults for legacy trips that predate the required class fields.
        return { ...trip, vehicleClass: undefined, purpose: undefined } as unknown as typeof trip;
      }),
    });
    legacy.step(Math.round((scenario.endS - scenario.startS) / 0.1));
    expect(legacy.metrics()).toEqual(metrics);
    expect(legacy.stateHash()).toBe(observed.hash);
    expect(observed).toEqual(before[name]);
  },
  30000,
);

function straight(lengthM = 250, lanes = 1) {
  const build = buildCity('Vehicle classes', 1);
  const road = build.road(build.node(0, 0), build.node(lengthM, 0), { lanes, speedKmh: 130 });
  for (const lane of road.lanes) lane.allowed = ['car', 'van', 'truck', 'bus'];
  build.place('Origin', 'residential', { x: 5, y: 10 }, [{ road, direction: 'out' }]);
  build.place('Destination', 'work', { x: lengthM - 5, y: 10 }, [
    { road, direction: 'in', positionM: lengthM - 20 },
  ]);
  const [origin, destination] = Object.values(build.city.places);
  origin!.connectors[0]!.throughputPerMin = 600;
  return { ...build, road, addRoad: build.road, origin: origin!, destination: destination! };
}

function requests(city: ReturnType<typeof straight>['city'], classes: VehicleClass[]) {
  return trips(city, classes.length, 1).map((trip, i) => ({
    ...trip,
    vehicleClass: classes[i]!,
    purpose: 'private' as const,
  }));
}

test('T46 a car stops behind the real rear of a truck', () => {
  const { city, destination } = straight();
  destination.capacity = 0;
  const engine = createEngine();
  engine.load({
    compiled: setup(city),
    scenario: scenario(),
    trips: requests(city, ['truck', 'car']),
    params: { gridlock: { respawnS: 10000, fadeS: 5, maxRespawns: 3 } },
  });
  engine.step(2000);
  const truck = engine.inspect(1)!;
  const car = engine.inspect(2)!;
  expect(truck.speedMps).toBeLessThan(0.1);
  expect(car.speedMps).toBeLessThan(0.1);
  expect(truck.positionM - car.positionM).toBeCloseTo(14, 1);
  expect(truck.vehicleClass).toBe('truck');
  expect(Array.from(engine.snapshot().vclass)).toEqual([2, 0]);
});

test('T46 a truck cruises at 80 km/h on a 130 km/h road', () => {
  const { city } = straight(10000);
  const engine = createEngine();
  engine.load({
    compiled: setup(city),
    scenario: scenario(),
    trips: requests(city, ['truck']),
    params: { idm: { ...DEFAULT_SIM_PARAMS.idm, desiredSpeedSd: 0 } },
  });
  engine.step(2000);
  expect(engine.inspect(1)!.speedMps * 3.6).toBeCloseTo(80, 3);
});

test('T46 a lane stores fewer queued trucks than cars', () => {
  function queue(vehicleClass: VehicleClass) {
    const { city, destination } = straight(150);
    destination.capacity = 0;
    const engine = createEngine();
    engine.load({
      compiled: setup(city),
      scenario: scenario(),
      trips: requests(city, Array<VehicleClass>(40).fill(vehicleClass)),
      params: { gridlock: { respawnS: 10000, fadeS: 5, maxRespawns: 3 } },
    });
    engine.step(3000);
    return engine.snapshot().count;
  }
  expect(queue('truck')).toBeLessThan(queue('car'));
});

test.each(['van', 'truck'] as const)(
  'T46 %s cannot change into a forbidden lane',
  (vehicleClass) => {
    const { city, road } = straight(500, 2);
    road.lanes[0]!.allowed = ['car'];
    const compiled = setup(city);
    const [left, right] = compiled.roads[0]!.lanes;
    const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
    vehicles.vclass[0] = vehicleClass === 'van' ? 1 : 2;
    vehicles.state[0] = DRIVING;
    vehicles.speedFactor[0] = 1;
    vehicles.destination[0] = compiled.connectors.findIndex((c) => c.direction === 'in');
    vehicles.route[0] = { roads: [0], movements: [], targetLanes: [[left!]], costS: 1 };
    vehicles.insert(0, right!, 450);
    const changes = createLaneChanges(compiled, vehicles, DEFAULT_SIM_PARAMS);
    changes.propose(0, compiled.lanes[right!]!, 0, true);
    let changed = false;
    changes.resolve(0, () => {
      changed = true;
    });
    expect(changed).toBe(false);
  },
);

test('T46 a truck rear occupies a conflicting zone until its actual length has cleared', () => {
  const { left, through, vehicles, intersections } = opposing();
  const zoneIndex = through.conflicts.indexOf(left.idx);
  const [start, end] = left.conflictZones[left.conflicts.indexOf(through.idx)]!;
  vehicles.vclass[0] = 2;
  vehicles.remove(0);
  vehicles.insert(0, -left.idx - 1, end + 6);
  expect(vehicles.position[0]!).toBeGreaterThan(start);
  expect(intersections.zoneStop(through, 0)).toBe(through.conflictZones[zoneIndex]![0]);
  vehicles.position[0] = end + 12;
  expect(intersections.zoneStop(through, 0)).toBe(Infinity);
  vehicles.remove(0);
  vehicles.insert(0, left.toLane, Math.max(0, end + 6 - left.lengthM));
  intersections.exitedFrom[0] = left.idx;
  // A zone reaching the end of the movement also protects an exited truck's rear.
  left.conflictZones[left.conflicts.indexOf(through.idx)]![1] = left.lengthM;
  vehicles.position[0] = 6;
  expect(intersections.zoneStop(through, 0)).toBe(through.conflictZones[zoneIndex]![0]);
  vehicles.position[0] = 12;
  expect(intersections.zoneStop(through, 0)).toBe(Infinity);
});

test('T46 mixed classes traverse a signal with no contacting conflict-zone overlap', () => {
  const city = signalApproach();
  const requests = movementTrips(city).map((trip, id) => ({
    ...trip,
    vehicleClass: vehicleClasses[id % 4]!,
  }));
  const compiled = setup(city);
  const engine = createEngine();
  engine.load({ compiled, trips: requests, scenario: { ...scenario(), endS: 900 } });
  let contacts = 0;
  for (let step = 0; step < 8000; step++) {
    engine.step();
    contacts += sampleConflictZones(engine, compiled);
  }
  expect(contacts).toBeGreaterThan(0);
  expect(engine.metrics().trips.completed).toBe(requests.length);
  expect(engine.metrics().failedByReason.gridlocked).toBe(0);
  expect(Object.values(engine.metrics().completedByClass)).toEqual([
    requests.length / 4,
    requests.length / 4,
    requests.length / 4,
    requests.length / 4,
  ]);
});

test('T46 a live lane permission change invalidates the next movement for that class', () => {
  const build = straight(200);
  const onward = build.addRoad(build.city.nodes[build.road.to]!, build.node(400, 0));
  build.destination.connectors[0]!.roadId = onward.id;
  const engine = createEngine();
  engine.load({
    compiled: setup(build.city),
    scenario: scenario(),
    trips: requests(build.city, ['truck']),
  });
  engine.step(50);
  expect(engine.inspect(1)!.state).toBe('driving');
  onward.lanes[0]!.allowed = ['car'];
  build.city.version++;
  engine.patch(setup(build.city));
  engine.step();
  expect(engine.inspect(1)).toMatchObject({
    state: 'failed',
    failReason: 'destination_unreachable',
  });
});
