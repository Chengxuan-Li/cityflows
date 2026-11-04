import { expect, test } from 'vitest';
import { createEditor } from '../../src/editor';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { bypass } from '../../src/fixtures/bypass';
import { buildCity } from '../../src/fixtures/build-city';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { createRerouter, vehicleRouteRequest } from '../../src/sim/reroute';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { patchChanges, remapRoute } from '../../src/sim/patch';
import { patchSignals, updateSignals, GREEN, AMBER } from '../../src/sim/signals';
import { createLinkCosts } from '../../src/sim/link-costs';
import type { CompiledCity } from '../../src/network';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';

function assertConserved(
  engine: ReturnType<typeof createEngine>,
  city: CompiledCity,
  total: number,
) {
  expect(Object.values(engine.metrics().trips).reduce((a, b) => a + b)).toBe(total);
  for (const field of engine.snapshot().lane) {
    expect(field >= 0 ? city.lanes[field] : city.movements[-field - 1]).toBeDefined();
  }
}

test('T19 patches a turn ban without resetting the clock, trips or vehicle identity', () => {
  const city = grid5x5();
  const editor = createEditor(city);
  const engine = createEngine();
  const requests = trips(city, 60).map((trip) => ({ ...trip, departS: 28800 }));
  engine.load({
    compiled: editor.compiled,
    trips: requests,
    scenario: { ...scenario(), startS: 28800, endS: 32400 },
  });
  engine.step();
  const before = engine.inspect(1)!;
  const movement = editor.compiled.movements[before.route!.movements[0]!]!;
  const from = editor.compiled.lanes[movement.fromLane]!;
  const to = editor.compiled.lanes[movement.toLane]!;
  const result = editor.apply({
    kind: 'setTurnRule',
    nodeId: editor.compiled.nodes[movement.node]!.id,
    rule: {
      from: city.roads[editor.compiled.roads[from.road]!.id]!.id,
      to: editor.compiled.roads[to.road]!.id,
      allowed: false,
      provenance: { source: 'authored' },
    },
  });
  expect(result.ok).toBe(true);
  const time = engine.timeS;
  const patch = engine.patch(editor.compiled);
  expect(patch).toMatchObject({ version: editor.city.version, relocated: 0, stranded: 0 });
  expect(patch.rerouted).toBeGreaterThan(0);
  expect(engine.timeS).toBe(time);
  expect(engine.inspect(1)).toMatchObject({
    id: before.id,
    departedS: before.departedS,
    routeReason: 'edit',
  });
  assertConserved(engine, editor.compiled, requests.length);
  engine.step(600);
  assertConserved(engine, editor.compiled, requests.length);
});

test.each(['lane drop', 'delete'] as const)(
  'T19 %s under a car conserves trips and reports its physical outcome',
  (kind) => {
    const city = grid5x5();
    const home = Object.values(city.places)[0]!;
    const connector = home.connectors.find((c) => c.direction === 'out')!;
    const road = city.roads[connector.roadId]!;
    road.lanes.push(structuredClone(road.lanes[0]!));
    connector.lane = 1;
    const editor = createEditor(city);
    const engine = createEngine();
    const requests = trips(city, 20).map((trip) => ({ ...trip, departS: 28800 }));
    engine.load({
      compiled: editor.compiled,
      trips: requests,
      scenario: { ...scenario(), startS: 28800, endS: 32400 },
    });
    engine.step();
    expect(engine.snapshot().count).toBe(1);
    expect(
      editor.apply(
        kind === 'lane drop'
          ? { kind: 'setRoadLanes', roadId: road.id, lanes: [road.lanes[0]!] }
          : { kind: 'deleteRoad', roadId: road.id },
      ).ok,
    ).toBe(true);
    expect(engine.patch(editor.compiled)).toMatchObject(
      kind === 'lane drop' ? { relocated: 1, stranded: 0 } : { relocated: 0, stranded: 1 },
    );
    assertConserved(engine, editor.compiled, requests.length);
    engine.step(600);
    assertConserved(engine, editor.compiled, requests.length);
    if (kind === 'delete') expect(engine.metrics().failedByReason.no_origin_connector).toBe(19);
  },
);

