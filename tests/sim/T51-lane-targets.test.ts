import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { createEngine } from '../../src/sim/engine';
import { createRerouter } from '../../src/sim/reroute';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { patchChanges, remapRoute } from '../../src/sim/patch';
import { scenario, setup, trips } from './fixtures';

test('T51 an unrestricted car can pass a queue using an earlier legal lane change on the same road chain', () => {
  const { city, node, road, place } = buildCity('Earlier lane change', 1);
  const a = node(0, 0);
  const b = node(100, 0);
  const c = node(200, 0);
  const d = node(300, 0);
  const approach = road(a, b, { lanes: 2 });
  const queued = road(b, c, { lanes: 2 });
  road(c, d, { lanes: 2 });
  const exit = road(d, node(300, 100));
  road(d, node(300, -100));
  place('Origin', 'residential', a.pos, [
    { road: approach, lane: 0, positionM: 80, direction: 'out' },
  ]);
  place('Destination', 'work', exit.centerline.at(-1)!, [
    { road: exit, positionM: 80, direction: 'in' },
  ]);
  place('Blocker origin', 'residential', b.pos, [
    { road: queued, lane: 0, positionM: 40, direction: 'out' },
  ]);
  place('Closed destination', 'work', c.pos, [
    { road: queued, lane: 0, positionM: 50, direction: 'in' },
  ]);
  const [, , blockerOrigin, closed] = Object.values(city.places);
  closed!.capacity = 0;
  const [trip] = trips(city, 1);
  const compiled = setup(city);
  const origin = compiled.connectors.find((c) => c.direction === 'out')!;
  const destination = compiled.connectors.find((c) => c.direction === 'in')!;
  const request = {
    fromLane: origin.lane,
    fromPosM: origin.positionM,
    toConnector: destination.idx,
    vehicleClass: 'car',
    desiredSpeedFactor: 1,
    noise: 0,
    seed: 1,
  } as const;
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(compiled);
  const result = provider.route(compiled, costs, request);
  if (!result.ok) throw new Error(result.reason);
  expect(result.route.targetLanes[1]).toHaveLength(2);
  expect(result.route.targetLanes.at(-1)).toEqual([destination.lane]);
  expect(provider.route(compiled, costs, request)).toEqual(result);
  const engine = createEngine();
  const input = {
    compiled,
    scenario: scenario(),
    trips: [
      { ...trip!, departS: 110 },
      {
        ...trip!,
        id: 'blocker',
        originPlaceId: blockerOrigin!.id,
        destinationPlaceId: closed!.id,
      },
    ],
  };
  engine.load(input);
  let passed = false;
  for (let step = 0; step < 800; step++) {
    engine.step();
    const driver = engine.inspect(1)!;
    if (!passed && driver?.lane === compiled.index.lane.get(`${queued.id}#1`)) {
      expect(driver.positionM).toBeLessThan(50);
      passed = true;
    }
  }
  expect(engine.inspect(2)!.state).toBe('queued_destination');
  expect(passed).toBe(true);
  expect(engine.inspect(1)!.state).toBe('completed');
  const replay = createEngine();
  replay.load(input);
  replay.step(800);
  expect(replay.stateHash()).toBe(engine.stateHash());
});

test.each([0, 1])(
  'T51 direct and lane-search routes expose sets with an exact destination (origin lane %s)',
  (from) => {
    const { city, node, road, place } = buildCity('Feasible sets', 1);
    const join = node(200, 0);
    const approach = road(node(0, 0), join, { lanes: 2 });
    const after = road(join, node(400, 0), { lanes: 2 });
    place('Home', 'residential', { x: 5, y: 10 }, [
      { road: approach, lane: from, direction: 'out' },
    ]);
    place('Work', 'work', { x: 380, y: 10 }, [
      { road: after, lane: 0, direction: 'in', positionM: 150 },
    ]);
    const compiled = setup(city);
    const [origin, destination] = compiled.connectors;
    const request = {
      fromLane: origin!.lane,
      fromPosM: origin!.positionM,
      toConnector: destination!.idx,
      vehicleClass: 'car',
      desiredSpeedFactor: 1,
      noise: 0,
      seed: 1,
    } as const;
    const provider = createRouteProvider();
    const costs = freeFlowLinkCosts(compiled);
    const result = provider.route(compiled, costs, request);
    if (!result.ok) throw new Error(result.reason);
    const route = result.route;
    expect(route.targetLanes[0]).toEqual([
      origin!.lane,
      compiled.lanes[origin!.lane]![from === 0 ? 'right' : 'left'],
    ]);
    expect(route.targetLanes.at(-1)).toEqual([destination!.lane]);
    for (const [step, movement] of route.movements.entries())
      expect(route.targetLanes[step]![0]).toBe(compiled.movements[movement]!.fromLane);
    expect(provider.route(compiled, costs, request)).toEqual(result);

    // An invalidated edit checks the route even when the selected roads stay the same.
    const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
    vehicles.state[0] = DRIVING;
    vehicles.lane[0] = origin!.lane;
    vehicles.position[0] = origin!.positionM;
    vehicles.destination[0] = destination!.idx;
    vehicles.speedFactor[0] = 1;
    vehicles.route[0] = route;
    const rerouter = createRerouter(compiled, vehicles, DEFAULT_SIM_PARAMS, provider, costs);
    rerouter.scheduleEdit(0, 100, true, true);
    let checked = false;
    rerouter.updateEdits(100, (_, failed) => {
      expect(failed).toBe(false);
      checked = true;
    });
    expect(checked).toBe(true);
    expect(vehicles.route[0]!.targetLanes).toEqual(route.targetLanes);

    // Insert a lower-ID road to shift dense indices; remapping keeps every target in order.
    const added = road(node(0, 100), node(200, 100));
    delete city.roads[added.id];
    added.id = 'r:0';
    city.roads[added.id] = added;
    city.version++;
    const patched = setup(city);
    const mapped = remapRoute(route, patchChanges(compiled, patched));
    expect(mapped.targetLanes.map((set) => set.map((i) => patched.lanes[i]!.id))).toEqual(
      route.targetLanes.map((set) => set.map((i) => compiled.lanes[i]!.id)),
    );
    expect(mapped.targetLanes[0]![0]).not.toBe(route.targetLanes[0]![0]);
  },
);
