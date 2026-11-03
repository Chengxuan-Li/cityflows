import { expect, test } from 'vitest';
import { bypass } from '../../src/fixtures/bypass';
import { buildCity } from '../../src/fixtures/build-city';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { routingFixture } from './fixtures';

test('a truck avoids car-only roads and reports class_forbidden when every route needs one', () => {
  const city = bypass();
  const expressway = Object.values(city.roads).find((road) => road.roadClass === 'motorway')!;
  const local = Object.values(city.roads).find((road) => road.speedLimitMps === 40 / 3.6)!;
  const provider = createRouteProvider();
  const routeTruck = () => {
    const { compiled, request } = routingFixture(city);
    return provider.route(compiled, freeFlowLinkCosts(compiled), {
      ...request,
      vehicleClass: 'truck',
    });
  };
  for (const lane of expressway.lanes) lane.allowed = ['car'];
  const detour = routeTruck();
  if (!detour.ok) throw new Error(detour.reason);
  expect(detour.route.roads).toHaveLength(3);

  local.lanes[0]!.allowed = ['car'];
  city.version++;
  expect(routeTruck()).toEqual({ ok: false, reason: 'class_forbidden' });
});

test('a movement without a green phase cannot be routed', () => {
  const { city, node, road, place } = buildCity('Never green', 1);
  const junction = node(0, 0);
  const origin = road(node(-100, 0), junction);
  const exit = road(junction, node(100, 0));
  const other = road(junction, node(0, 100));
  junction.control = 'signal';
  junction.signal = {
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [{ durationS: 20, groups: [{ from: origin.id, to: other.id }] }],
  };
  place('Origin', 'residential', origin.centerline[0]!, [{ road: origin, direction: 'out' }]);
  place('Destination', 'work', exit.centerline[1]!, [{ road: exit, direction: 'in' }]);
  const { compiled, request } = routingFixture(city);
  expect(compiled.movements.some((movement) => movement.neverGreen)).toBe(true);
  expect(createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), request)).toEqual({
    ok: false,
    reason: 'no_path',
  });
});