test('T19 patches at identical steps are deterministic and differ only after the edit', () => {
  const city = grid5x5();
  const editor = createEditor(city);
  const engines = [createEngine(), createEngine(), createEngine()];
  for (const engine of engines)
    engine.load({ compiled: editor.compiled, trips: trips(city, 80), scenario: scenario() });
  for (let i = 0; i < 100; i++) {
    engines.forEach((engine) => engine.step());
    expect(engines.map((engine) => engine.stateHash())).toEqual(
      Array(3).fill(engines[0]!.stateHash()),
    );
  }
  expect(editor.apply({ kind: 'setRoadAttributes', roadId: 'r:26', speedLimitMps: 1 }).ok).toBe(
    true,
  );
  expect(engines[0]!.patch(editor.compiled)).toEqual(engines[1]!.patch(editor.compiled));
  let differs = false;
  for (let i = 0; i < 600; i++) {
    engines.forEach((engine) => engine.step());
    expect(engines[0]!.stateHash()).toBe(engines[1]!.stateHash());
    differs ||= engines[0]!.stateHash() !== engines[2]!.stateHash();
    assertConserved(engines[0]!, editor.compiled, 80);
  }
  expect(differs).toBe(true);
});

test('T19 edit checks are staggered, bypass the congestion cap and leave unrelated vehicles alone', () => {
  const city = bypass();
  const editor = createEditor(city);
  const before = editor.compiled;
  const vehicles = createVehicles(202, before.lanes.length, before.movements.length);
  const motorway = before.roads.find((road) => road.roadClass === 'motorway')!;
  const incoming = before.movements.find(
    (movement) => before.lanes[movement.toLane]!.road === motorway.idx,
  )!;
  const costs = freeFlowLinkCosts(before);
  const provider = createRouteProvider();
  const checked: number[] = [];
  const policy = createRerouter(
    before,
    vehicles,
    { ...DEFAULT_SIM_PARAMS, maxReplans: 0 },
    {
      route(compiled, costs, request) {
        checked.push(request.seed);
        return provider.route(compiled, costs, request);
      },
    },
    costs,
  );
  for (let id = 0; id < vehicles.count; id++) {
    vehicles.state[id] = DRIVING;
    vehicles.lane[id] =
      id === 200
        ? before.connectors[1]!.lane
        : id === 201
          ? incoming.fromLane
          : before.connectors[0]!.lane;
    vehicles.position[id] = id === 201 ? before.lanes[incoming.fromLane]!.lengthM - 5 : 5;
    vehicles.destination[id] = 1;
    vehicles.routeSeed[id] = id;
    vehicles.speedFactor[id] = 1;
    const route = provider.route(
      before,
      costs,
      vehicleRouteRequest(
        vehicles,
        DEFAULT_SIM_PARAMS,
        id,
        vehicles.lane[id]!,
        vehicles.position[id]!,
      ),
    );
    if (!route.ok) throw new Error(route.reason);
    vehicles.route[id] = route.route;
  }
  expect(
    editor.apply({
      kind: 'setTurnRule',
      nodeId: before.nodes[incoming.node]!.id,
      rule: {
        from: before.roads[before.lanes[incoming.fromLane]!.road]!.id,
        to: motorway.id,
        allowed: false,
        provenance: { source: 'authored' },
      },
    }).ok,
  ).toBe(true);
  const next = editor.compiled;
  const changes = patchChanges(before, next);
  for (let id = 0; id < vehicles.count; id++)
    vehicles.route[id] = remapRoute(vehicles.route[id]!, changes);
  const untouched = structuredClone(vehicles.route[200]);
  policy.patch(next);
  costs.roadTravelTimeS = freeFlowLinkCosts(next).roadTravelTimeS;
  costs.version++;
  const affected = vehicles.route.flatMap((route, id) =>
    route!.movements.includes(-1) ? [id] : [],
  );
  expect(affected).toEqual([...Array.from({ length: 200 }, (_, id) => id), 201]);
  for (const id of affected)
    policy.scheduleEdit(id, 28800, true, vehicles.route[id]!.movements[0] === -1);
  // Another edit cannot push an existing check beyond the original interval.
  policy.scheduleEdit(0, 28860, true, false);
  const times: number[] = [];
  for (let tick = 0; tick <= 1200; tick++) {
    const start = checked.length;
    policy.updateEdits(28800 + tick / 10, () => times.push(tick / 10));
    if (tick === 0) expect(checked).toEqual([201]);
    expect(checked.length - start).toBeLessThanOrEqual(20);
  }
  expect(new Set(checked)).toEqual(new Set(affected));
  expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(110);
  expect(vehicles.route[200]).toEqual(untouched);
});

