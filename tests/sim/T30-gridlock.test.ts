import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import type { SimParams, TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { scenario, setup } from './fixtures';

const { respawnS, fadeS, maxRespawns } = DEFAULT_SIM_PARAMS.gridlock;
type Engine = ReturnType<typeof createEngine>;

function trip(id: number, originPlaceId: string, destinationPlaceId: string, departS = 100) {
  return {
    id: `trip:${id}`,
    personId: null,
    originPlaceId,
    destinationPlaceId,
    departS,
    mode: 'car',
    legs: [],
  } satisfies TripRequest;
}

/**
 * Four one-way, one-lane roads in a square with a yield node at each corner and an exit road
 * leaving every corner. At 100 s every ring lane is packed from its stop line back to its start
 * at bumper gaps just over `minGapM`: each head waits for room on the next ring road, which
 * never comes. The head of each ring road continues to the exit after the next corner; the cars
 * behind it leave at the next corner. `headThroughput` sets how often a head's origin connector
 * admits a car.
 */
function squareDeadlock(headThroughput: number) {
  const { city, node, road, place } = buildCity('Square deadlock', 1);
  const corners = [node(0, 0), node(100, 0), node(100, 100), node(0, 100)];
  for (const corner of corners) corner.control = 'yield';
  const ring = corners.map((corner, i) => road(corner, corners[(i + 1) % 4]!, { speedKmh: 30 }));
  const outward = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  const exits = corners.map((corner, i) => {
    const [dx, dy] = outward[i]!;
    const exit = road(corner, node(corner.pos.x + 80 * dx, corner.pos.y + 80 * dy));
    place(`Exit ${i}`, 'work', corner.pos, [{ road: exit, direction: 'in', positionM: 60 }]);
    return Object.values(city.places).at(-1)!;
  });
  const result = compile(city);
  if (!result.ok) throw new Error('The ring must compile');
  const trips: TripRequest[] = [];
  const heads: number[] = [];
  for (const [i, ringRoad] of ring.entries()) {
    const lane = result.compiled.lanes[result.compiled.index.lane.get(`${ringRoad.id}#0`)!]!;
    for (let k = 0, positionM = lane.stopM - 2; positionM >= 0; k++, positionM -= 6.6) {
      place(`Origin ${i}.${k}`, 'residential', corners[i]!.pos, [
        { road: ringRoad, direction: 'out', positionM },
      ]);
      const origin = Object.values(city.places).at(-1)!;
      if (k === 0) {
        origin.connectors[0]!.throughputPerMin = headThroughput;
        heads.push(trips.length + 1);
      }
      trips.push(trip(trips.length, origin.id, exits[(i + (k === 0 ? 2 : 1)) % 4]!.id));
    }
  }
  // Bumper gaps of 2.1 m: only the spawn gap stops a packed start.
  return { compiled: setup(city), trips, heads, params: { spawnMinGapM: 2 } };
}

function load(fixture: { compiled: ReturnType<typeof setup>; trips: TripRequest[] }, params = {}) {
  const engine = createEngine();
  engine.load({ ...fixture, scenario: scenario(), params });
  return engine;
}

function fades(engine: Engine) {
  const snapshot = engine.snapshot();
  return new Map([...snapshot.id].map((id, i) => [id, snapshot.fade[i]!]));
}

test('T30 a square deadlock unlocks: the jam heads fade out, respawn at their origins, and every trip completes', () => {
  // A head's origin admits one car per ten minutes, so it cannot drop back into the ring at once.
  const fixture = squareDeadlock(0.1);
  const engine = load(fixture, fixture.params);
  const { heads, trips } = fixture;
  expect(heads).toHaveLength(4);
  // Locked: nothing moves and nothing fades until 5 s before the respawn.
  while (engine.timeS < 100 + respawnS - fadeS - 1e-9) {
    engine.step();
    const snapshot = engine.snapshot();
    expect(snapshot.count).toBe(trips.length);
    expect(Math.max(...snapshot.speed)).toBeLessThan(0.1);
    expect(Math.min(...snapshot.fade)).toBe(1);
  }
  // Each head fades linearly from 1 to 0 over the last 5 s; nothing else fades.
  while (engine.timeS < 100 + respawnS - 0.1 - 1e-9) {
    engine.step();
    const fade = fades(engine);
    for (const head of heads)
      expect(fade.get(head)).toBeCloseTo((100 + respawnS - engine.timeS) / fadeS, 5);
    for (const [id, value] of fade) if (!heads.includes(id)) expect(value).toBe(1);
  }
  expect(engine.metrics().respawns).toBe(0);
  engine.step();
  expect(engine.timeS).toBeCloseTo(100 + respawnS, 9);
  // Removed at 180 s, back in the queue of their origin connectors.
  expect(engine.metrics().respawns).toBe(4);
  expect(engine.metrics().trips).toMatchObject({ queuedOrigin: 4, driving: trips.length - 4 });
  for (const head of heads) {
    expect(engine.inspect(head)).toMatchObject({
      state: 'queued_origin',
      respawns: 1,
      departedS: 100,
      route: null,
    });
    expect(fades(engine).has(head)).toBe(false);
  }
  // The rest move again: the cars behind each head leave at the next corner.
  engine.step(100);
  expect(Math.max(...engine.snapshot().speed)).toBeGreaterThan(1);
  engine.step(9000);
  const { trips: counts, respawns, failedByReason } = engine.metrics();
  expect(counts).toMatchObject({ completed: trips.length, failed: 0 });
  expect(respawns).toBe(4);
  expect(failedByReason.gridlocked).toBe(0);
  for (const head of heads) {
    // T30 case 5: the trip keeps its first departure, so its travel time includes the stall.
    const detail = engine.inspect(head)!;
    expect(detail).toMatchObject({
      state: 'completed',
      departedS: 100,
      respawns: 1,
      routeReason: 'respawn',
    });
    // Released again when its origin admits the next car, ten minutes after the first.
    expect(detail.arrivedS! - detail.departedS!).toBeGreaterThan(600);
  }
  const outcomes = engine.metrics().tripOutcomes!;
  for (const head of heads)
    expect(outcomes[head - 1]).toMatchObject({ departedS: 100, respawns: 1 });
});

test('T30 a car at a red light or behind another car never fades; a jam head that moves is opaque again', () => {
  // A 60 m approach to a signal that is red from 100 s to 304 s; its queue backs up across the
  // node before it onto the upstream road.
  const { city, node, road, place, signal } = buildCity('Red queue', 1);
  const junction = node(0, 0);
  const signalized = node(60, 0);
  const upstream = road(node(-200, 0), junction, { speedKmh: 30 });
  const approach = road(junction, signalized, { speedKmh: 30 });
  const onward = road(signalized, node(260, 0), { speedKmh: 30 });
  const crossIn = road(node(60, -200), signalized, { speedKmh: 30 });
  const crossOut = road(signalized, node(60, 200), { speedKmh: 30 });
  signal(signalized, [
    [crossIn, onward],
    [approach, crossOut],
  ]);
  signalized.signal!.phases[0]!.durationS = 200;
  signalized.signal!.offsetS = -100;
  place('Work', 'work', { x: 260, y: 0 }, [{ road: onward, direction: 'in', positionM: 150 }]);
  place('Home', 'residential', { x: -200, y: 0 }, [{ road: upstream, direction: 'out' }]);
  const [work, home] = Object.values(city.places);
  const trips = Array.from({ length: 30 }, (_, i) => trip(i, home!.id, work!.id, 100 + 2 * i));
  const compiled = setup(city);
  const upstreamLane = compiled.index.lane.get(`${upstream.id}#0`)!;
  const approachLane = compiled.index.lane.get(`${approach.id}#0`)!;
  // Fade from 120 s of jam time, so two minutes standing at the red would show.
  const gridlock: SimParams['gridlock'] = { respawnS: 240, fadeS: 120, maxRespawns };
  const engine = load({ compiled, trips }, { gridlock });
  const lowest = new Map<number, number>();
  const redHeadSince = new Map<number, number>();
  let redHeadStoodS = 0;
  let opaqueAgain = 0;
  while (engine.timeS < 450) {
    engine.step();
    const snapshot = engine.snapshot();
    const position = Array.from(snapshot.id, (id) => engine.inspect(id)!.positionM);
    for (let i = 0; i < snapshot.count; i++) {
      const id = snapshot.id[i]!;
      const lane = snapshot.lane[i]!;
      const fade = snapshot.fade[i]!;
      // On the red approach every car stays opaque, its head included, and on the upstream
      // road so does every car behind another.
      const behind = position.some((p, j) => snapshot.lane[j] === lane && p > position[i]!);
      if (lane === approachLane || (lane === upstreamLane && behind)) expect(fade).toBe(1);
      if (fade < 1) lowest.set(id, Math.min(lowest.get(id) ?? 1, fade));
      else if (lowest.has(id) && snapshot.speed[i]! > 0.1) opaqueAgain++;
      if (lane === approachLane && !behind && snapshot.speed[i]! < 0.1) {
        const since = redHeadSince.get(id) ?? engine.timeS;
        redHeadSince.set(id, since);
        redHeadStoodS = Math.max(redHeadStoodS, engine.timeS - since);
      } else redHeadSince.delete(id);
    }
  }
  // The head at the red stood longer than the jam time from which a car fades.
  expect(redHeadStoodS).toBeGreaterThan(gridlock.respawnS - gridlock.fadeS);
  // The jam head on the upstream road (or on the node's movement) faded, then turned opaque
  // again once the queue moved on green; nobody respawned.
  expect(Math.min(...lowest.values())).toBeLessThan(0.9);
  expect(opaqueAgain).toBeGreaterThan(0);
  expect(engine.metrics().respawns).toBe(0);
  expect(engine.metrics().trips.completed).toBeGreaterThan(0);
});

test('T30 a trip stuck again after its last respawn fails as gridlocked', () => {
  // Each head's origin is its own spot at the stop line, so it drops straight back into the
  // ring and locks it again, 180 s after 180 s.
  const fixture = squareDeadlock(30);
  const engine = load(fixture, fixture.params);
  const respawnTimes: number[] = [];
  let respawns = 0;
  while (engine.timeS < 100 + (maxRespawns + 1) * respawnS + 1) {
    engine.step();
    const metrics = engine.metrics();
    if (metrics.respawns !== respawns) respawnTimes.push(Math.round(engine.timeS * 10) / 10);
    respawns = metrics.respawns;
  }
  expect(respawnTimes).toEqual([1, 2, 3].map((n) => 100 + n * respawnS));
  const { trips, failedByReason } = engine.metrics();
  expect(respawns).toBe(maxRespawns * 4);
  expect(failedByReason.gridlocked).toBe(4);
  expect(trips.failed).toBe(4);
  for (const head of fixture.heads)
    expect(engine.inspect(head)).toMatchObject({
      state: 'failed',
      failReason: 'gridlocked',
      respawns: maxRespawns,
    });
  // The rest drain once the heads are gone.
  engine.step(6000);
  expect(engine.metrics().trips).toMatchObject({
    completed: fixture.trips.length - 4,
    failed: 4,
  });
});

test('T30 respawns keep the trip sums and the per-trip counts, and are deterministic', () => {
  const fixture = squareDeadlock(30);
  const first = load(fixture, fixture.params);
  const twin = load(fixture, fixture.params);
  const total = fixture.trips.length;
  for (let step = 0; step < 9000; step++) {
    first.step();
    twin.step();
    expect(twin.stateHash()).toBe(first.stateHash());
    const metrics = first.metrics();
    expect(twin.metrics().respawns).toBe(metrics.respawns);
    expect(Object.values(metrics.trips).reduce((a, b) => a + b)).toBe(total);
    if (step % 10 === 0)
      expect(metrics.tripOutcomes!.reduce((sum, outcome) => sum + outcome.respawns, 0)).toBe(
        metrics.respawns,
      );
  }
  expect(first.metrics().respawns).toBe(maxRespawns * 4);
});
