import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import type { Road, TripRequest } from '../../src/schema';
import { createRouteProvider, freeFlowLinkCosts, type RouteRequest } from '../../src/routing';
import { simParamsSchema } from '../../src/schema/demand.schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { sampleConflictZones } from './conflict-zone-safety';
import { scenario, setup } from './fixtures';

test('T58 saved scenarios default the head delay and reject a negative delay', () => {
  expect(simParamsSchema.parse({}).headDetourS).toBe(45);
  expect(simParamsSchema.parse({ headDetourS: 12 }).headDetourS).toBe(12);
  expect(simParamsSchema.safeParse({ headDetourS: -1 }).success).toBe(false);
});

function blockedExit(alternative = true, redS = 0) {
  const { city, node, road, place } = buildCity('Head detour', 1);
  const junction = node(100, 0);
  junction.control = 'yield';
  const approach = road(node(0, 0), junction);
  const exit = road(junction, node(250, 0), { lanes: 2 });
  const provenance = { source: 'authored' } as const;
  junction.turnRules = [
    { from: approach.id, to: exit.id, allowed: false, provenance },
    ...[0, ...(alternative ? [1] : [])].map((toLane) => ({
      from: approach.id,
      to: exit.id,
      fromLane: 0,
      toLane,
      allowed: true,
      provenance,
    })),
  ];
  if (redS) {
    junction.control = 'signal';
    junction.signal = {
      offsetS: -100,
      amberS: 0,
      allRedS: 0,
      phases: [
        { durationS: redS, groups: [] },
        { durationS: 500, groups: [{ from: approach.id, to: exit.id }] },
      ],
    };
  }
  const initial = setup(city);
  const stopM = initial.lanes[initial.index.lane.get(`${approach.id}#0`)!]!.stopM;
  place('Blocker origin', 'gateway', junction.pos, [
    { road: exit, direction: 'out', positionM: 4.5 },
  ]);
  place('Closed destination', 'work', junction.pos, [
    { road: exit, direction: 'in', positionM: 4.5 },
  ]);
  const closed = Object.values(city.places).at(-1)!;
  closed.capacity = 0;
  place('Origin', 'gateway', junction.pos, [
    { road: approach, direction: 'out', positionM: stopM - 2 },
  ]);
  place('Destination', 'work', junction.pos, [{ road: exit, direction: 'in', positionM: 120 }]);
  const places = Object.values(city.places);
  const trips: TripRequest[] = [
    [places[0]!.id, places[1]!.id],
    [places[2]!.id, places[3]!.id],
  ].map(([originPlaceId, destinationPlaceId], i) => ({
    id: `trip:${i}`,
    personId: null,
    originPlaceId: originPlaceId!,
    destinationPlaceId: destinationPlaceId!,
    departS: 100,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  }));
  return { city, compiled: setup(city), trips, approach, exit };
}

function load(fixture: ReturnType<typeof blockedExit>, headDetourS = 5) {
  const engine = createEngine();
  engine.load({ ...fixture, scenario: scenario(), params: { headDetourS, maxReplans: 0 } });
  return engine;
}

test('T58 a head detours into a free permitted exit, reroutes and completes without a congestion replan', () => {
  const fixture = blockedExit();
  const engine = load(fixture);
  engine.step(49);
  expect(engine.inspect(2)!.routeReason).toBe('initial');
  engine.step(400);
  expect(engine.inspect(2)).toMatchObject({
    state: 'completed',
    routeReason: 'missed_turn',
    respawns: 0,
  });
});

test('T58 a full automatic continuation can detour through the free landing lane', () => {
  const fixture = blockedExit();
  fixture.approach.lanes.push({ ...fixture.approach.lanes[0]! });
  fixture.city.nodes[fixture.approach.to]!.control = 'uncontrolled';
  fixture.compiled = setup(fixture.city);
  // Put the blocker on the exit before the continuation's upstream spawn protection applies.
  fixture.trips[0]!.departS = 99;
  const engine = createEngine();
  engine.load({
    ...fixture,
    scenario: { ...scenario(), startS: 99 },
    params: { headDetourS: 5, maxReplans: 0 },
  });
  engine.step(500);
  expect(engine.inspect(2)).toMatchObject({
    state: 'completed',
    routeReason: 'missed_turn',
    respawns: 0,
  });
});

