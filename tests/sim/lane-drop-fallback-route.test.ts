import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createRouteProvider } from '../../src/routing';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';

// TASK-046: the seed-1 stress grid left one trip waiting all day at the end of a dropped lane.
// A lane-level fallback route names a single target lane per road, and the routing lane
// model keeps the compiler's clamped movement from the dropped lane, so every target lane of
// the step was dropped before the next road and no lane change was ever proposed.
test('a route whose only target lane is dropped still leaves by a surviving lane', () => {
  const { city, node, road, place } = buildCity('Dropped target lane', 1);
  const join = node(300, 0);
  const approach = road(node(0, 0), join, { lanes: 2 });
  const after = road(join, node(600, 0));
  place('Start', 'residential', { x: 0, y: 0 }, [{ road: approach, lane: 1, direction: 'out' }]);
  place('End', 'work', { x: 600, y: 0 }, [{ road: after, direction: 'in', positionM: 200 }]);
  const compiled = setup(city);
  const dropped = compiled.lanes.find((lane) => lane.id === `${approach.id}#1`)!;
  const provider = createRouteProvider();
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: scenario(),
    trips: trips(city, 1),
    routeProvider: {
      route(network, costs, request) {
        const result = provider.route(network, costs, request);
        if (!result.ok || request.fromLane !== dropped.idx) return result;
        // Inject the historical undrivable route independently of the corrected router.
        const movements = result.route.movements.slice();
        movements[0] = dropped.out.find(
          (idx) => network.lanes[network.movements[idx]!.toLane]!.road === result.route.roads[1],
        )!;
        const targetLanes = result.route.targetLanes.slice();
        targetLanes[0] = [dropped.idx];
        return { ok: true, route: { ...result.route, movements, targetLanes } };
      },
    },
  });
  let movementFrom = -1;
  for (let step = 0; step < 1200 && engine.metrics().trips.completed === 0; step++) {
    engine.step();
    const field = engine.inspect(1)!.lane;
    if (field < 0) movementFrom = compiled.movements[-field - 1]!.fromLane;
  }
  expect(engine.metrics().trips).toMatchObject({ completed: 1, driving: 0, failed: 0 });
  expect(movementFrom).toBe(dropped.left);
  expect(engine.inspect(1)!.routeReason).toBe('missed_turn');
});