test('T19 changed signal restarts at patch time and shortened green ends next', () => {
  const editor = createEditor(grid5x5());
  const before = editor.compiled;
  const source = Object.values(editor.city.nodes).find((node) => node.signal)!;
  const signal = structuredClone(source.signal!);
  signal.phases[0]!.durationS = 5;
  expect(editor.apply({ kind: 'setSignal', nodeId: source.id, signal }).ok).toBe(true);
  const compiled = patchSignals(before, editor.compiled, 28813, new Map());
  const movement =
    compiled.nodes[compiled.index.node.get(source.id)!]!.signal!.phases[0]!.movements[0]!;
  const colors = new Uint8Array(compiled.movements.length);
  updateSignals(compiled, 28813, colors);
  expect(colors[movement]).toBe(GREEN);
  updateSignals(compiled, 28818, colors);
  expect(colors[movement]).toBe(AMBER);
});

test('T19 road observations survive index changes and new roads start at free flow', () => {
  const editor = createEditor(grid5x5());
  const before = editor.compiled;
  const observed = createLinkCosts(before, DEFAULT_SIM_PARAMS, 0);
  const road = before.roads.at(-1)!;
  observed.record(road.idx, 50, road.lengthM);
  expect(editor.apply({ kind: 'deleteRoad', roadId: before.roads[0]!.id }).ok).toBe(true);
  observed.patch(editor.compiled);
  observed.update(60);
  const index = editor.compiled.index.road.get(road.id)!;
  expect(observed.costs.roadTravelTimeS[index]).toBeCloseTo(
    (0.7 * road.lengthM) / road.speedLimitMps + 0.3 * 50,
  );
  expect(observed.costs.version).toBe(2);
});

test('T19 a deferred broken route never exposes missing indices to inspection', () => {
  const editor = createEditor(grid5x5());
  const engine = createEngine();
  engine.load({ compiled: editor.compiled, trips: trips(editor.city, 1), scenario: scenario() });
  engine.step();
  const before = engine.inspect(1)!;
  const movement = editor.compiled.movements[before.route!.movements[3]!]!;
  const from = editor.compiled.roads[editor.compiled.lanes[movement.fromLane]!.road]!.id;
  const to = editor.compiled.roads[editor.compiled.lanes[movement.toLane]!.road]!.id;
  expect(
    editor.apply({
      kind: 'setTurnRule',
      nodeId: editor.compiled.nodes[movement.node]!.id,
      rule: { from, to, allowed: false, provenance: { source: 'authored' } },
    }).ok,
  ).toBe(true);
  expect(engine.patch(editor.compiled).rerouted).toBe(1);
  const pending = engine.inspect(1)!;
  expect(pending.routeReason).toBe('initial');
  expect(
    pending.route?.movements.every((i) => editor.compiled.movements[i] !== undefined) ?? true,
  ).toBe(true);
  engine.step(600);
  assertConserved(engine, editor.compiled, 1);
});