test.each(['neverGreen', 'class'] as const)('T58 excludes a %s alternative', (exclusion) => {
  const fixture = blockedExit();
  const lane = fixture.compiled.index.lane.get(`${fixture.exit.id}#1`)!;
  if (exclusion === 'class') fixture.compiled.lanes[lane]!.allowed = ['truck'];
  else fixture.compiled.movements.find((m) => m.toLane === lane)!.neverGreen = true;
  const engine = load(fixture);
  engine.step(500);
  expect(engine.inspect(2)).toMatchObject({
    state: 'driving',
    routeReason: 'initial',
    respawns: 0,
  });
});

test('T58 chooses the free alternative with the lowest remaining route cost', () => {
  const fixture = blockedExit();
  fixture.exit.lanes.push({ ...fixture.exit.lanes[0]! });
  fixture.city.nodes[fixture.approach.to]!.turnRules.push({
    from: fixture.approach.id,
    to: fixture.exit.id,
    fromLane: 0,
    toLane: 2,
    allowed: true,
    provenance: { source: 'authored' },
  });
  fixture.compiled = setup(fixture.city);
  const preferred = fixture.compiled.index.lane.get(`${fixture.exit.id}#2`)!;
  const expensive = fixture.compiled.index.lane.get(`${fixture.exit.id}#1`)!;
  const provider = createRouteProvider();
  const exits: number[] = [];
  const engine = createEngine();
  engine.load({
    ...fixture,
    scenario: scenario(),
    params: { headDetourS: 5, maxReplans: 0 },
    routeProvider: {
      route(network, costs, request) {
        const result = provider.route(network, costs, request);
        if (result.ok && request.fromLane === expensive) result.route.costS += 100;
        return result;
      },
    },
    headDetourObserver(_id, _lane, movement) {
      exits.push(fixture.compiled.movements[movement]!.toLane);
    },
  });
  engine.step(600);
  expect(exits).toEqual([preferred]);
  expect(engine.inspect(2)!.state).toBe('completed');
});

test('T58 a head with no alternative still waits and respawns', () => {
  const engine = load(blockedExit(false));
  engine.step(1790);
  expect(engine.inspect(2)).toMatchObject({
    state: 'driving',
    routeReason: 'initial',
    respawns: 0,
  });
  engine.step(20);
  expect(engine.inspect(2)!.respawns).toBe(1);
});

test('T58 a free but lane-infeasible alternative is never taken', () => {
  const fixture = blockedExit();
  // The destination is too close for a change from exit lane 1 into lane 0.
  Object.values(fixture.city.places)[3]!.connectors[0]!.positionM = 20;
  fixture.compiled = setup(fixture.city);
  const alternate = fixture.compiled.index.lane.get(`${fixture.exit.id}#1`)!;
  const provider = createRouteProvider();
  let checks = 0;
  const engine = createEngine();
  engine.load({
    ...fixture,
    scenario: scenario(),
    params: { headDetourS: 5, maxReplans: 0 },
    routeProvider: {
      route(network, costs, request) {
        if (request.fromLane === alternate) checks++;
        return provider.route(network, costs, request);
      },
    },
  });
  engine.step(120);
  expect(checks).toBe(1);
  engine.step(120);
  expect(checks).toBe(1);
  expect(engine.inspect(2)!.routeReason).toBe('initial');
});

