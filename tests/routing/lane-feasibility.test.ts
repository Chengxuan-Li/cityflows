import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { shortTurnLane } from '../../src/fixtures/short-turn-lane';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { routingFixture } from './fixtures';

function curbRestrictedTurn() {
  const city = shortTurnLane();
  const ramp = Object.values(city.roads).find((r) => r.roadClass === 'ramp')!;
  const exit = Object.values(city.roads).find((r) => r.from === ramp.to)!;
  city.nodes[ramp.to]!.turnRules.push({
    from: ramp.id,
    to: exit.id,
    toLane: 0,
    allowed: false,
    provenance: { source: 'authored' },
  });
  return city;
}

test('the slip road reaches the left turn only with a shorter lane change distance', () => {
  const { compiled, request } = routingFixture(curbRestrictedTurn());
  const costs = freeFlowLinkCosts(compiled);
  expect(createRouteProvider().route(compiled, costs, request)).toEqual({
    ok: false,
    reason: 'lane_infeasible',
  });

  const result = createRouteProvider({ laneChangeDistanceM: 10 }).route(compiled, costs, request);
  if (!result.ok) throw new Error(result.reason);
  const { roads, movements, targetLanes } = result.route;
  expect(targetLanes).toHaveLength(roads.length);
  expect(compiled.lanes[compiled.movements[movements[0]!]!.toLane]!.lane).toBe(1);
  for (const [index, lanes] of targetLanes.entries()) {
    expect(lanes.length).toBeGreaterThan(0);
    for (const lane of lanes) {
      expect(compiled.lanes[lane]!.road).toBe(roads[index]);
      if (index < movements.length) {
        expect(
          compiled.lanes[lane]!.out.some((idx) => {
            const movement = compiled.movements[idx]!;
            return (
              !movement.neverGreen && compiled.lanes[movement.toLane]!.road === roads[index + 1]
            );
          }),
        ).toBe(true);
      }
    }
  }
});

test('the lane fallback detours when the shortest turn is out of reach from the origin', () => {
  const { city, node, road, place } = buildCity('Late turn', 1);
  const junction = node(0, 0);
  const rejoin = node(0, -100);
  const far = node(100, 0);
  const corner = node(100, -100);
  const origin = road(node(-100, 0), junction, { lanes: 2 });
  const direct = road(junction, rejoin);
  const detour = road(junction, far, { lanes: 2 });
  road(far, corner);
  road(corner, rejoin);
  const destination = road(rejoin, node(-100, -100));
  place('Origin', 'residential', origin.centerline[0]!, [
    { road: origin, lane: 1, positionM: 80, direction: 'out' },
  ]);
  place('Destination', 'work', destination.centerline[1]!, [
    { road: destination, direction: 'in' },
  ]);
  const { compiled, request } = routingFixture(city);
  const result = createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), request);
  if (!result.ok) throw new Error(result.reason);
  const ids = result.route.roads.map((idx) => compiled.roads[idx]!.id);
  expect(ids).toContain(detour.id);
  expect(ids).not.toContain(direct.id);
  expect(result.route.targetLanes[0]).toEqual([request.fromLane]);
});

test('trimmed lanes cannot use the extra centerline length for a lane change', () => {
  const city = curbRestrictedTurn();
  const middle = Object.values(city.roads).find(
    (road) => road.centerline[1]!.x === 24 && road.centerline[1]!.y === 0,
  )!;
  city.nodes[middle.to]!.pos.x = 42;
  for (const lane of middle.lanes) lane.widthM = 15;

  const { compiled, request } = routingFixture(city);
  expect(createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), request)).toEqual({
    ok: false,
    reason: 'lane_infeasible',
  });
});
