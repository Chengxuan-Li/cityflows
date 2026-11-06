import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { buildCity } from '../../src/fixtures/build-city';
import { bypass } from '../../src/fixtures/bypass';
import { shortTurnLane } from '../../src/fixtures/short-turn-lane';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { importOsm } from '../../src/importers/osm';
import type { CompiledCity } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { createGraphCache } from '../../src/routing/graph';
import { resolveLanes } from '../../src/routing/lanes';
import type { Node, Road, SimParams, TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import type { VehicleDetail } from '../../src/sim/types';
import { routingFixture } from '../routing/fixtures';
import { scenario, setup } from './fixtures';

const { dtS, idm, mobil, vehicleLengthM, cooperativeYieldS, missedTurnAfterS } = DEFAULT_SIM_PARAMS;
const { creepSpeedMps } = DEFAULT_SIM_PARAMS.intersection;

/** Only the given lane pairs from `from` into `to` (lane ordinals, 0 = leftmost). */
function onlyLanes(node: Node, from: Road, to: Road, pairs: [number, number][]) {
  const provenance = { source: 'authored' } as const;
  node.turnRules.push({ from: from.id, to: to.id, allowed: false, provenance });
  for (const [fromLane, toLane] of pairs)
    node.turnRules.push({ from: from.id, to: to.id, fromLane, toLane, allowed: true, provenance });
}

test('T29 a lane feeding two lanes of a short ramp lands in the one that serves the next road', () => {
  // Shaped like Munich's r:1299 into r:639: the right lane of a two-lane road continues into
  // lanes 1 and 2 of a 99 m three-lane ramp, each ramp lane has one movement, and only lane 2
  // turns right into the route's next road.
  const { city, node, road, place } = buildCity('Short ramp', 1);
  const split = node(200, 0);
  const junction = node(299, 0);
  const approach = road(node(0, 0), split, { lanes: 2, roadClass: 'ramp' });
  const ramp = road(split, junction, { lanes: 3, roadClass: 'ramp' });
  const right = road(junction, node(299, 200));
  onlyLanes(split, approach, ramp, [
    [0, 0],
    [1, 1],
    [1, 2],
  ]);
  onlyLanes(junction, ramp, road(junction, node(299, -200)), [[0, 0]]);
  onlyLanes(junction, ramp, road(junction, node(500, 0)), [[1, 0]]);
  onlyLanes(junction, ramp, right, [[2, 0]]);
  place('Origin', 'residential', { x: 0, y: 0 }, [
    { road: approach, lane: 1, positionM: 5, direction: 'out' },
  ]);
  place('Destination', 'work', { x: 299, y: 200 }, [
    { road: right, direction: 'in', positionM: 150 },
  ]);
  const compiled = setup(city);
  const origin = compiled.connectors.find((c) => c.direction === 'out')!;
  const request = {
    fromLane: origin.lane,
    fromPosM: origin.positionM,
    toConnector: compiled.connectors.find((c) => c.direction === 'in')!.idx,
    vehicleClass: 'car',
    desiredSpeedFactor: 1,
    noise: 0,
    seed: 1,
  } as const;
  const result = createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), request);
  if (!result.ok) throw new Error(result.reason);
  const { roads, movements, targetLanes } = result.route;
  const lane = (id: string) => compiled.index.lane.get(id)!;
  expect(roads.map((idx) => compiled.roads[idx]!.id)).toEqual([approach.id, ramp.id, right.id]);
  expect(compiled.movements[movements[0]!]!.toLane).toBe(lane(`${ramp.id}#2`));
  expect(targetLanes[1]).toEqual([lane(`${ramp.id}#2`)]);
  // No lane change anywhere: every movement leaves from the lane the previous one entered.
  let entry = origin.lane;
  for (const idx of movements) {
    expect(compiled.movements[idx]!.fromLane).toBe(entry);
    entry = compiled.movements[idx]!.toLane;
  }
  // Lane resolution itself picks that landing lane (before TASK-076 it kept the first of the
  // two equal-penalty movements and left the change to the lane-level search).
  const lanes = resolveLanes(
    compiled,
    createGraphCache()(compiled, 'car'),
    roads,
    request,
    compiled.connectors[request.toConnector]!,
    DEFAULT_SIM_PARAMS.laneChangeDistanceM,
  )!;
  expect(lanes.movements).toEqual(movements);

  // The fixtures that pin lane feasibility and road choice keep their routes (main at bed19c1).
  for (const [make, roads] of [
    [shortTurnLane, ['r:7', 'r:3', 'r:9']],
    [bypass, ['r:6', 'r:10', 'r:11', 'r:12', 'r:8']],
  ] as const) {
    const { compiled, request } = routingFixture(make());
    const route = createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), request);
    if (!route.ok) throw new Error(route.reason);
    expect(route.route.roads.map((idx) => compiled.roads[idx]!.id)).toEqual(roads);
  }
});