test('T19 a changed junction releases approach permission while an occupied movement survives', () => {
  const { city, node, road, place } = buildCity('Grant patch', 1);
  const junction = node(120, 0);
  const incoming = road(node(0, 0), junction);
  const outgoing = road(junction, node(240, 0));
  const crossIn = road(node(120, -120), junction);
  const crossOut = road(junction, node(120, 120));
  place('Home', 'residential', { x: 10, y: 10 }, [{ road: incoming, direction: 'out' }]);
  place('Work', 'work', { x: 220, y: 10 }, [{ road: outgoing, direction: 'in', positionM: 90 }]);
  junction.control = 'signal';
  junction.signal = {
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [
      { durationS: 1000, groups: [{ from: incoming.id, to: outgoing.id }] },
      { durationS: 20, groups: [{ from: crossIn.id, to: crossOut.id }] },
    ],
  };
  const editor = createEditor(city);
  const engine = createEngine();
  engine.load({ compiled: editor.compiled, trips: trips(city, 1), scenario: scenario() });
  do {
    engine.step();
  } while (engine.inspect(1)!.positionM < 95);
  expect(engine.inspect(1)!.lane).toBeGreaterThanOrEqual(0);
  const signal = structuredClone(junction.signal);
  signal.phases.reverse();
  expect(editor.apply({ kind: 'setSignal', nodeId: junction.id, signal }).ok).toBe(true);
  engine.patch(editor.compiled);
  engine.step(100);
  expect(engine.inspect(1)!.lane).toBeGreaterThanOrEqual(0);
  expect(engine.inspect(1)!.speedMps).toBeLessThan(0.5);
  for (let i = 0; i < 400 && engine.inspect(1)!.lane >= 0; i++) engine.step();
  const onMovement = engine.inspect(1)!;
  expect(onMovement.lane).toBeLessThan(0);
  const movementId = editor.compiled.movements[-onMovement.lane - 1]!.id;
  expect(
    editor.apply({
      kind: 'setTurnRule',
      nodeId: junction.id,
      rule: {
        from: crossIn.id,
        to: crossOut.id,
        allowed: false,
        provenance: { source: 'authored' },
      },
    }).ok,
  ).toBe(true);
  engine.patch(editor.compiled);
  const surviving = engine.inspect(1)!;
  expect(editor.compiled.movements[-surviving.lane - 1]!.id).toBe(movementId);
  expect(surviving.positionM).toBe(onMovement.positionM);
  expect(surviving.speedMps).toBe(onMovement.speedMps);
  engine.step(600);
  expect(engine.metrics().trips.completed).toBe(1);
});

test('T19 adding a shortcut schedules only routes touching its junctions', () => {
  const editor = createEditor(grid5x5());
  const engine = createEngine();
  engine.load({ compiled: editor.compiled, trips: trips(editor.city, 40), scenario: scenario() });
  engine.step(60);
  const before = editor.compiled;
  const detail = engine.inspect(1)!;
  const current = before.roads[before.lanes[detail.lane]!.road]!;
  const target = before.roads[detail.route!.roads[3]!]!;
  const template = editor.city.roads[current.id]!;
  expect(
    editor.apply({
      kind: 'addRoad',
      newNodes: [],
      road: {
        ...template,
        from: before.nodes[current.to]!.id,
        to: before.nodes[target.to]!.id,
        centerline: [before.nodes[current.to]!.pos, before.nodes[target.to]!.pos],
        streetGroupId: null,
        speedLimitMps: 30,
      },
    }).ok,
  ).toBe(true);
  const patch = engine.patch(editor.compiled);
  expect(patch).toMatchObject({ relocated: 0, stranded: 0 });
  expect(patch.rerouted).toBeGreaterThan(0);
  assertConserved(engine, editor.compiled, 40);
  engine.step(600);
  assertConserved(engine, editor.compiled, 40);
});

