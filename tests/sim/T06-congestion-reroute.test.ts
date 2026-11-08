import { expect, test } from 'vitest';
import { bypass } from '../../src/fixtures/bypass';
import { buildCity } from '../../src/fixtures/build-city';
import { allocateId } from '../../src/schema';
import { createRouteProvider, freeFlowLinkCosts, type LinkCosts } from '../../src/routing';
import { createCostCache, remainingRouteCost } from '../../src/routing/costs';
import { createGraphCache } from '../../src/routing/graph';
import { createEngine } from '../../src/sim/engine';
import { createLinkCosts } from '../../src/sim/link-costs';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createRerouter, vehicleRouteRequest } from '../../src/sim/reroute';
import { createVehicles, DRIVING, QUEUED_DESTINATION } from '../../src/sim/vehicle';
import { scenario, setup, trips } from './fixtures';

test('T06 exit samples update a versioned EWMA and unobserved roads decay', () => {
  const compiled = setup(bypass());
  const observed = createLinkCosts(compiled, DEFAULT_SIM_PARAMS, 100);
  const freeFlow = observed.costs.roadTravelTimeS[0]!;
  observed.update(159.9);
  expect(observed.costs.version).toBe(0);
  observed.record(0, freeFlow * 3, compiled.roads[0]!.lengthM);
  observed.record(0, freeFlow * 5, compiled.roads[0]!.lengthM);
  observed.update(160);
  expect(observed.costs.version).toBe(1);
  expect(observed.costs.roadTravelTimeS[0]).toBeCloseTo(freeFlow * 1.9);
  observed.update(220);
  expect(observed.costs.roadTravelTimeS[0]).toBeCloseTo(freeFlow * 1.63);
  observed.record(0, freeFlow, compiled.roads[0]!.lengthM / 2);
  observed.update(280);
  expect(observed.costs.roadTravelTimeS[0]).toBeCloseTo(freeFlow * (1.63 * 0.7 + 2 * 0.3));
});

test('T06 a standing signal queue contributes no observation until it leaves the road', () => {
  const { city, node, road, place } = buildCity('Signal observation', 1);
  const junction = node(200, 0);
  const incoming = road(node(0, 0), junction);
  const outgoing = road(junction, node(400, 0));
  junction.control = 'signal';
  junction.signal = {
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [
      { durationS: 120, groups: [] },
      { durationS: 120, groups: [{ from: incoming.id, to: outgoing.id }] },
    ],
  };
  place('Home', 'residential', { x: 5, y: 5 }, [{ road: incoming, direction: 'out' }]);
  place('Work', 'work', { x: 380, y: 5 }, [{ road: outgoing, direction: 'in', positionM: 150 }]);
  const compiled = setup(city);
  const engine = createEngine();
  const provider = createRouteProvider();
  let costs: LinkCosts | undefined;
  engine.load({
    compiled,
    trips: trips(city, 1).map((trip) => ({ ...trip, departS: 0 })),
    scenario: { ...scenario(), startS: 0 },
    routeProvider: {
      route(network, observed, request) {
        costs = observed;
        expect(request.noise).toBe(0.1);
        return provider.route(network, observed, request);
      },
    },
  });
  const roadIndex = compiled.index.road.get(incoming.id)!;
  const freeFlow = freeFlowLinkCosts(compiled).roadTravelTimeS[roadIndex]!;
  engine.step(1200);
  expect(engine.inspect(1)!.speedMps).toBeLessThan(0.1);
  expect(costs!.roadTravelTimeS[roadIndex]).toBe(freeFlow);
  engine.step(600);
  expect(costs!.roadTravelTimeS[roadIndex]).toBeGreaterThan(freeFlow);
});

