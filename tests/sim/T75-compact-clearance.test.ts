import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { createCompactClaims } from '../../src/sim/compact-claims';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { setup } from './fixtures';

function fixture(continuation = false, walking = false) {
  const { city, node, road, place } = buildCity('Compact rail clearance claim', 147);
  const a = node(0, 0),
    b = node(8, 0);
  if (!continuation) a.control = 'stop';
  const before = road(node(-100, 0), a),
    compact = road(a, b),
    after = road(b, node(150, 0), { lanes: 2 }),
    north = road(node(8, -100), b),
    south = road(b, node(8, 100));
  if (!walking) before.crossings = { end: false };
  after.crossings = { start: false };
  compact.crossings = { start: false, end: false };
  road(a, node(0, 100));
  city.junctionGroups = {
    'jg:100': {
      id: 'jg:100',
      nodes: [a.id, b.id],
      innerRoads: [compact.id],
      signal: null,
      provenance: { source: 'generated' },
    },
  };
  city.nextId = 101;
  place('Work', 'work', { x: 140, y: 10 }, [{ road: after, direction: 'in', positionM: 100 }]);
  city.rail = operatingCrossing().rail;
  const c = setup(city);
  c.rail!.facilities = setup(operatingCrossing()).rail!.facilities;
  const lane = (id: string, ordinal = 0) => c.index.lane.get(`${id}#${ordinal}`)!;
  const entryLane = lane(before.id),
    middle = lane(compact.id),
    receiver = lane(after.id),
    adjacent = lane(after.id, 1);
  const move = (from: number, to: number) =>
    c.movements.find((m) => m.fromLane === from && m.toLane === to)!;
  const entry = move(entryLane, middle),
    exit = move(middle, receiver),
    rival = move(lane(north.id), lane(south.id));
  expect(exit.conflicts).toContain(rival.idx);
  const stop = c.lanes[entryLane]!.lengthM - 3;
  c.rail!.facilities![0]!.stops = [{ lane: entryLane, stopM: stop }];
  c.rail!.facilities![0]!.spans = [{ segment: middle, fromM: 0, toM: c.lanes[middle]!.lengthM }];
  const v = createVehicles(4, c.lanes.length, c.movements.length);
  v.state.fill(DRIVING);
  v.speedFactor.fill(1);
  v.insert(0, entryLane, stop - 1);
  v.movement[0] = entry.idx;
  v.route[0] = {
    roads: [c.lanes[entryLane]!.road, c.lanes[middle]!.road, c.lanes[receiver]!.road],
    movements: [entry.idx, exit.idx],
    targetLanes: [[entryLane], [middle], [receiver, adjacent]],
    costS: 1,
  };
  const grants = new Int32Array(4).fill(-1);
  let available = true;
  if (walking)
    c.walk.links[0]!.crossing = {
      road: c.lanes[entryLane]!.road,
      end: 'end',
      control: 'zebra',
      node: entry.node,
      arm: 0,
      spans: [{ lane: entryLane, atM: stop + 1, halfM: 1, linkM: 0, linkHalfM: 1 }],
    };
  const claims = createCompactClaims(c, v, DEFAULT_SIM_PARAMS, {
    grants,
    continuations: c.movements.map((m) => {
      const node = c.nodes[m.node]!;
      return (
        node.control === 'uncontrolled' &&
        !node.signal &&
        m.conflicts.length === 0 &&
        m.turn !== 'merge' &&
        !m.neverGreen &&
        !m.turnOnRed
      );
    }),
    nextMovement: (id, _lane, step) => v.route[id]?.movements[step] ?? -1,
    available: () => available,
  });
  claims.update(0);
  return {
    c,
    v,
    claims,
    grants,
    entry,
    exit,
    rival,
    receiver,
    middle,
    adjacent,
    setAvailable: (value: boolean) => {
      available = value;
    },
  };
}

test('T75 a compact clearance claim excludes a later rival and only the needed receiving prefix', () => {
  const { v, claims, entry, rival, receiver, adjacent, middle } = fixture();
  claims.secure(0, entry);
  expect(claims.held(0)).toBe(true);
  expect(claims.allowsMovement(1, rival)).toBe(false);
  expect(claims.allowsLane(1, receiver, 5, 4.5)).toBe(false);
  expect(claims.allowsLane(1, middle, 5, 4.5)).toBe(false);
  expect(claims.allowsLane(1, receiver, 30, 4.5)).toBe(true);
  expect(claims.allowsLane(1, adjacent, 5, 4.5)).toBe(true);
  expect(v.movement[0]).toBe(entry.idx);
});