test('T19 losing a destination connector fails cleanly without corrupting remaining traffic', () => {
  const city = grid5x5();
  const editor = createEditor(city);
  const engine = createEngine();
  engine.load({ compiled: setup(city), trips: trips(city, 30), scenario: scenario() });
  engine.step(50);
  const destination = Object.values(city.places)[1]!;
  expect(editor.apply({ kind: 'setConnectors', placeId: destination.id, connectors: [] }).ok).toBe(
    true,
  );
  const patch = engine.patch(editor.compiled);
  expect(patch.stranded).toBe(0);
  engine.step(600);
  assertConserved(engine, editor.compiled, 30);
  expect(engine.metrics().trips.failed).toBe(30);
});

test('T19 moving an occupied arrival portal resumes driving without teleporting its queue', () => {
  const { city, node, road, place } = buildCity('Move arrival', 1);
  const link = road(node(0, 0), node(250, 0));
  place('Home', 'residential', { x: 0, y: 10 }, [{ road: link, direction: 'out', positionM: 5 }]);
  place('Work', 'work', { x: 200, y: 10 }, [{ road: link, direction: 'in', positionM: 80 }]);
  const work = Object.values(city.places)[1]!;
  work.capacity = 1;
  const editor = createEditor(city);
  const engine = createEngine();
  engine.load({ compiled: editor.compiled, trips: trips(city, 2), scenario: scenario() });
  engine.step(600);
  const before = engine.inspect(2)!;
  expect(before.state).toBe('queued_destination');
  expect(
    editor.apply({
      kind: 'setConnectors',
      placeId: work.id,
      connectors: work.connectors.map((c) => ({ ...c, positionM: 180 })),
    }).ok,
  ).toBe(true);
  engine.patch(editor.compiled);
  engine.step();
  const after = engine.inspect(2)!;
  expect(after.state).toBe('driving');
  expect(after.positionM - before.positionM).toBeLessThan(1);
  engine.step(600);
  expect(engine.inspect(2)).toMatchObject({ state: 'queued_destination', positionM: 180 });
  assertConserved(engine, editor.compiled, 2);
});

test('T19 removing green permission invalidates a surviving movement without hysteresis', () => {
  const { city, node, road, place } = buildCity('Signal detour', 1);
  const junction = node(120, 0);
  const merge = node(240, 0);
  const via = node(120, 100);
  const incoming = road(node(0, 0), junction);
  const direct = road(junction, merge);
  const detour = road(junction, via);
  road(via, merge);
  const destination = road(merge, node(360, 0));
  place('Home', 'residential', { x: 5, y: 10 }, [{ road: incoming, direction: 'out' }]);
  place('Work', 'work', { x: 350, y: 10 }, [{ road: destination, direction: 'in', positionM: 90 }]);
  junction.control = 'signal';
  junction.signal = {
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [
      { durationS: 1000, groups: [{ from: incoming.id, to: direct.id }] },
      { durationS: 30, groups: [{ from: incoming.id, to: detour.id }] },
    ],
  };
  const editor = createEditor(city);
  const engine = createEngine();
  engine.load({ compiled: editor.compiled, trips: trips(city, 1), scenario: scenario() });
  engine.step();
  expect(engine.inspect(1)!.route!.roads).toContain(editor.compiled.index.road.get(direct.id));
  expect(
    editor.apply({
      kind: 'setSignal',
      nodeId: junction.id,
      signal: { ...junction.signal, phases: [junction.signal.phases[1]!] },
    }).ok,
  ).toBe(true);
  engine.patch(editor.compiled);
  expect(engine.inspect(1)!.routeReason).toBe('edit');
  engine.step(1200);
  expect(engine.metrics().trips.completed).toBe(1);
});

