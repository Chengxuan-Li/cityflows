import { expect, test } from 'vitest';
import { generated } from '../../src/fixtures/build-city';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { routingFixture } from './fixtures';

test('T04 detours around a banned left turn and reports no path if all entries are banned', () => {
  const city = grid5x5();
  const [home, work] = Object.values(city.places);
  const roads = Object.values(city.roads);
  home!.connectors.find((connector) => connector.direction === 'out')!.roadId = roads.find(
    (road) =>
      road.centerline[0]!.x === 0 && road.centerline[0]!.y === 0 && road.centerline[1]!.y === 120,
  )!.id;
  work!.connectors.find((connector) => connector.direction === 'in')!.roadId = roads.find(
    (road) =>
      road.centerline[0]!.x === 360 &&
      road.centerline[0]!.y === 480 &&
      road.centerline[1]!.x === 480,
  )!.id;
  const provider = createRouteProvider();
  const route = () => {
    const { compiled, request } = routingFixture(city);
    return { compiled, result: provider.route(compiled, freeFlowLinkCosts(compiled), request) };
  };
  const initial = route();
  if (!initial.result.ok) throw new Error(initial.result.reason);
  const direct = initial.result.route.movements
    .map((idx) => initial.compiled.movements[idx]!)
    .find((movement) => movement.turn === 'left');
  if (!direct) throw new Error('Expected a left turn on the original route');
  const from = initial.compiled.roads[initial.compiled.lanes[direct.fromLane]!.road]!.id;
  const to = initial.compiled.roads[initial.compiled.lanes[direct.toLane]!.road]!.id;
  const junction = city.nodes[city.roads[to]!.from]!;
  junction.turnRules.push({ from, to, allowed: false, provenance: generated });
  city.version++;

  const detour = route();
  if (!detour.result.ok) throw new Error(detour.result.reason);
  const roadIds = detour.result.route.roads.map((idx) => detour.compiled.roads[idx]!.id);
  expect(roadIds.some((id, i) => id === from && roadIds[i + 1] === to)).toBe(false);

  const destinationRoad = initial.compiled.roads[initial.result.route.roads.at(-1)!]!.id;
  const destinationJunction = city.nodes[city.roads[destinationRoad]!.from]!;
  for (const road of Object.values(city.roads)) {
    if (road.to === destinationJunction.id) {
      destinationJunction.turnRules.push({
        from: road.id,
        to: destinationRoad,
        allowed: false,
        provenance: generated,
      });
    }
  }
  city.version++;
  expect(route().result).toEqual({ ok: false, reason: 'no_path' });
});
