import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import type { TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { sampleConflictZones } from './conflict-zone-safety';
import { scenario, setup } from './fixtures';

function fixture(bypass: 'open' | 'absent' | 'delivery') {
  const { city, node, road, place } = buildCity('Fallback approach bypass', 1);
  const start = node(0, 0),
    junction = node(100, 0),
    end = node(250, 0);
  const goal = node(250, 60),
    corner = node(0, 150);
  const approach = road(start, junction, { lanes: 2 });
  const escape = road(junction, end),
    exit = road(junction, goal, { roadClass: 'ramp' });
  const final = road(goal, node(250, 200));
  road(end, corner);
  const returning = road(corner, start, { lanes: 2 });
  if (bypass !== 'absent') {
    const far = node(900, 0),
      alternative = road(end, far);
    const top = node(900, -300),
      beforeGoal = node(250, -300);
    road(far, top);
    road(top, beforeGoal);
    road(beforeGoal, goal);
    if (bypass === 'delivery') alternative.access = { car: 'delivery' };
  }
  const provenance = { source: 'authored' } as const;
  start.turnRules = [
    { from: returning.id, to: approach.id, allowed: false, provenance },
    { from: returning.id, to: approach.id, fromLane: 1, toLane: 1, allowed: true, provenance },
  ];
  junction.turnRules = [
    { from: approach.id, to: exit.id, allowed: false, provenance },
    { from: approach.id, to: exit.id, fromLane: 1, toLane: 0, allowed: true, provenance },
    { from: approach.id, to: escape.id, allowed: false, provenance },
    { from: approach.id, to: escape.id, fromLane: 0, toLane: 0, allowed: true, provenance },
  ];
  const initial = setup(city),
    lanes = initial.roads[initial.index.road.get(approach.id)!]!.lanes;
  const stop = Math.min(...lanes.map((l) => initial.lanes[l]!.lengthM)) - 6;
  const trips: TripRequest[] = [];
  for (let i = 0; i < 4; i++) {
    const positionM = stop + 1 - i * 22;
    place(`Queue ${i}`, 'gateway', junction.pos, [
      { road: approach, lane: 1, direction: 'out', positionM },
    ]);
    const origin = Object.values(city.places).at(-1)!;
    place(`Closed ${i}`, 'work', junction.pos, [
      { road: approach, lane: 1, direction: 'in', positionM },
    ]);
    const destination = Object.values(city.places).at(-1)!;
    destination.capacity = 0;
    trips.push({
      id: `queue:${i}`,
      personId: null,
      originPlaceId: origin.id,
      destinationPlaceId: destination.id,
      departS: 100,
      mode: 'car',
      vehicleClass: 'truck',
      purpose: 'private',
      legs: [],
    });
  }
  place('Subject origin', 'gateway', start.pos, [
    { road: approach, lane: 0, direction: 'out', positionM: stop - 15 },
  ]);
  const origin = Object.values(city.places).at(-1)!;
  place('Subject destination', 'gateway', goal.pos, [
    { road: final, direction: 'in', positionM: 100 },
  ]);
  const destination = Object.values(city.places).at(-1)!;
  trips.push({
    id: 'subject',
    personId: null,
    originPlaceId: origin.id,
    destinationPlaceId: destination.id,
    departS: 101,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  });
  const compiled = setup(city);
  for (const lane of lanes) compiled.lanes[lane]!.stopM = stop;
  const request = {
    fromLane: compiled.index.lane.get(`${escape.id}#0`)!,
    fromPosM: 0,
    toConnector: compiled.index.connector.get(destination.connectors[0]!.id)!,
    vehicleClass: 'car' as const,
    purpose: 'private' as const,
    desiredSpeedFactor: 1,
    noise: 0,
    seed: 1,
  };
  return { compiled, trips, request, approach: compiled.index.road.get(approach.id)!, lanes };
}

test('T66: approach-bypass requests retain costs and do not leak through routing caches', () => {
  const f = fixture('open'),
    provider = createRouteProvider(),
    costs = freeFlowLinkCosts(f.compiled);
  const normal = provider.route(f.compiled, costs, f.request);
  if (!normal.ok) throw new Error(normal.reason);
  expect(normal.route.roads).toContain(f.approach);
  for (let i = 0; i < 2; i++) {
    const bypass = provider.route(f.compiled, costs, {
      ...f.request,
      avoidApproachRoad: f.approach,
    });
    if (!bypass.ok) throw new Error(bypass.reason);
    expect(bypass.route.roads).not.toContain(f.approach);
    expect(bypass.route.costS).toBeGreaterThan(normal.route.costS);
    expect(provider.route(f.compiled, costs, f.request)).toEqual(normal);
  }
});

test('T66: bypass search preserves request-specific delivery access after cache lookup', () => {
  const f = fixture('delivery'),
    provider = createRouteProvider(),
    costs = freeFlowLinkCosts(f.compiled);
  const request = { ...f.request, avoidApproachRoad: f.approach };
  for (const purpose of ['delivery', 'private', 'delivery'] as const) {
    const result = provider.route(f.compiled, costs, { ...request, purpose });
    expect(result.ok).toBe(purpose === 'delivery');
    if (result.ok) expect(result.route.roads).not.toContain(f.approach);
  }
  expect(provider.route(f.compiled, costs, f.request).ok).toBe(true);
});

test.each(['open', 'absent', 'delivery'] as const)(
  'T66: ordinary fallback uses a bypass only when one legally exists (%s)',
  (kind) => {
    const f = fixture(kind),
      engine = createEngine(),
      provider = createRouteProvider({ laneChangeDistanceM: 5 });
    let comparisons = 0,
      selected = false,
      fallbackS = NaN;
    engine.load({
      compiled: f.compiled,
      trips: f.trips,
      scenario: scenario(),
      params: {
        spawnMinGapM: 2,
        laneChangeDistanceM: 5,
        maxReplans: 0,
        gridlock: { respawnS: 1e6, fadeS: 5, maxRespawns: 3 },
        vehicleClasses: {
          ...DEFAULT_SIM_PARAMS.vehicleClasses,
          truck: { ...DEFAULT_SIM_PARAMS.vehicleClasses.truck, lengthM: 20 },
        },
      },
      routeProvider: {
        route(net, costs, request) {
          if (request.avoidApproachRoad !== undefined) comparisons++;
          return provider.route(net, costs, request);
        },
      },
    });
    for (let i = 0; i < 6000; i++) {
      engine.step();
      sampleConflictZones(engine, f.compiled);
      const car = engine.inspect(5);
      if (!car || car.state !== 'driving') continue;
      if (car.routeReason === 'missed_turn' && Number.isNaN(fallbackS)) fallbackS = engine.timeS;
      if (
        car.routeReason === 'missed_turn' &&
        car.lane >= 0 &&
        f.compiled.lanes[car.lane]!.road !== f.approach
      )
        selected ||= !car.route!.roads.includes(f.approach);
    }
    expect(comparisons).toBe(1);
    expect(fallbackS).toBeGreaterThan(131);
    expect(fallbackS).toBeLessThan(143);
    expect(selected).toBe(kind === 'open');
    if (kind === 'open')
      expect(engine.inspect(5)).toMatchObject({ state: 'completed', respawns: 0 });
  },
);