test.each(['body', 'grant', 'receiver', 'rail'] as const)(
  'T75 an existing %s prevents the optional compact claim',
  (kind) => {
    const { c, v, claims, grants, entry, rival, receiver, setAvailable } = fixture();
    if (kind === 'body') v.insert(1, -rival.idx - 1, rival.lengthM / 2);
    if (kind === 'grant') {
      v.insert(1, rival.fromLane, c.lanes[rival.fromLane]!.stopM - 1);
      grants[1] = rival.idx;
    }
    if (kind === 'receiver') v.insert(1, receiver, 5);
    if (kind === 'rail') setAvailable(false);
    claims.secure(0, entry);
    expect(claims.held(0)).toBe(false);
    expect(claims.allowsMovement(1, rival)).toBe(true);
  },
);

test('T75 compact claims release on cancellation, changed route and deadline before entry', () => {
  const { claims, v, entry, rival } = fixture();
  claims.secure(0, entry);
  claims.cancel(0);
  expect(claims.allowsMovement(1, rival)).toBe(true);
  claims.secure(0, entry);
  v.route[0] = { ...v.route[0]! };
  claims.update(0.1);
  expect(claims.held(0)).toBe(false);
  claims.secure(0, entry);
  claims.update(1000);
  expect(claims.held(0)).toBe(false);
});

test('T75 a compact claim survives the real link handoff then releases promptly after full rail clearance', () => {
  const { claims, v, entry, middle, exit, receiver, rival } = fixture();
  claims.secure(0, entry);
  v.remove(0);
  v.insert(0, middle, 0);
  v.routeStep[0] = 1;
  v.movement[0] = exit.idx;
  claims.update(0.1);
  expect(claims.held(0)).toBe(true);
  v.remove(0);
  v.insert(0, receiver, 10);
  v.routeStep[0] = 2;
  claims.update(0.2);
  expect(claims.held(0)).toBe(false);
  expect(claims.allowsMovement(1, rival)).toBe(true);
});

test('T75 a logical continuation into the transit lane remains ordinary and unsupported', () => {
  const { claims, entry, receiver } = fixture(true);
  claims.secure(0, entry);
  expect(claims.held(0)).toBe(false);
  expect(claims.allowsLane(1, receiver, 0, 4.5)).toBe(true);
});

test.each(['entry-red', 'exit-red', 'short-green'] as const)(
  'T75 %s cannot secure an optional compact claim',
  (kind) => {
    const { c, claims, entry, exit } = fixture();
    for (const movement of [entry, exit]) {
      c.nodes[movement.node]!.control = 'signal';
      c.nodes[movement.node]!.signal = {
        offsetS: 0,
        amberS: 3,
        allRedS: 1,
        cycleS: 34,
        phases: [{ durationS: 30, movements: [movement.idx], walk: [] }],
      };
    }
    if (kind === 'entry-red') c.nodes[entry.node]!.signal!.offsetS = 31;
    if (kind === 'exit-red') c.nodes[exit.node]!.signal!.offsetS = 31;
    if (kind === 'short-green') claims.update(29);
    claims.secure(0, entry);
    expect(claims.held(0)).toBe(false);
  },
);

test('T75 an eligible green window is bounded and expiry releases a car still before entry', () => {
  const { c, claims, entry, exit, receiver } = fixture();
  for (const movement of [entry, exit]) {
    c.nodes[movement.node]!.control = 'signal';
    c.nodes[movement.node]!.signal = {
      offsetS: 0,
      amberS: 3,
      allRedS: 1,
      cycleS: 34,
      phases: [{ durationS: 30, movements: [movement.idx], walk: [] }],
    };
  }
  claims.secure(0, entry);
  expect(claims.held(0)).toBe(true);
  claims.update(29);
  expect(claims.held(0)).toBe(false);
  expect(claims.allowsLane(1, receiver, 0, 4.5)).toBe(true);
});

test('T75 an intervening pedestrian crossing stays ordinary and is not claimed', () => {
  const { claims, entry } = fixture(false, true);
  claims.secure(0, entry);
  expect(claims.held(0)).toBe(false);
});

test('T75 compact receiving storage includes the actual long vehicle body', () => {
  const { claims, v, entry, receiver } = fixture();
  v.vclass[0] = 2;
  claims.secure(0, entry);
  expect(claims.held(0)).toBe(true);
  expect(claims.allowsLane(1, receiver, 15, 4.5)).toBe(false);
  expect(claims.allowsLane(1, receiver, 20, 4.5)).toBe(true);
});
