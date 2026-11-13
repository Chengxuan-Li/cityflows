import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createRouteProvider } from '../../src/routing';
import type { TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { sampleConflictZones } from './conflict-zone-safety';
import { scenario, setup } from './fixtures';

function sharedQueue({
  sameOutlet = false,
  occupied = false,
  red = false,
  infeasible = false,
} = {}) {
  const { city, node, road, place } = buildCity('Shared queue', 1);
  const junction = node(100, 0);
  junction.control = 'yield';
  const approach = road(node(0, 0), junction);
  const exit = road(junction, node(250, 0), { lanes: 2 });
  const provenance = { source: 'authored' } as const;
  junction.turnRules = [
    { from: approach.id, to: exit.id, allowed: false, provenance },
    ...[0, 1].map((toLane) => ({
      from: approach.id,
      to: exit.id,
      fromLane: 0,
      toLane,
      allowed: true,
      provenance,
    })),
  ];
  const stop = setup(city).lanes[0]!.stopM;
  const pairs: [string, string, number][] = [];
  for (const lane of occupied ? [0, 1] : [0]) {
    place(`Blocker ${lane}`, 'gateway', junction.pos, [
      { road: exit, lane, direction: 'out', positionM: 4.5 },
    ]);
    const origin = Object.values(city.places).at(-1)!;
    place(`Closed ${lane}`, 'work', junction.pos, [
      { road: exit, lane, direction: 'in', positionM: 4.5 },
    ]);
    const destination = Object.values(city.places).at(-1)!;
    destination.capacity = 0;
    pairs.push([origin.id, destination.id, 99]);
  }
  for (let i = 0; i < 2; i++) {
    place(`Origin ${i}`, 'gateway', junction.pos, [
      { road: approach, direction: 'out', positionM: stop - 2 - i * 6.6 },
    ]);
    const origin = Object.values(city.places).at(-1)!;
    place(`Destination ${i}`, 'work', junction.pos, [
      {
        road: exit,
        lane: i === 0 || sameOutlet ? 0 : 1,
        direction: 'in',
        positionM: infeasible && i === 0 ? 20 : 120,
      },
    ]);
    pairs.push([origin.id, Object.values(city.places).at(-1)!.id, 100]);
  }
  const compiled = setup(city);
  const alternate = compiled.index.lane.get(`${exit.id}#1`)!;
  if (red) {
    const center = compiled.nodes[compiled.index.node.get(junction.id)!]!;
    center.control = 'signal';
    center.signal = {
      offsetS: -100,
      amberS: 0,
      allRedS: 0,
      cycleS: 520,
      phases: [
        {
          durationS: 20,
          movements: center.movements.filter((m) => compiled.movements[m]!.toLane !== alternate),
          walk: [],
        },
        { durationS: 500, movements: center.movements, walk: [] },
      ],
    };
  }
  const trips: TripRequest[] = pairs.map(([originPlaceId, destinationPlaceId, departS], i) => ({
    id: `trip:${i}`,
    personId: null,
    originPlaceId,
    destinationPlaceId,
    departS,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  }));
  const engine = createEngine();
  const provider = createRouteProvider();
  const searches: number[] = [],
    detours: number[] = [];
  const headId = occupied ? 3 : 2;
  engine.load({
    compiled,
    trips,
    scenario: { ...scenario(), startS: 99 },
    params: { headDetourS: 45, maxReplans: 0, spawnMinGapM: 2 },
    routeProvider: {
      route(network, costs, request) {
        if (request.fromLane === alternate && request.fromPosM === 0) searches.push(engine.timeS);
        return provider.route(network, costs, request);
      },
    },
    headDetourObserver(id) {
      if (id === headId - 1) detours.push(engine.timeS);
    },
  });
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * 10; i++) {
      engine.step();
      sampleConflictZones(engine, compiled);
    }
  };
  return { engine, run, searches, detours, headId };
}

test('T66 a stopped shared queue head releases a distinct serviceable follower before the usual delay', () => {
  const f = sharedQueue();
  f.run(25);
  expect(f.detours).toHaveLength(1);
  expect(f.detours[0]).toBeLessThan(120);
  expect(f.engine.inspect(f.headId)!.respawns).toBe(0);
  expect(f.engine.inspect(f.headId + 1)!.state).toBe('completed');
});

test.each(['sameOutlet', 'occupied'] as const)(
  'T66 a %s follower does not trigger an early search',
  (option) => {
    const f = sharedQueue({ [option]: true });
    f.run(25);
    expect(f.detours).toEqual([]);
    expect(f.searches).toEqual([]);
  },
);

test('T66 a red follower exit waits for green before an early release', () => {
  const f = sharedQueue({ red: true });
  f.run(20);
  expect(f.detours).toEqual([]);
  expect(f.searches).toEqual([]);
  f.run(20);
  expect(f.detours).toHaveLength(1);
  expect(f.detours[0]).toBeGreaterThanOrEqual(120);
});

test('T66 an infeasible early detour is reused after the ordinary delay and retried on a cost update', () => {
  const f = sharedQueue({ infeasible: true });
  f.run(25);
  expect(f.detours).toEqual([]);
  expect(f.searches).toHaveLength(1);
  f.run(25);
  expect(f.searches).toHaveLength(1);
  f.run(15);
  expect(f.searches).toHaveLength(2);
  expect(f.detours).toEqual([]);
});