test('T58 failed head searches refresh after a cost change and a live destination edit', () => {
  const fixture = blockedExit();
  const destination = Object.values(fixture.city.places)[3]!;
  destination.connectors[0]!.positionM = 20;
  fixture.compiled = setup(fixture.city);
  const alternate = fixture.compiled.index.lane.get(`${fixture.exit.id}#1`)!;
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(fixture.compiled);
  const requests: RouteRequest[] = [];
  const engine = createEngine();
  engine.load({
    ...fixture,
    scenario: scenario(),
    params: { headDetourS: 5, maxReplans: 0 },
    linkCosts: costs,
    routeProvider: {
      route(network, weights, request) {
        if (request.fromLane === alternate) requests.push(request);
        return provider.route(network, weights, request);
      },
    },
  });
  engine.step(120);
  expect(requests).toHaveLength(1);
  costs.version++;
  engine.step(120);
  expect(requests).toHaveLength(2);
  expect(engine.inspect(2)!.routeReason).toBe('initial');
  destination.connectors[0]!.positionM = 120;
  fixture.city.version++;
  fixture.compiled = setup(fixture.city);
  engine.patch(fixture.compiled);
  engine.step(500);
  expect(requests.length).toBeGreaterThan(2);
  expect(engine.inspect(2)).toMatchObject({ state: 'completed', routeReason: 'missed_turn' });
});

test('T58 red time does not count toward the head detour delay', () => {
  const engine = load(blockedExit(true, 60));
  engine.step(640);
  expect(engine.inspect(2)).toMatchObject({ routeReason: 'initial', respawns: 0 });
  engine.step(400);
  expect(engine.inspect(2)).toMatchObject({ state: 'completed', routeReason: 'missed_turn' });
});

test('T58 a red interval pauses accumulated green waiting time', () => {
  const fixture = blockedExit(true, 60);
  const signal = fixture.city.nodes[fixture.approach.to]!.signal!;
  signal.phases.unshift({
    durationS: 3,
    groups: [{ from: fixture.approach.id, to: fixture.exit.id }],
  });
  fixture.compiled = setup(fixture.city);
  const alternate = fixture.compiled.index.lane.get(`${fixture.exit.id}#1`)!;
  const provider = createRouteProvider();
  const checks: number[] = [];
  const engine = createEngine();
  engine.load({
    ...fixture,
    scenario: scenario(),
    params: { headDetourS: 5, maxReplans: 0 },
    routeProvider: {
      route(network, costs, request) {
        if (request.fromLane === alternate) checks.push(engine.timeS);
        return provider.route(network, costs, request);
      },
    },
  });
  engine.step(640);
  expect(checks).toEqual([]);
  engine.step(11);
  expect(checks).toHaveLength(1);
  expect(checks[0]).toBeCloseTo(164.9);
});

test('T58 a car behind the head never detours', () => {
  const fixture = blockedExit();
  const origin = Object.values(fixture.city.places)[2]!;
  const followerOrigin = structuredClone(origin);
  followerOrigin.id = 'p:1000';
  followerOrigin.connectors[0]!.id = 'c:1001';
  followerOrigin.connectors[0]!.positionM -= 6.6;
  fixture.city.places[followerOrigin.id] = followerOrigin;
  fixture.city.nextId = 1002;
  fixture.compiled = setup(fixture.city);
  fixture.trips.push({ ...fixture.trips[1]!, id: 'follower', originPlaceId: followerOrigin.id });
  const engine = createEngine();
  engine.load({
    ...fixture,
    scenario: scenario(),
    params: { headDetourS: 5, spawnMinGapM: 2, maxReplans: 0 },
  });
  const lane = fixture.compiled.index.lane.get(`${fixture.approach.id}#0`)!;
  let watched = 0;
  for (let i = 0; i < 500; i++) {
    engine.step();
    if (engine.inspect(2)!.lane === lane) {
      expect(engine.inspect(3)!.routeReason).toBe('initial');
      watched++;
    }
  }
  expect(watched).toBeGreaterThan(50);
  expect(engine.inspect(3)!.state).toBe('completed');
});

test('T58 a live patch resets the head detour timer', () => {
  const fixture = blockedExit();
  const engine = load(fixture, 10);
  engine.step(90);
  engine.patch(setup(fixture.city));
  engine.step(90);
  expect(engine.inspect(2)!.routeReason).toBe('initial');
  engine.step(400);
  expect(engine.inspect(2)).toMatchObject({ state: 'completed', routeReason: 'missed_turn' });
});

