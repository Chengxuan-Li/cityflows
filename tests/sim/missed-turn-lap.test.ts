import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createRouteProvider } from '../../src/routing';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';

// TASK-193: Munich's jam ring behind jg:10802 was fed by cars that missed a turn at the group and
// were rerouted round a 2.5 km lap back through the road they had missed it on. A car that
// misses its turn now takes a route that does not come back over roads it has already driven,
// when one reaches its destination.
function missedTurn() {
  const { city, node, road, place } = buildCity('Missed turn', 1);
  const start = node(-60, 0),
    junction = node(0, 0),
    south = node(0, 200),
    east = node(200, 0);
  const approach = road(start, junction, { lanes: 2 });
  const right = road(junction, south);
  const straight = road(junction, east);
  const goal = road(south, node(0, 400));
  // The short lap: round the block back onto the approach.
  const north = node(200, -200),
    west = node(-60, -200);
  road(east, north);
  road(north, west);
  road(west, start);
  // The long way: far east, then back west to the goal road.
  const far = node(1000, 0),
    farSouth = node(1000, 200);
  road(east, far);
  road(far, farSouth);
  road(farSouth, south);
  const provenance = { source: 'authored' } as const;
  junction.turnRules = [
    { from: approach.id, to: right.id, allowed: false, provenance },
    { from: approach.id, to: right.id, fromLane: 1, toLane: 0, allowed: true, provenance },
    { from: approach.id, to: straight.id, allowed: false, provenance },
    { from: approach.id, to: straight.id, fromLane: 0, toLane: 0, allowed: true, provenance },
  ];
  const initial = setup(city);
  const stopM = initial.lanes[initial.index.lane.get(`${approach.id}#0`)!]!.stopM;
  place('Origin', 'residential', start.pos, [
    { road: approach, lane: 0, direction: 'out', positionM: stopM - 2 },
  ]);
  place('Destination', 'work', south.pos, [{ road: goal, direction: 'in', positionM: 150 }]);
  return { compiled: setup(city), city, approach, right };
}

test('TASK-193: a car that missed its turn does not lap back over the roads it drove when another route exists', () => {
  const { compiled, city, approach, right } = missedTurn();
  const [left, turning] = compiled.roads[compiled.index.road.get(approach.id)!]!.lanes;
  const provider = createRouteProvider();
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: scenario(),
    trips: trips(city, 1),
    // The car departs 2 m before the line in the left lane on a route that turns right from the
    // right lane, so it misses the turn and goes straight on.
    routeProvider: {
      route(network, costs, request) {
        if (request.fromLane !== left) return provider.route(network, costs, request);
        const result = provider.route(network, costs, { ...request, fromLane: turning! });
        if (!result.ok) return result;
        const targetLanes = result.route.targetLanes.slice();
        targetLanes[0] = [left];
        return { ok: true, route: { ...result.route, targetLanes } };
      },
    },
  });
  const roads: string[] = [];
  for (let step = 0; step < 3000 && engine.metrics().trips.completed === 0; step++) {
    engine.step();
    const field = engine.inspect(1)!.lane;
    if (field < 0) continue;
    const road = compiled.roads[compiled.lanes[field]!.road]!.id;
    if (roads.at(-1) !== road) roads.push(road);
  }
  expect(engine.metrics().trips).toMatchObject({ completed: 1, failed: 0 });
  expect(engine.inspect(1)!.routeReason).toBe('missed_turn');
  expect(roads.filter((road) => road === approach.id)).toHaveLength(1);
  expect(roads).not.toContain(right.id);
});