/** Trips from new origin places, one connector each on `road`, to the city's first place. */
function departures(
  city: ReturnType<typeof buildCity>['city'],
  place: ReturnType<typeof buildCity>['place'],
  road: Road,
) {
  const trips: TripRequest[] = [];
  const depart = (lane: number, positionM: number, departS: number) => {
    place(`Origin ${trips.length}`, 'residential', { x: positionM, y: 0 }, [
      { road, lane, positionM, direction: 'out' },
    ]);
    const places = Object.values(city.places);
    trips.push({
      id: `trip:${trips.length}`,
      personId: null,
      originPlaceId: places.at(-1)!.id,
      destinationPlaceId: places[0]!.id,
      departS,
      mode: 'car',
      legs: [],
    });
    return trips.length;
  };
  return { trips, depart };
}

/** Steps with free-flow costs; `observe` also gets each lane car's braking in this step. */
function run(
  compiled: CompiledCity,
  trips: TripRequest[],
  steps: number,
  observe: (engine: ReturnType<typeof createEngine>, braking: Map<number, number>) => void,
  params: Partial<SimParams> = {},
) {
  const engine = createEngine();
  engine.load({
    compiled,
    trips,
    scenario: scenario(),
    params,
    linkCosts: freeFlowLinkCosts(compiled),
  });
  let speeds = new Map<number, number>();
  for (let i = 0; i < steps; i++) {
    engine.step();
    const snapshot = engine.snapshot();
    const braking = new Map<number, number>();
    const next = new Map<number, number>();
    for (const [index, id] of snapshot.id.entries()) {
      next.set(id, snapshot.speed[index]!);
      const before = speeds.get(id);
      if (before !== undefined && snapshot.lane[index]! >= 0)
        braking.set(id, (before - snapshot.speed[index]!) / dtS);
    }
    speeds = next;
    observe(engine, braking);
  }
  return engine;
}

/** True while the car on `lane` creeps for its change or stands at the stop position. */
function held(compiled: CompiledCity, car: VehicleDetail, lane: number) {
  return (
    car.lane === lane &&
    (Math.abs(car.speedMps - creepSpeedMps) < 1e-6 ||
      (car.speedMps < 0.1 && car.positionM >= compiled.lanes[lane]!.stopM - idm.minGapM - 0.2))
  );
}