test('T19 a projected car with no onward route fails cleanly instead of following a missing road', () => {
  const { city, node, road, place } = buildCity('Disconnected projection', 1);
  const junction = node(200, 0);
  const incoming = road(node(0, 0), junction, { lanes: 2 });
  const outgoing = road(junction, node(400, 0));
  road(node(0, 3), node(200, 3), { lanes: 2 });
  place('Home', 'residential', { x: 5, y: 10 }, [
    { road: incoming, direction: 'out', positionM: 20 },
  ]);
  place('Work', 'work', { x: 350, y: 10 }, [{ road: outgoing, direction: 'in', positionM: 90 }]);
  const editor = createEditor(city);
  const engine = createEngine();
  engine.load({ compiled: editor.compiled, trips: trips(city, 1), scenario: scenario() });
  engine.step();
  expect(editor.apply({ kind: 'deleteRoad', roadId: incoming.id }).ok).toBe(true);
  expect(engine.patch(editor.compiled)).toMatchObject({ relocated: 1, stranded: 0 });
  expect(() => engine.step()).not.toThrow();
  expect(engine.inspect(1)).toMatchObject({
    state: 'failed',
    failReason: 'destination_unreachable',
  });
  assertConserved(engine, editor.compiled, 1);
});

test('T19 an unrelated edit preserves an approach grant for a turn on red', () => {
  const { city, node, road, place } = buildCity('Red grant patch', 1);
  const junction = node(100, 0);
  const incoming = road(node(0, 0), junction);
  const exit = road(junction, node(100, 100));
  const cross = road(node(100, -100), junction);
  place('Home', 'residential', { x: 5, y: 5 }, [{ road: incoming, direction: 'out' }]);
  place('Work', 'work', { x: 105, y: 90 }, [{ road: exit, direction: 'in', positionM: 60 }]);
  junction.control = 'signal';
  junction.signal = {
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    turnOnRed: true,
    phases: [{ durationS: 1000, groups: [{ from: cross.id, to: exit.id }] }],
  };
  const editor = createEditor(city);
  const engines = [createEngine(), createEngine()];
  for (const engine of engines)
    engine.load({ compiled: editor.compiled, trips: trips(city, 1), scenario: scenario() });
  let movingOnRed = false;
  for (let i = 0; i < 1000; i++) {
    engines.forEach((engine) => engine.step());
    const car = engines[0]!.inspect(1)!;
    if (car.lane >= 0 && car.waitingS >= 1 && car.speedMps > 0) {
      movingOnRed = true;
      break;
    }
  }
  expect(movingOnRed).toBe(true);
  expect(
    editor.apply({ kind: 'setRoadAttributes', roadId: cross.id, name: 'Cross street' }).ok,
  ).toBe(true);
  engines[0]!.patch(editor.compiled);
  for (let i = 0; i < 30; i++) {
    engines.forEach((engine) => engine.step());
    expect(engines[0]!.stateHash()).toBe(engines[1]!.stateHash());
  }
});

test('T19 a split preserves the car downstream of the retained road id by projection', () => {
  const city = grid5x5();
  const editor = createEditor(city);
  const engine = createEngine();
  engine.load({ compiled: editor.compiled, trips: trips(city, 1), scenario: scenario() });
  engine.step(80);
  const before = engine.inspect(1)!;
  expect(before.lane).toBeGreaterThanOrEqual(0);
  const road = editor.compiled.roads[editor.compiled.lanes[before.lane]!.road]!;
  expect(before.positionM).toBeGreaterThan(35);
  expect(editor.apply({ kind: 'splitRoad', roadId: road.id, atM: 30 }).ok).toBe(true);
  const point = engine.snapshot();
  expect(engine.patch(editor.compiled)).toMatchObject({ relocated: 1, stranded: 0 });
  const after = engine.snapshot();
  expect(Math.hypot(after.x[0]! - point.x[0]!, after.y[0]! - point.y[0]!)).toBeLessThanOrEqual(4);
  engine.step(600);
  assertConserved(engine, editor.compiled, 1);
});
