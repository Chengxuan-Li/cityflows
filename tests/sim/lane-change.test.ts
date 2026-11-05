import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { shortTurnLane } from '../../src/fixtures/short-turn-lane';
import { createRouteProvider } from '../../src/routing';
import { allocateId } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { idmAcceleration } from '../../src/sim/idm';
import { createLaneChanges } from '../../src/sim/lane-change';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { scenario, setup, trips } from './fixtures';

test('a grid vehicle changes lanes before the decision point and takes its planned turn (T02 replay)', () => {
  const city = grid5x5();
  const [origin, destination] = Object.values(city.places);
  const center = Object.values(city.nodes).find(
    (node) => node.pos.x === 240 && node.pos.y === 240,
  )!;
  const south = Object.values(city.nodes).find((node) => node.pos.x === 240 && node.pos.y === 360)!;
  const west = Object.values(city.nodes).find((node) => node.pos.x === 120 && node.pos.y === 240)!;
  const approach = Object.values(city.roads).find(
    (road) => road.from === south.id && road.to === center.id,
  )!;
  const exit = Object.values(city.roads).find(
    (road) => road.from === center.id && road.to === west.id,
  )!;
  origin!.connectors = [{ ...origin!.connectors[0]!, roadId: approach.id, lane: 1 }];
  destination!.connectors = [
    {
      ...destination!.connectors.find((connector) => connector.direction === 'in')!,
      roadId: exit.id,
      lane: 0,
      positionM: 75,
    },
  ];
  const compiled = setup(city);
  const startLane = compiled.index.lane.get(approach.id + '#1')!;
  const turnLane = compiled.index.lane.get(approach.id + '#0')!;
  const input = { compiled, trips: trips(city, 6, 2), scenario: scenario() };
  const engine = createEngine();
  const replay = createEngine();
  engine.load(input);
  replay.load(input);
  let changed = false;
  let animationFinished = false;
  let tookPlannedTurn = false;

  for (let i = 0; i < 1500; i++) {
    const before = engine.inspect(1);
    engine.step();
    replay.step();
    expect(engine.stateHash()).toBe(replay.stateHash());
    const detail = engine.inspect(1)!;
    const snapshot = engine.snapshot();
    const index = snapshot.id.indexOf(1);
    if (before?.lane === startLane && detail.lane === turnLane) {
      changed = true;
      expect(detail.positionM - before.positionM).toBeCloseTo(
        detail.speedMps * DEFAULT_SIM_PARAMS.dtS,
      );
      expect(compiled.lanes[turnLane]!.lengthM - detail.positionM).toBeGreaterThan(
        DEFAULT_SIM_PARAMS.intersection.decisionDistanceM,
      );
      expect(snapshot.lateralM[index]).toBeGreaterThan(0);
      expect(snapshot.lateralM[index]).toBeLessThanOrEqual(compiled.lanes[turnLane]!.widthM);
    }
    if (changed && detail.lane === turnLane && snapshot.lateralM[index] === 0)
      animationFinished = true;
    if (detail.lane < 0 && detail.state === 'driving') {
      expect(-detail.lane - 1).toBe(detail.route!.movements[0]);
      expect(detail.routeReason).toBe('initial');
      tookPlannedTurn = true;
    }
  }
  expect(changed && animationFinished && tookPlannedTurn).toBe(true);
  expect(engine.inspect(1)!.state).toBe('completed');
});

