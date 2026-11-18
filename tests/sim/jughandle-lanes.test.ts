import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import type { TripRequest } from '../../src/schema';
import { createRouteProvider } from '../../src/routing';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';

// TASK-204: Munich's jughandle (jg:10778 into r:697, then r:654) let cars through the
// group on the first lane chain that could still reach the exit road's target lanes, not on the
// one their route planned, so they arrived in a lane that needed a change into the turning
// lane's queue, could not find a gap and missed the turn. Here a group's inner road fans out to
// both lanes of a short approach; only its right lane turns right at a signal that is red long
// enough for a queue to fill that lane; a car that misses the turn goes round the block.
function jughandle() {
  const { city, node, road, place } = buildCity('Jughandle lanes', 1);
  const start = node(-300, 0),
    a = node(0, 0),
    b = node(12, 0),
    c = node(62, 0);
  const entry = road(start, a);
  const inner = road(a, b);
  const approach = road(b, c, { lanes: 2 });
  const right = road(c, node(62, 300));
  const east = node(362, 0);
  const straight = road(c, east);
  // A car that misses the turn goes round the block and comes back.
  const corner = node(362, -200),
    back = node(-300, -200);
  road(east, corner);
  road(corner, back);
  road(back, start);
  const provenance = { source: 'authored' } as const;
  b.turnRules = [0, 1].map((toLane) => ({
    from: inner.id,
    to: approach.id,
    fromLane: 0,
    toLane,
    allowed: true,
    provenance,
  }));
  c.turnRules = [
    { from: approach.id, to: right.id, allowed: false, provenance },
    { from: approach.id, to: right.id, fromLane: 1, toLane: 0, allowed: true, provenance },
    { from: approach.id, to: straight.id, allowed: false, provenance },
    { from: approach.id, to: straight.id, fromLane: 0, toLane: 0, allowed: true, provenance },
  ];
  city.junctionGroups = {
    'jg:100': {
      id: 'jg:100',
      nodes: [a.id, b.id],
      innerRoads: [inner.id],
      signal: null,
      provenance,
    },
  };
  // The right turn is red for the first 124 s.
  c.control = 'signal';
  c.signal = {
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [
      { durationS: 120, groups: [{ from: approach.id, to: straight.id }] },
      { durationS: 20, groups: [{ from: approach.id, to: right.id }] },
    ],
  };
  place('Origin', 'gateway', start.pos, [{ road: entry, direction: 'out', positionM: 5 }]);
  place('Destination', 'work', c.pos, [{ road: right, direction: 'in', positionM: 250 }]);
  const [origin, destination] = Object.values(city.places);
  const requests: TripRequest[] = Array.from({ length: 12 }, (_, i) => ({
    id: `trip:${i}`,
    personId: null,
    originPlaceId: origin!.id,
    destinationPlaceId: destination!.id,
    departS: 100 + 2 * i,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  }));
  return { compiled: setup(city), requests, approach };
}

test('TASK-204: cars cross a junction group on the lane chain their route planned and make the turn behind the group', () => {
  const { compiled, requests, approach } = jughandle();
  const road = compiled.index.road.get(approach.id)!;
  const [, turning] = compiled.roads[road]!.lanes;
  const engine = createEngine();
  engine.load({ compiled, scenario: scenario(), trips: requests });
  // The lane each car enters the approach in.
  const entered = new Map<number, number>();
  for (let step = 0; step < 4000 && engine.metrics().trips.completed < requests.length; step++) {
    engine.step();
    for (let id = 1; id <= requests.length; id++) {
      const lane = engine.inspect(id)?.lane ?? -1;
      if (lane >= 0 && compiled.lanes[lane]!.road === road && !entered.has(id))
        entered.set(id, lane);
    }
  }
  const missed = requests.filter((_, i) => engine.inspect(i + 1)!.routeReason === 'missed_turn');
  expect(missed).toHaveLength(0);
  expect(engine.metrics().trips).toMatchObject({ completed: requests.length, failed: 0 });
  expect([...entered.values()]).toEqual(requests.map(() => turning));
});

// TASK-204: off its planned lane, a car takes a change that lowers the changes its route still
// needs as soon as it is safe, so it prepares on the roads before a turn instead of leaving the
// change to a short approach. A three-lane road leads into a 45 m three-lane approach whose
// right lane alone turns right. From the middle lane the approach still allows one change at
// free flow, so both the middle and the right lane are target lanes of the long road; the route
// plans the right one (as the lane search may when the changes cost the same either way).
function preparing() {
  const { city, node, road, place } = buildCity('Preparing lanes', 1);
  const start = node(-300, 0),
    b = node(0, 0),
    c = node(45, 0);
  const before = road(start, b, { lanes: 3 });
  const approach = road(b, c, { lanes: 3 });
  const right = road(c, node(45, 300));
  const straight = road(c, node(345, 0), { lanes: 2 });
  const provenance = { source: 'authored' } as const;
  b.turnRules = [{ from: before.id, to: approach.id, allowed: false, provenance }];
  for (const lane of [0, 1, 2])
    b.turnRules.push({
      from: before.id,
      to: approach.id,
      fromLane: lane,
      toLane: lane,
      allowed: true,
      provenance,
    });
  c.turnRules = [
    { from: approach.id, to: right.id, allowed: false, provenance },
    { from: approach.id, to: right.id, fromLane: 2, toLane: 0, allowed: true, provenance },
    { from: approach.id, to: straight.id, allowed: false, provenance },
    { from: approach.id, to: straight.id, fromLane: 0, toLane: 0, allowed: true, provenance },
    { from: approach.id, to: straight.id, fromLane: 1, toLane: 1, allowed: true, provenance },
  ];
  place('Origin', 'gateway', start.pos, [
    { road: before, lane: 0, direction: 'out', positionM: 5 },
  ]);
  place('Destination', 'work', c.pos, [{ road: right, direction: 'in', positionM: 250 }]);
  return { city, compiled: setup(city), before, approach };
}

test('TASK-204: a car off its planned lane changes towards it on the road before a short approach', () => {
  const { city, compiled, before, approach } = preparing();
  const lane = (road: string, index: number) => compiled.index.lane.get(`${road}#${index}`)!;
  const provider = createRouteProvider();
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: scenario(),
    trips: trips(city, 1),
    routeProvider: {
      route(network, costs, request) {
        const result = provider.route(network, costs, request);
        if (!result.ok || compiled.lanes[request.fromLane]!.road !== result.route.roads[0])
          return result;
        // The plan leaves the long road from its right lane.
        const planned = lane(before.id, 2);
        const movements = result.route.movements.slice();
        movements[0] = compiled.lanes[planned]!.out[0]!;
        const targetLanes = result.route.targetLanes.slice();
        targetLanes[0] = [planned, ...targetLanes[0]!.filter((l) => l !== planned)];
        return { ok: true, route: { ...result.route, movements, targetLanes } };
      },
    },
  });
  let entered = -1;
  for (let step = 0; step < 1500 && engine.metrics().trips.completed === 0; step++) {
    engine.step();
    const at = engine.inspect(1)!.lane;
    if (
      entered === -1 &&
      at >= 0 &&
      compiled.lanes[at]!.road === compiled.index.road.get(approach.id)
    )
      entered = at;
  }
  // Without the rule it stops at the middle lane, the nearest target lane, and enters the
  // approach there.
  expect(compiled.lanes[entered]!.id).toBe(`${approach.id}#2`);
  expect(engine.metrics().trips).toMatchObject({ completed: 1, failed: 0 });
});