test('T58 a packed two-lane loop clears through free alternative landing lanes', () => {
  const { city, node, road, place } = buildCity('Two-lane loop', 1);
  const corners = [node(0, 0), node(100, 0), node(100, 100), node(0, 100)];
  const ring = corners.map((corner, i) => road(corner, corners[(i + 1) % 4]!, { lanes: 2 }));
  const exits = corners.map((corner, i) => {
    corner.control = 'yield';
    const exit = road(
      corner,
      node(corner.pos.x + (i === 0 || i === 3 ? -80 : 80), corner.pos.y + (i < 2 ? -80 : 80)),
    );
    place(`Exit ${i}`, 'gateway', corner.pos, [{ road: exit, direction: 'in', positionM: 50 }]);
    const incoming = ring[(i + 3) % 4]!;
    const next = ring[i]!;
    const provenance = { source: 'authored' } as const;
    corner.turnRules.push({ from: incoming.id, to: next.id, allowed: false, provenance });
    for (const [fromLane, toLane] of [
      [0, 0],
      [0, 1],
      [1, 1],
    ])
      corner.turnRules.push({
        from: incoming.id,
        to: next.id,
        fromLane,
        toLane,
        allowed: true,
        provenance,
      });
    for (const fromLane of [0, 1])
      corner.turnRules.push({
        from: incoming.id,
        to: exit.id,
        fromLane,
        toLane: 0,
        allowed: true,
        provenance,
      });
    return Object.values(city.places).at(-1)!;
  });
  const before = setup(city);
  const trips: TripRequest[] = [];
  for (const [i, source] of ring.entries()) {
    const lane = before.lanes[before.index.lane.get(`${source.id}#0`)!]!;
    for (let pos = lane.stopM - 2; pos >= 0; pos -= 6.6) {
      place(`Origin ${trips.length}`, 'gateway', corners[i]!.pos, [
        { road: source, direction: 'out', positionM: pos },
      ]);
      trips.push({
        id: `ring:${trips.length}`,
        personId: null,
        originPlaceId: Object.values(city.places).at(-1)!.id,
        destinationPlaceId: exits[(i + 2) % 4]!.id,
        departS: 100,
        mode: 'car',
        vehicleClass: 'car',
        purpose: 'private',
        legs: [],
      });
    }
  }
  const compiled = setup(city);
  const load = (headDetourS: number) => {
    const engine = createEngine();
    engine.load({
      compiled,
      trips,
      scenario: scenario(),
      params: {
        headDetourS,
        spawnMinGapM: 2,
        maxReplans: 0,
        mobil: { ...DEFAULT_SIM_PARAMS.mobil, thresholdMps2: 1e9 },
      },
    });
    return engine;
  };
  const mainRule = load(1e9);
  const detour = load(5);
  mainRule.step(1700);
  expect(mainRule.metrics().trips.completed).toBe(0);
  expect(Math.max(...mainRule.snapshot().speed)).toBeLessThan(0.1);
  for (let i = 0; i < 1700; i++) {
    detour.step();
    sampleConflictZones(detour, compiled);
  }
  expect(detour.metrics().trips.completed).toBe(trips.length);
  expect(detour.metrics().respawns).toBe(0);
});

test('T58 detours preserve conflict-zone safety and the same-seed state hash', () => {
  const fixture = blockedExit();
  const engines = [load(fixture), load(fixture)];
  for (let i = 0; i < 500; i++) {
    engines.forEach((engine) => engine.step());
    expect(engines[0]!.stateHash()).toBe(engines[1]!.stateHash());
    sampleConflictZones(engines[0]!, fixture.compiled);
  }
  expect(engines[0]!.inspect(2)!.routeReason).toBe('missed_turn');
  expect(DEFAULT_SIM_PARAMS.headDetourS).toBe(45);
});