test('a blocked short turn takes a legal fallback and attempts a missed-turn reroute', () => {
  const city = shortTurnLane();
  // Keep a legal return from the missed-turn exit; a cropped sink cannot be a recovery route.
  const straight = Object.values(city.roads).find((r) => r.centerline.at(-1)!.x === 124)!;
  const returnId = allocateId(city, 'r');
  city.roads[returnId] = {
    ...straight,
    id: returnId,
    from: straight.to,
    to: straight.from,
    lanes: [straight.lanes[0]!],
    centerline: [
      straight.centerline.at(-1)!,
      { x: 124, y: 100 },
      { x: 24, y: 100 },
      straight.centerline[0]!,
    ],
  };
  const ramp = Object.values(city.roads).find((r) => r.roadClass === 'ramp')!;
  const exit = Object.values(city.roads).find((r) => r.from === ramp.to)!;
  city.nodes[ramp.to]!.turnRules.push({
    from: ramp.id,
    to: exit.id,
    toLane: 0,
    allowed: false,
    provenance: { source: 'authored' },
  });
  const [origin, destination] = Object.values(city.places);
  const approach = Object.values(city.roads).find(
    (road) => road.centerline[0]!.x === 0 && road.centerline[1]!.x === 24,
  )!;
  const blockerOrigin = allocateId(city, 'p');
  const blockerDestination = allocateId(city, 'p');
  city.places[blockerOrigin] = {
    ...origin!,
    id: blockerOrigin,
    connectors: [
      {
        ...origin!.connectors[0]!,
        id: allocateId(city, 'c'),
        roadId: approach.id,
      },
    ],
  };
  city.places[blockerDestination] = {
    ...destination!,
    id: blockerDestination,
    capacity: 0,
    connectors: [
      {
        ...destination!.connectors[0]!,
        id: allocateId(city, 'c'),
        roadId: approach.id,
        positionM: 8,
      },
    ],
  };
  const compiled = setup(city);
  const [trip] = trips(city, 1);
  // The default router rejects this short approach at load. Use its shorter-distance route
  // to model a driver who reaches the turn lane too late because the gap is occupied.
  const provider = createRouteProvider({ laneChangeDistanceM: 10 });
  const routeOrigins: number[] = [];
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: scenario(),
    trips: [
      { ...trip!, departS: 110 },
      {
        ...trip!,
        id: 'blocker',
        originPlaceId: blockerOrigin,
        destinationPlaceId: blockerDestination,
      },
    ],
    routeProvider: {
      route(network, costs, request) {
        routeOrigins.push(request.fromLane);
        return provider.route(network, costs, request);
      },
    },
  });

  const curb = compiled.index.lane.get(approach.id + '#1')!;
  let fallback = -1;
  let crept = false;
  for (let i = 0; i < 1200; i++) {
    const before = engine.inspect(1);
    engine.step();
    const after = engine.inspect(1);
    if (after?.lane === curb && after.state === 'driving') {
      expect(after.routeReason).toBe('initial');
      if (Math.abs(after.speedMps - DEFAULT_SIM_PARAMS.intersection.creepSpeedMps) < 1e-8) {
        crept = true;
      }
    }
    if (after?.state !== 'driving') continue;
    const movement =
      after.lane < 0
        ? compiled.movements[-after.lane - 1]
        : compiled.movements.find(
            (m) => m.lengthM === 0 && m.fromLane === before?.lane && m.toLane === after.lane,
          );
    if (!movement) continue;
    expect(compiled.lanes[movement.fromLane]!.out).toContain(movement.idx);
    expect(movement.neverGreen).toBe(false);
    expect(compiled.lanes[movement.toLane]!.allowed).toContain('car');
    if (before?.lane !== after.lane) expect(movement.fromLane).toBe(before?.lane);
    if (movement.fromLane === curb) {
      expect(after.routeReason).toBe('missed_turn');
      fallback = movement.idx;
    }
  }
  expect(engine.inspect(2)!.state).toBe('queued_destination');
  expect(crept).toBe(true);
  expect(fallback).toBeGreaterThanOrEqual(0);
  expect(routeOrigins).toContain(compiled.movements[fallback]!.toLane);
});

test('MOBIL resolves competing proposals from 200 vehicles without forcing unsafe braking', () => {
  const { city, node, road, place } = buildCity('Overtaking', 1);
  const mainline = road(node(0, 0), node(4200, 0), { lanes: 3 });
  place('Destination', 'work', { x: 4100, y: 20 }, [
    { road: mainline, lane: 1, positionM: 4100, direction: 'in' },
  ]);
  const compiled = setup(city);
  const vehicles = createVehicles(200, compiled.lanes.length, compiled.movements.length);
  const params = DEFAULT_SIM_PARAMS;
  const laneChanges = createLaneChanges(compiled, vehicles, params);
  for (let i = 0; i < 40; i++) {
    const position = 50 + i * 100;
    for (const [slot, lane, distance, speed] of [
      [0, 0, 0, 8],
      [1, 0, 8, 0],
      [2, 2, 0, 8],
      [3, 2, 8, 0],
      [4, 1, i % 2 === 0 ? -25 : -8, i % 2 === 0 ? 8 : 15],
    ]) {
      const id = 5 * i + slot!;
      vehicles.insert(id, lane!, position + distance!);
      vehicles.speed[id] = speed!;
      vehicles.speedFactor[id] = 1;
      vehicles.state[id] = DRIVING;
      vehicles.destination[id] = 0;
      vehicles.route[id] = { roads: [0], movements: [], targetLanes: [[1]], costS: 0 };
    }
  }
  for (const lane of compiled.lanes) {
    for (let id = vehicles.first(lane.idx); id !== -1; id = vehicles.next[id]!) {
      laneChanges.propose(id, lane, 0, true);
    }
  }
  const accepted = new Set<number>();
  laneChanges.resolve(0, (id, lane, positionM) => {
    vehicles.remove(id);
    vehicles.insert(id, lane, positionM);
    accepted.add(id);
    const follower = vehicles.next[id]!;
    if (follower === -1) return;
    const bumperGap = positionM - vehicles.position[follower]! - params.vehicleLengthM;
    expect(bumperGap).toBeGreaterThanOrEqual(params.idm.minGapM);
    const acceleration = idmAcceleration(
      params.idm,
      vehicles.speed[follower]!,
      compiled.lanes[lane]!.speedLimitMps,
      vehicles.speed[id]!,
      bumperGap,
    );
    expect(acceleration).toBeGreaterThanOrEqual(-params.mobil.safeDecelMps2);
    const clampedSpeed = (bumperGap - params.idm.minGapM) / params.dtS;
    expect(vehicles.speed[follower]! - clampedSpeed).toBeLessThanOrEqual(
      params.mobil.safeDecelMps2 * params.dtS,
    );
  });
  for (let i = 0; i < 40; i++) {
    expect(accepted.has(5 * i)).toBe(i % 2 === 0);
    expect(accepted.has(5 * i + 2)).toBe(false);
  }
});
