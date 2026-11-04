import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { shortTurnLane } from '../../src/fixtures/short-turn-lane';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { remainingRouteCost } from '../../src/routing/costs';
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

test('a clamped lane-drop movement is not a drivable exit from a late origin', () => {
  const { city, node, road, place } = buildCity('Late lane drop', 1);
  const join = node(100, 0);
  const from = road(node(0, 0), join, { lanes: 2 });
  const to = road(join, node(200, 0));
  place('Origin', 'residential', { x: 0, y: 0 }, [
    { road: from, lane: 1, positionM: 80, direction: 'out' },
  ]);
  place('Destination', 'work', { x: 200, y: 0 }, [{ road: to, direction: 'in' }]);
  const { compiled, request } = routingFixture(city);
  expect(createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), request)).toEqual({
    ok: false,
    reason: 'lane_infeasible',
  });
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(compiled);
  const early = provider.route(compiled, costs, { ...request, fromPosM: 5 });
  const straight = provider.route(compiled, costs, {
    ...request,
    fromLane: compiled.lanes[request.fromLane]!.left,
    fromPosM: 5,
  });
  if (!early.ok || !straight.ok) throw new Error('Early origins must reach the exit');
  expect(early.route.costS - straight.route.costS).toBeCloseTo(3);
  expect(
    remainingRouteCost(compiled, costs, { ...request, fromPosM: 5 }, early.route, 0),
  ).toBeCloseTo(early.route.costS);
});

test('the fallback reserves the same ten-metre intermediate-road margin as lane resolution', () => {
  const { city, node, road, place } = buildCity('Short intermediate approach', 1);
  const a = node(0, 0),
    b = node(39, 0);
  const from = road(node(-100, 0), a);
  const middle = road(a, b, { lanes: 2 });
  const to = road(b, node(39, -100));
  a.turnRules.push({
    from: from.id,
    to: middle.id,
    toLane: 0,
    allowed: false,
    provenance: a.provenance,
  });
  // Keep lane 1 out of the left turn (including compiler fallback).
  b.turnRules.push({
    from: middle.id,
    to: to.id,
    fromLane: 1,
    allowed: false,
    provenance: b.provenance,
  });
  place('Origin', 'residential', { x: -100, y: 0 }, [{ road: from, direction: 'out' }]);
  place('Destination', 'work', { x: 39, y: -100 }, [{ road: to, direction: 'in' }]);
  const { compiled, request } = routingFixture(city);
  expect(createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), request)).toEqual({
    ok: false,
    reason: 'lane_infeasible',
  });
});