test('T29 a car held at the end of its lane beside a steady platoon gets a gap from behind', () => {
  // A two-lane 30 km/h road: its left lane only turns into a dead end, its right lane continues.
  const { city, node, road, place } = buildCity('Platoon', 1);
  const junction = node(1000, 0);
  const main = road(node(0, 0), junction, { lanes: 2, speedKmh: 30 });
  const onward = road(junction, node(1300, 0), { speedKmh: 30 });
  onlyLanes(junction, main, road(junction, node(1000, -200), { speedKmh: 30 }), [[0, 0]]);
  onlyLanes(junction, main, onward, [[1, 0]]);
  place('Work', 'work', { x: 1300, y: 0 }, [{ road: onward, direction: 'in', positionM: 250 }]);
  const { trips, depart } = departures(city, place, main);
  // A standing queue that starts together is a platoon after 700 m: at 6 to 7 m/s about
  // 3.3 s between fronts, 2.6 s between bumpers (IDM's discharge from a standstill leaves it
  // wider than the 1.5 s of its equilibrium). A standing car finds no safe gap in it.
  const platoon: number[] = [];
  for (let k = 0; k < 24; k++) platoon.push(depart(1, 5 + 13 * k, 100));
  // The late car starts 30 m before the end of the left lane while the platoon passes.
  const requester = depart(0, 960, 210);
  const compiled = setup(city);
  const left = compiled.index.lane.get(`${main.id}#0`)!;
  const right = compiled.index.lane.get(`${main.id}#1`)!;
  const lineM = compiled.lanes[left]!.stopM - idm.minGapM;

  function observe(params: Partial<SimParams>) {
    let heldS = NaN;
    let changedS = NaN;
    let yielder = -1;
    let yielderBraking = 0;
    let maxBraking = 0;
    const passed: number[] = [];
    let beyond = new Set<number>();
    const engine = run(
      compiled,
      trips,
      2500,
      (engine, braking) => {
        const snapshot = engine.snapshot();
        for (const [index, id] of snapshot.id.entries())
          if (snapshot.lane[index] === left || snapshot.lane[index] === right)
            maxBraking = Math.max(maxBraking, braking.get(id) ?? 0);
        const ahead = new Set<number>();
        for (const [index, id] of snapshot.id.entries())
          if (snapshot.lane[index] === right && engine.inspect(id)!.positionM >= lineM)
            ahead.add(id);
        for (const id of ahead) if (!beyond.has(id)) passed.push(engine.timeS);
        beyond = ahead;
        const car = engine.inspect(requester);
        if (!car || !Number.isNaN(changedS)) return;
        if (Number.isNaN(heldS) && held(compiled, car, left)) heldS = engine.timeS;
        if (car.lane === right) {
          changedS = engine.timeS;
          return;
        }
        // The yielder is the platoon car right behind the held car on the target lane.
        let nearest = -Infinity;
        for (const [index, id] of snapshot.id.entries()) {
          const position = engine.inspect(id)!.positionM;
          if (snapshot.lane[index] === right && position < car.positionM && position > nearest) {
            nearest = position;
            yielder = id;
          }
        }
        if (!Number.isNaN(heldS))
          yielderBraking = Math.max(yielderBraking, braking.get(yielder) ?? 0);
      },
      params,
    );
    return { engine, heldS, changedS, yielder, yielderBraking, maxBraking, passed };
  }

  const cooperative = observe({});
  expect(cooperative.heldS).toBeGreaterThan(0);
  // The platoon is passing the held car.
  const headways = cooperative.passed
    .map((t, i) => t - (cooperative.passed[i - 1] ?? NaN))
    .filter((_, i) => i > 0 && cooperative.passed[i]! <= cooperative.changedS)
    .slice(-4);
  expect(headways).toHaveLength(4);
  for (const headway of headways) expect(headway).toBeLessThan(4);
  expect(cooperative.changedS - cooperative.heldS).toBeLessThanOrEqual(cooperativeYieldS + 10);
  expect(platoon).toContain(cooperative.yielder);
  expect(cooperative.yielderBraking).toBeLessThanOrEqual(idm.bMps2 + 1e-9);
  // T07's braking bound for every car on the platoon road.
  expect(cooperative.maxBraking).toBeLessThanOrEqual(mobil.safeDecelMps2 + 1e-9);
  expect(cooperative.engine.metrics().trips).toMatchObject({ completed: 25, failed: 0 });

  // Without a yielder it waits much longer for a gap the platoon happens to leave.
  const alone = observe({ cooperativeYieldS: Infinity });
  expect(alone.heldS).toBe(cooperative.heldS);
  expect(alone.changedS - alone.heldS).toBeGreaterThan(cooperativeYieldS + 10);
});

