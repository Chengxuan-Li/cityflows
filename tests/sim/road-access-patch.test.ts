import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { bypass } from '../../src/fixtures/bypass';
import { createEditor } from '../../src/editor';
import { compile } from '../../src/network';
import { patchChanges } from '../../src/sim/patch';
import { createEngine } from '../../src/sim/engine';
import { scenario, trips } from './fixtures';

test('access edits invalidate changed roads and roads whose local zone changes', () => {
  const { city, node, road } = buildCity('Joined local zones', 1);
  const a = node(0, 0),
    b = node(100, 0),
    c = node(200, 0),
    d = node(300, 0);
  const first = road(a, b),
    bridge = road(b, c),
    last = road(c, d);
  first.access = last.access = { all: 'destination' };
  const before = compile(city);
  if (!before.ok) throw new Error('invalid fixture');
  bridge.access = { all: 'private' };
  city.version++;
  const after = compile(city);
  if (!after.ok) throw new Error('invalid edit');
  const changes = patchChanges(before.compiled, after.compiled);
  expect(changes.changedRoads.has(before.compiled.index.road.get(bridge.id)!)).toBe(true);
  expect(changes.changedRoads.has(before.compiled.index.road.get(last.id)!)).toBe(true);
  expect(changes.changedRoads.has(before.compiled.index.road.get(first.id)!)).toBe(false);
});

test.each(['destination', 'private'] as const)(
  'a missed turn cannot enter an unrelated %s zone as a fallback',
  (rule) => {
    const { city, node, road, place } = buildCity('Restricted missed-turn exit', 1);
    const center = node(0, 0),
      north = node(0, -100),
      south = node(0, 100);
    const approach = road(node(-100, 0), center, { lanes: 2 });
    const left = road(center, north);
    road(center, node(100, 0), { lanes: 2 });
    const destination = road(north, node(0, -200));
    const restricted = road(center, south);
    restricted.access = { all: rule };
    const corner = node(100, -100);
    road(south, corner, { via: [{ x: 100, y: 100 }] });
    road(corner, north);
    place('Homes', 'residential', { x: -80, y: 10 }, [
      { road: approach, lane: 1, positionM: 80, direction: 'out' },
    ]);
    place('Office', 'work', { x: 10, y: -170 }, [
      { road: destination, direction: 'in', positionM: 65 },
    ]);
    place('Blocker', 'residential', { x: -20, y: -10 }, [
      { road: approach, positionM: 80, direction: 'out' },
    ]);
    place('Full lot', 'work', { x: -10, y: -10 }, [
      { road: approach, positionM: 85, direction: 'in' },
    ]);
    const [, , blockerOrigin, blockerDestination] = Object.values(city.places);
    blockerDestination!.events = [
      { id: 'open', name: 'Open', startS: 180, durationS: 1, arrivals: 1, departures: 0 },
    ];
    const result = compile(city);
    if (!result.ok) throw new Error('Invalid fixture');
    const compiled = result.compiled,
      engine = createEngine(),
      [trip] = trips(city, 1);
    engine.load({
      compiled,
      scenario: { ...scenario(), simParams: { laneChangeDistanceM: 10 } },
      trips: [
        { ...trip!, departS: 110 },
        {
          ...trip!,
          id: 'blocker',
          originPlaceId: blockerOrigin!.id,
          destinationPlaceId: blockerDestination!.id,
        },
      ],
    });
    engine.step(101);
    const initial = engine.inspect(1)!;
    expect(initial.route!.roads.map((i) => compiled.roads[i]!.id)).toContain(left.id);
    expect(engine.inspect(2)!.state).toBe('queued_destination');
    for (let i = 0; i < 2000; i++) {
      engine.step();
      const detail = engine.inspect(1)!;
      const lane = detail.lane < 0 ? compiled.movements[-detail.lane - 1]!.toLane : detail.lane;
      expect(compiled.roads[compiled.lanes[lane]!.road]!.id).not.toBe(restricted.id);
      if (detail.state === 'completed' || detail.state === 'failed') break;
    }
    expect(engine.inspect(1)!.state).toBe('completed');
  },
);

test('live access bans force a slower legal detour despite congestion hysteresis', () => {
  const city = bypass();
  const editor = createEditor(city);
  const engine = createEngine();
  engine.load({ compiled: editor.compiled, trips: trips(city, 1), scenario: scenario() });
  engine.step();
  const before = engine.inspect(1)!;
  const expressway = Object.values(city.roads).find((r) => r.roadClass === 'motorway')!;
  const closed = editor.compiled.index.road.get(expressway.id)!;
  expect(before.route!.roads).toContain(closed);
  expect(
    editor.apply({ kind: 'setRoadAccess', roadId: expressway.id, access: { all: 'no' } }).ok,
  ).toBe(true);
  expect(engine.patch(editor.compiled).rerouted).toBe(1);
  engine.step(200);
  const after = engine.inspect(1)!;
  expect(after.route!.roads).not.toContain(closed);
  expect(after.routeReason).toBe('edit');
  expect(after.id).toBe(before.id);
  expect(after.departedS).toBe(before.departedS);
});

test('a car already in an edited local zone keeps a legal route out', () => {
  const city = bypass();
  const editor = createEditor(city);
  const engine = createEngine();
  engine.load({ compiled: editor.compiled, trips: trips(city, 1), scenario: scenario() });
  engine.step();
  const before = engine.inspect(1)!;
  expect(
    editor.apply({
      kind: 'batch',
      label: 'Local zone',
      commands: Object.values(city.roads).map((road) => ({
        kind: 'setRoadAccess',
        roadId: road.id,
        access: { all: 'destination' },
      })),
    }).ok,
  ).toBe(true);
  engine.patch(editor.compiled);
  engine.step();
  expect(engine.inspect(1)).toMatchObject({
    id: before.id,
    state: 'driving',
    routeReason: 'edit',
    route: { roads: before.route!.roads },
  });
});

test('a live closure with no legal replacement fails the trip rather than retaining its route', () => {
  const city = bypass();
  const editor = createEditor(city);
  const engine = createEngine();
  engine.load({ compiled: editor.compiled, trips: trips(city, 1), scenario: scenario() });
  engine.step();
  const roads = Object.values(city.roads).filter(
    (road) => road.roadClass === 'motorway' || road.speedLimitMps === 40 / 3.6,
  );
  expect(
    editor.apply({
      kind: 'batch',
      label: 'Close both paths',
      commands: roads.map((road) => ({
        kind: 'setRoadAccess',
        roadId: road.id,
        access: { all: 'no' },
      })),
    }).ok,
  ).toBe(true);
  engine.patch(editor.compiled);
  engine.step();
  expect(engine.inspect(1)).toMatchObject({ state: 'failed', route: null });
  expect(engine.metrics().trips.failed).toBe(1);
});