// TASK-208: Munich's queue heads on r:53 and r:1306, refused into r:700 lane 1 by the jughandle's
// queue in lane 2 beyond it, detoured into r:700 lane 0, whose route needs two changes back into
// that queue on r:698 and r:654; most missed and went round the ring. Here a one-lane approach
// enters both lanes of a short road; only the right lane's continuation reaches the destination
// road, and it is a standing queue (cars waiting for a closed place). The left lane is free but
// its route has to change back into the queue further on: across one lane of the long road when
// it has two (TASK-223 still takes that detour), across two when it has three.
function queueBeyond(longLanes: 2 | 3) {
  const { city, node, road, place } = buildCity('Queue beyond', 1);
  const start = node(0, 0),
    j = node(100, 0),
    k = node(112, 0),
    m = node(212, 0);
  const approach = road(start, j);
  const side = road(node(100, -300), j);
  const short = road(j, k, { lanes: 2 });
  const long = road(k, m, { lanes: longLanes });
  const right = longLanes - 1;
  const onward = road(m, node(400, 0));
  const elsewhere = road(m, node(212, 300));
  const provenance = { source: 'authored' } as const;
  const only = (at: typeof j, from: Road, to: Road, pairs: [number, number][]) => {
    at.turnRules.push({ from: from.id, to: to.id, allowed: false, provenance });
    for (const [fromLane, toLane] of pairs)
      at.turnRules.push({ from: from.id, to: to.id, fromLane, toLane, allowed: true, provenance });
  };
  only(j, approach, short, [
    [0, 0],
    [0, 1],
  ]);
  only(j, side, short, [[0, 1]]);
  only(k, short, long, [
    [0, 0],
    [1, right],
  ]);
  only(m, long, onward, [[right, 0]]);
  only(
    m,
    long,
    elsewhere,
    Array.from({ length: right }, (_, lane): [number, number] => [lane, 0]),
  );
  // Cars from the side road waiting for a closed place on the onward road fill it back across
  // the junction, the long road's right lane, the short road's right lane and the side road.
  place('Closed', 'work', m.pos, [{ road: onward, direction: 'in', positionM: 150 }]);
  Object.values(city.places).at(-1)!.capacity = 0;
  place('Side', 'gateway', node(100, -300).pos, [{ road: side, direction: 'out', positionM: 5 }]);
  place('Origin', 'gateway', start.pos, [{ road: approach, direction: 'out', positionM: 5 }]);
  place('Destination', 'work', m.pos, [{ road: onward, direction: 'in', positionM: 160 }]);
  // From the onward and the other road a car can come back round to the approach.
  const back = node(400, -200);
  road(city.nodes[onward.to]!, back);
  road(city.nodes[elsewhere.to]!, back);
  road(back, start);
  const [closed, sideOrigin, origin, destination] = Object.values(city.places);
  const trip = (i: number, from: string, to: string, departS: number): TripRequest => ({
    id: `trip:${i}`,
    personId: null,
    originPlaceId: from,
    destinationPlaceId: to,
    departS,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  });
  const trips = [
    ...Array.from({ length: 50 }, (_, i) => trip(i, sideOrigin!.id, closed!.id, 100 + 3 * i)),
    trip(50, origin!.id, destination!.id, 300),
  ];
  return { compiled: setup(city), trips, approach, short };
}

function queueHead(longLanes: 2 | 3) {
  const { compiled, trips, approach, short } = queueBeyond(longLanes);
  const left = compiled.index.lane.get(`${short.id}#0`)!;
  const engine = createEngine();
  engine.load({
    compiled,
    trips,
    scenario: scenario(),
    params: {
      headDetourS: 5,
      maxReplans: 0,
      gridlock: { ...DEFAULT_SIM_PARAMS.gridlock, respawnS: Infinity },
    },
  });
  const lanes = new Set<number>();
  for (let step = 0; step < 6000; step++) {
    engine.step();
    lanes.add(engine.inspect(trips.length)?.lane ?? -1);
  }
  const car = engine.inspect(trips.length)!;
  return {
    car,
    onApproach: compiled.lanes[car.lane]!.road === compiled.index.road.get(approach.id),
    tookLeft: lanes.has(left),
  };
}

test('TASK-208 a queue head does not detour into a lane of its next road that leads back into the queue across two lanes', () => {
  // It waits at the head of the approach for the right lane.
  const { car, onApproach, tookLeft } = queueHead(3);
  expect(car).toMatchObject({ state: 'driving', routeReason: 'initial' });
  expect(onApproach).toBe(true);
  expect(tookLeft).toBe(false);
});

test('TASK-223 a queue head still detours into a lane one change away from the queue', () => {
  expect(queueHead(2).tookLeft).toBe(true);
});