test('T06 cost versions refresh weights while preserving the road graph', () => {
  const compiled = setup(bypass());
  const costs = freeFlowLinkCosts(compiled);
  const graphFor = createGraphCache();
  const costsFor = createCostCache();
  const graph = graphFor(compiled, 'car');
  const weights = costsFor(costs);
  expect(costsFor(costs)).toBe(weights);
  costs.roadTravelTimeS[0] = 100;
  costs.version++;
  expect(costsFor(costs)).not.toBe(weights);
  expect(costsFor(costs).roadTravelTimeS[0]).toBe(100);
  expect(graphFor(compiled, 'car')).toBe(graph);
  costs.roadTravelTimeS.set(freeFlowLinkCosts(compiled).roadTravelTimeS);
  costs.version++;
  const provider = createRouteProvider();
  const request = {
    fromLane: compiled.connectors[0]!.lane,
    fromPosM: 5,
    toConnector: 1,
    vehicleClass: 'car' as const,
    desiredSpeedFactor: 1,
    noise: 0,
    seed: 1,
  };
  const first = provider.route(compiled, costs, request);
  const motorway = compiled.roads.find((road) => road.roadClass === 'motorway')!.idx;
  expect(first.ok && first.route.roads.includes(motorway)).toBe(true);
  costs.roadTravelTimeS[motorway] = 1000;
  costs.version++;
  const second = provider.route(compiled, costs, request);
  expect(second.ok && second.route.roads.includes(motorway)).toBe(false);
});

test('T06 staggered checks respect node clearance, hysteresis and the per-trip cap', () => {
  const compiled = setup(bypass());
  const params = DEFAULT_SIM_PARAMS;
  const vehicles = createVehicles(2, compiled.lanes.length, compiled.movements.length);
  const costs = freeFlowLinkCosts(compiled);
  const provider = createRouteProvider();
  const motorway = compiled.roads.find((road) => road.roadClass === 'motorway')!.idx;
  const local = compiled.roads.find((road) => road.lengthM > 1000 && road.idx !== motorway)!.idx;
  const origin = compiled.connectors[0]!;
  const lane = compiled.lanes[origin.lane]!;
  const policy = createRerouter(compiled, vehicles, params, provider, costs);
  for (let id = 0; id < 2; id++) {
    vehicles.state[id] = DRIVING;
    vehicles.lane[id] = origin.lane;
    vehicles.position[id] = 5;
    vehicles.destination[id] = 1;
    vehicles.speedFactor[id] = 1;
    const result = provider.route(
      compiled,
      costs,
      vehicleRouteRequest(vehicles, params, id, origin.lane, 5),
    );
    if (!result.ok) throw new Error(result.reason);
    vehicles.route[id] = result.route;
    policy.start(id, 0);
  }
  const times: number[][] = [[], []];
  const changes: boolean[][] = [[], []];
  // A cheaper candidate inside the 15% margin must not replace the incumbent.
  costs.roadTravelTimeS[motorway] = 100;
  costs.version++;
  const request = vehicleRouteRequest(vehicles, params, 0, origin.lane, 5);
  const candidate = provider.route(compiled, costs, request);
  if (!candidate.ok) throw new Error(candidate.reason);
  const incumbent = remainingRouteCost(compiled, costs, request, vehicles.route[0]!, 0);
  expect(candidate.route.roads.includes(local)).toBe(true);
  expect(candidate.route.costS).toBeLessThan(incumbent);
  expect(candidate.route.costS).toBeGreaterThanOrEqual((1 - params.rerouteHysteresis) * incumbent);
  policy.update(120, (id) => times[id]!.push(120));
  expect(times).toEqual([[], []]);
  costs.roadTravelTimeS[motorway] = 1000;
  costs.version++;
  vehicles.position[0] = lane.lengthM - params.intersection.decisionDistanceM;
  vehicles.state[1] = QUEUED_DESTINATION;
  policy.update(240, (id) => times[id]!.push(240));
  expect(times).toEqual([[], []]);
  vehicles.position[0] = 5;
  vehicles.state[1] = DRIVING;
  for (let timeS = 241; timeS <= 1500; timeS++) {
    if (timeS % 240 === 0) {
      const favorMotorway = timeS % 480 === 0;
      costs.roadTravelTimeS[motorway] = favorMotorway ? 1 : 1000;
      costs.roadTravelTimeS[local] = favorMotorway ? 1000 : 1;
      costs.version++;
    }
    policy.update(timeS, (id) => {
      times[id]!.push(timeS);
      changes[id]!.push(vehicles.route[id]!.roads.includes(motorway));
    });
  }
  expect(changes).toEqual([
    [false, true, false],
    [false, true, false],
  ]);
  expect(times[0]![0]).not.toBe(times[1]![0]);
  for (const checks of times) {
    expect(checks).toHaveLength(params.maxReplans);
    expect(checks[1]! - checks[0]!).toBeGreaterThanOrEqual(params.rerouteIntervalS);
    expect(checks[2]! - checks[1]!).toBeGreaterThanOrEqual(params.rerouteIntervalS);
  }
});

