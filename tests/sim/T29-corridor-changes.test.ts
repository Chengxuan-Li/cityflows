import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { isLaneDrop } from '../../src/network/lane-drop';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { createLaneChanges } from '../../src/sim/lane-change';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { setup } from './fixtures';

function corridor({ distant = false, alternate = false, narrow = false, from = 0 } = {}) {
  const { city, node, road, place } = buildCity('Future required changes', 1);
  const a = node(distant ? 1000 : 120, 0),
    b = node(a.pos.x + 80, 0),
    c = node(a.pos.x + 100, 0);
  const first = road(node(0, 0), a, { lanes: 2 }),
    second = road(a, b, { lanes: 2 });
  const short = road(b, c, { lanes: narrow ? 1 : 2 });
  const exit = road(c, node(c.pos.x, -150));
  road(c, node(c.pos.x + 150, 0));
  const provenance = { source: 'authored' } as const;
  if (alternate)
    b.turnRules = [
      { from: second.id, to: short.id, fromLane: 1, toLane: 0, allowed: true, provenance },
    ];
  c.turnRules = [
    { from: short.id, to: exit.id, allowed: false, provenance },
    { from: short.id, to: exit.id, fromLane: 0, toLane: 0, allowed: true, provenance },
  ];
  place('Goal', 'gateway', c.pos, [{ road: exit, direction: 'in', positionM: 100 }]);
  const compiled = setup(city),
    source = compiled.index.lane.get(`${first.id}#${from}`)!;
  const other = compiled.index.lane.get(`${first.id}#${1 - from}`)!;
  const result = createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), {
    fromLane: source,
    fromPosM: 50,
    toConnector: 0,
    vehicleClass: 'car',
    desiredSpeedFactor: 1,
    noise: 0,
    seed: 1,
  });
  if (!result.ok) throw new Error(result.reason);
  expect(result.route.targetLanes[0]).toContain(source);
  expect(result.route.targetLanes[0]).toContain(other);
  const vehicles = createVehicles(2, compiled.lanes.length, compiled.movements.length);
  vehicles.state.fill(DRIVING);
  vehicles.speedFactor.fill(1);
  vehicles.route[0] = result.route;
  vehicles.destination[0] = 0;
  vehicles.insert(0, source, 50);
  vehicles.speed[0] = 10;
  vehicles.insert(1, source, 70);
  vehicles.speed[1] = 0;
  const changes = createLaneChanges(compiled, vehicles, DEFAULT_SIM_PARAMS);
  return { compiled, source, other, changes, vehicles, second, short };
}

test.each([
  [{}, false],
  [{ alternate: true }, true],
  [{ distant: true }, true],
  [{ from: 1 }, true],
  [{ narrow: true, alternate: true }, false],
] as const)(
  'T29: discretionary corridor change preserves future burden (%j)',
  (options, passes) => {
    const f = corridor(options);
    if ('narrow' in options && options.narrow) {
      const m = f.compiled.movements.find((m) => m.id === `${f.second.id}#1>${f.short.id}#0`)!;
      expect(isLaneDrop(f.compiled, m)).toBe(true);
    }
    f.changes.propose(0, f.compiled.lanes[f.source]!, 0, true);
    let selected = -1;
    f.changes.resolve(0, (_id, lane) => {
      selected = lane;
    });
    expect(selected).toBe(passes ? f.other : -1);
  },
);