test('T29 a held car whose target lane is blocked for good gives the exit up and reroutes', () => {
  // A two-lane road forks: the right lane may diverge into a one-lane exit, the left lane only
  // continues onward, from where a longer road comes back to the end of the exit.
  const { city, node, road, place } = buildCity('Exit fork', 1);
  const split = node(400, 0);
  const exitEnd = node(700, 60);
  const onwardEnd = node(800, 0);
  const main = road(node(0, 0), split, { lanes: 2, speedKmh: 30 });
  road(split, onwardEnd, { lanes: 2, speedKmh: 30 });
  const exit = road(split, exitEnd, { roadClass: 'ramp', speedKmh: 30 });
  const final = road(exitEnd, node(700, 300), { speedKmh: 30 });
  road(onwardEnd, exitEnd, { speedKmh: 30 });
  place('Work', 'work', { x: 700, y: 300 }, [{ road: final, direction: 'in', positionM: 100 }]);
  const { trips, depart } = departures(city, place, main);
  // The exit is full: arrivals at a closed place queue back across the fork and up the right
  // lane past the late car's origin.
  place('Closed', 'work', { x: 600, y: 40 }, [{ road: exit, direction: 'in', positionM: 280 }]);
  const closed = Object.values(city.places).at(-1)!;
  closed.capacity = 0;
  for (let k = 0; k < 90; k++) {
    depart(1, 5, 100 + k);
    trips.at(-1)!.destinationPlaceId = closed.id;
  }
  const requester = depart(0, 300, 500);
  const compiled = setup(city);
  const left = compiled.index.lane.get(`${main.id}#0`)!;
  const right = compiled.index.lane.get(`${main.id}#1`)!;
  let heldS = NaN;
  let leftS = NaN;
  let taken = -1;
  let queueToEnd = true;
  let previous = -1;
  // Blocked for good only without gridlock recovery: the head of the right lane's queue stands
  // behind the exit's queue and would respawn after 180 s (TASK-077).
  const engine = run(
    compiled,
    trips,
    9000,
    (engine) => {
      const car = engine.inspect(requester);
      if (car?.state !== 'driving' || !Number.isNaN(leftS)) return;
      if (Number.isNaN(heldS) && held(compiled, car, left)) heldS = engine.timeS;
      if (car.lane !== left && previous === left) {
        leftS = engine.timeS;
        // A movement, or the next lane when the movement has no length.
        taken =
          car.lane < 0
            ? -car.lane - 1
            : compiled.movements.findIndex((m) => m.fromLane === left && m.toLane === car.lane);
      }
      previous = car.lane;
      if (Number.isNaN(heldS) || !Number.isNaN(leftS)) return;
      // Beside the held car the right lane stays a standing queue, with no room to cut in.
      const snapshot = engine.snapshot();
      let front = -Infinity;
      for (const [index, id] of snapshot.id.entries())
        if (snapshot.lane[index] === right) {
          front = Math.max(front, engine.inspect(id)!.positionM);
          queueToEnd &&= snapshot.speed[index]! < 0.1;
        }
      queueToEnd &&= front > car.positionM - vehicleLengthM - idm.minGapM;
    },
    { gridlock: { ...DEFAULT_SIM_PARAMS.gridlock, respawnS: Infinity } },
  );
  expect(queueToEnd).toBe(true);
  expect(leftS - heldS).toBeGreaterThanOrEqual(missedTurnAfterS);
  expect(leftS - heldS).toBeLessThan(missedTurnAfterS + 10);
  const movement = compiled.movements[taken]!;
  expect(movement.fromLane).toBe(left);
  expect(movement.neverGreen).toBe(false);
  const detail = engine.inspect(requester)!;
  expect(detail.routeReason).toBe('missed_turn');
  expect(detail.state).toBe('completed');
});

// Known to fail (TASK-076 report): Munich still gridlocks from about 08:00, and from then cars
// off their target lanes stand in the jammed queues for hours (TASK-077's respawn is the
// escape). Before the lock the longest off-target hold at the end of a lane is on r:639, about
// 70 s. Turn this into `test` once the city no longer locks.
test.fails(
  'T29 Munich at 0.15: no car off its target lanes stands still for long',
  () => {
    const imported = importOsm(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), {
      importerVersion: '1',
      drivingSide: 'right',
      bbox: [11.525, 48.135, 11.545, 48.148],
    });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const { city } = imported;
    const compiled = setup(city);
    const morning = defaultScenario('grid5x5');
    morning.startS = 7 * 3600;
    morning.endS = 10 * 3600;
    morning.demand.personsPerResident = 0.15;
    const engine = createEngine();
    engine.load({
      compiled,
      trips: scheduleTrips(city, generatePopulation(city, morning.demand), morning),
      scenario: morning,
    });
    const watched = new Set(['r:639', 'r:1299', 'r:968', 'r:884']);
    const since = new Map<number, number>();
    let longest = 0;
    let longestWatched = 0;
    while (engine.timeS < morning.endS) {
      engine.step(10);
      const snapshot = engine.snapshot();
      for (const [index, id] of snapshot.id.entries()) {
        const lane = compiled.lanes[snapshot.lane[index]!];
        const detail = lane && snapshot.speed[index]! < 0.1 ? engine.inspect(id)! : null;
        const step = detail?.route?.roads.indexOf(lane!.road) ?? -1;
        const offTarget =
          detail !== null &&
          step >= 0 &&
          step < detail.route!.roads.length - 1 &&
          !detail.route!.targetLanes[step]!.includes(lane!.idx);
        if (!offTarget) {
          since.delete(id);
          continue;
        }
        const start = since.get(id) ?? engine.timeS;
        since.set(id, start);
        longest = Math.max(longest, engine.timeS - start);
        if (watched.has(compiled.roads[lane!.road]!.id))
          longestWatched = Math.max(longestWatched, engine.timeS - start);
      }
    }
    expect(longest).toBeLessThanOrEqual(missedTurnAfterS + 10);
    expect(longestWatched).toBeLessThanOrEqual(missedTurnAfterS + 10);
  },
  600000,
);