test('T06 bypass blockage, recovery and rerouting are deterministic and bounded', () => {
  const city = bypass();
  const [home, office] = Object.values(city.places);
  const origin = city.roads[home!.connectors[0]!.roadId]!;
  // Keep cars upstream of the fork long enough to encounter a staggered routing check.
  city.nodes[origin.from]!.pos.x = -1500;
  origin.centerline[0]!.x = -1500;

  const exit = Object.values(city.roads)
    .filter((road) => road.roadClass === 'ramp')
    .at(-1)!;

  const blockerId = allocateId(city, 'p');
  city.places[blockerId] = {
    ...office!,
    id: blockerId,
    name: 'Blocked exit',
    capacity: 0,
    connectors: [
      {
        id: allocateId(city, 'c'),
        roadId: exit.id,
        lane: 0,
        positionM: 50,
        direction: 'in',
        throughputPerMin: 30,
      },
    ],
  };
  const requests = trips(city, 600, 3);
  requests[0]!.destinationPlaceId = blockerId;
  const compiled = setup(city);
  const blocker = compiled.places[compiled.index.place.get(blockerId)!]!;
  const motorway = compiled.roads.find((road) => road.roadClass === 'motorway')!.idx;
  const first = createEngine();
  const twin = createEngine();
  const input = { compiled, scenario: scenario(), trips: requests };
  first.load(input);
  twin.load(input);
  const previous = new Map<number, boolean>();
  const switched = new Set<number>();
  const diverted = new Set<number>();
  const switches = new Map<number, number>();
  const eligible = new Map<number, Set<number>>();
  const returned = new Map<number, Set<number>>();
  let beforeRelease = 0;
  for (let tick = 0; tick < 42000; tick++) {
    if (tick === 12000) blocker.capacity = null;
    first.step();
    twin.step();
    expect(twin.stateHash()).toBe(first.stateHash());
    const interval = Math.floor((first.timeS - 1300) / DEFAULT_SIM_PARAMS.rerouteIntervalS);
    const snapshot = first.snapshot();
    for (const id of snapshot.id) {
      const detail = first.inspect(id)!;
      const usesMotorway = detail.route!.roads.includes(motorway);
      if (
        detail.state === 'driving' &&
        detail.lane >= 0 &&
        compiled.lanes[detail.lane]!.lengthM - detail.positionM > 15
      ) {
        if (!eligible.has(interval)) eligible.set(interval, new Set());
        eligible.get(interval)!.add(id);
      }
      if (
        previous.has(id) &&
        previous.get(id) !== usesMotorway &&
        detail.routeReason === 'congestion'
      ) {
        switched.add(id);
        if (!usesMotorway) diverted.add(id);
        switches.set(id, (switches.get(id) ?? 0) + 1);
        if (tick < 12000) beforeRelease++;
        if (usesMotorway && interval >= 0) {
          if (!returned.has(interval)) returned.set(interval, new Set());
          returned.get(interval)!.add(id);
        }
      }
      previous.set(id, usesMotorway);
    }
  }
  const shares = [...returned].map(([interval, ids]) => ids.size / eligible.get(interval)!.size);
  console.log({
    rerouted: switched.size,
    total: requests.length,
    divertedToLocal: diverted.size,
    beforeRelease,
    maxReturnShare: Math.max(0, ...shares),
    switches: Math.max(0, ...switches.values()),
    metrics: first.metrics().trips,
  });
  expect(diverted.size).toBeGreaterThan(0);
  expect(Math.max(0, ...shares)).toBeLessThanOrEqual(0.3);
  expect(Math.max(...switches.values())).toBe(1);
  expect(first.metrics().trips.completed).toBe(requests.length);
  expect(first.metrics().trips.failed).toBe(0);
});
