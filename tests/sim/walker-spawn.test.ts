import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile, type CompiledCity } from '../../src/network';
import { createWalkRouter, type WalkRoute } from '../../src/routing/walk';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles } from '../../src/sim/vehicle';
import { createWalkers } from '../../src/sim/walkers';
import { scenario } from './fixtures';

const params = { ...DEFAULT_SIM_PARAMS, walkSpeedMps: 1, dtS: 1 };
const owner = {
  fromPlaceId: 'p:1',
  toPlaceId: 'p:2',
  personId: 'person:1',
  tripId: 'trip:1',
  tripLeg: 'access' as const,
};

function fixture() {
  const { city } = buildCity('Person walk', 1);
  city.walk = { nodes: {}, links: {} };
  for (const [i, pos] of [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 0 },
    { x: 15, y: 10 },
  ].entries()) {
    const id = `wn:${i + 10}`;
    city.walk.nodes[id] = { id, pos, layer: 0, provenance: { source: 'authored' } };
  }
  for (const [i, [a, b]] of [
    [10, 11],
    [11, 12],
    [12, 13],
    [11, 14],
    [14, 12],
  ].entries()) {
    const id = `wl:${i + 20}`,
      from = `wn:${a}`,
      to = `wn:${b}`;
    city.walk.links[id] = {
      id,
      from,
      to,
      line: [city.walk.nodes[from]!.pos, city.walk.nodes[to]!.pos],
      kind: 'footway',
      widthM: null,
      provenance: { source: 'authored' },
    };
  }
  city.nextId = 30;
  const compiled = (input = city) => {
    const result = compile(input);
    if (!result.ok) throw new Error('compile');
    return result.compiled;
  };
  return { city, compiled };
}

function walkers(compiled: CompiledCity, withSources = false) {
  const source = withSources ? [{ fromPlaceId: 'p:1', toPlaceId: 'p:2', perHour: 3600 }] : [];
  return createWalkers(
    compiled,
    { ...scenario(), endS: 105, walkers: source },
    params,
    createVehicles(0, compiled.lanes.length, compiled.movements.length),
    true,
  )!;
}

function path(compiled: CompiledCity): WalkRoute {
  const from = compiled.walk.links.find((link) => link.id.startsWith('wl:20/'))!.idx;
  const to = compiled.walk.links.find((link) => link.id.startsWith('wl:22/'))!.idx;
  const result = createWalkRouter(compiled.walk).route({
    from: { link: from, positionM: 2 },
    to: { link: to, positionM: 4 },
    speedMps: 1,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.route;
}

test('person walkers report their leg and call arrival once, including empty walks', () => {
  const compiled = fixture().compiled();
  const people = walkers(compiled);
  const arrivals: [number, boolean][] = [];
  const id = people.spawn({ ...owner, route: path(compiled), timeS: 100 }, (...args) =>
    arrivals.push(args),
  );
  expect(people.inspect(id)).toMatchObject({
    personId: 'person:1',
    tripId: 'trip:1',
    tripLeg: 'access',
  });
  expect(people.snapshot().tripLeg).toEqual(Uint8Array.of(1));
  for (let t = 100; t <= 130; t++) people.step(t);
  expect(arrivals).toEqual([[121, false]]);
  expect(people.inspect(id)).toMatchObject({ state: 'done', positionM: 4 });
  expect(people.metrics()).toMatchObject({ spawned: 1, completed: 1, active: 0, peakActive: 1 });
  const empty = { links: [], legs: [], lengthM: 0, costS: 0 };
  const next = people.spawn({ ...owner, route: empty, timeS: 131 }, (...args) =>
    arrivals.push(args),
  );
  expect(next).toBe(id + 1);
  expect(arrivals).toEqual([
    [121, false],
    [131, false],
  ]);
  expect(people.inspect(next)).toMatchObject({ state: 'done', arrivedS: 131, link: -1 });
});

test('person ids follow all reserved source ids and leg flags enter only person hashes', () => {
  const compiled = fixture().compiled();
  const testPeople = walkers(compiled, true);
  const plain = walkers(compiled, true);
  plain.step(105);
  const reserved = plain.metrics().spawned;
  expect(reserved).toBeGreaterThan(0);
  const id = testPeople.spawn({ ...owner, route: path(compiled), timeS: 100 }, () => {});
  expect(id).toBe(reserved + 1);
  testPeople.step(105);
  expect(testPeople.inspect(1)).toMatchObject({ personId: null, tripId: null, tripLeg: 'test' });
  const words: number[] = [];
  plain.hash((hash, value) => {
    words.push(value);
    return hash;
  }, 0);
  expect(words).toHaveLength(reserved * 4);
  const otherLeg = walkers(compiled);
  otherLeg.spawn({ ...owner, tripLeg: 'egress', route: path(compiled), timeS: 100 }, () => {});
  const access = walkers(compiled);
  access.spawn({ ...owner, route: path(compiled), timeS: 100 }, () => {});
  const hash = (hash: number, value: number) => Math.imul(hash ^ value, 16777619);
  expect(otherLeg.hash(hash, 0)).not.toBe(access.hash(hash, 0));
});

test('arrival callbacks start a subsequent walk without advancing it in the same step', () => {
  const compiled = fixture().compiled();
  const people = walkers(compiled);
  const route = path(compiled);
  const short = {
    links: [route.legs[0]!.link],
    legs: [{ ...route.legs[0]!, toM: 3 }],
    lengthM: 1,
    costS: 1,
  };
  let next = 0;
  people.spawn({ ...owner, route: short, timeS: 100 }, (timeS) => {
    next = people.spawn({ ...owner, route, timeS }, () => {});
  });
  people.step(100);
  expect(people.inspect(next)).toMatchObject({ state: 'walking', positionM: 2 });
  people.step(101);
  expect(people.inspect(next)).toMatchObject({ positionM: 3 });
});

test('growing walker storage preserves active positions and monotonic ids', () => {
  const compiled = fixture().compiled();
  const people = walkers(compiled);
  const arrivals: number[] = [];
  for (let i = 0; i < 65; i++) {
    expect(
      people.spawn({ ...owner, route: path(compiled), timeS: 100 }, () => arrivals.push(i)),
    ).toBe(i + 1);
  }
  expect(people.snapshot().count).toBe(65);
  people.step(100);
  expect(people.inspect(1)).toMatchObject({ positionM: 3 });
  expect(people.inspect(65)).toMatchObject({ positionM: 3 });
  for (let t = 101; t <= 130; t++) people.step(t);
  expect(arrivals).toHaveLength(65);
  expect(people.metrics()).toMatchObject({ active: 0, peakActive: 65, completed: 65 });
});

test('person walkers wait for an occupied zebra before crossing', () => {
  const { city, node, street } = buildCity('Person crossing', 1);
  const centre = node(0, 0);
  street(node(-100, 0), centre);
  street(centre, node(100, 0));
  street(centre, node(0, -100));
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  const compiled = result.compiled;
  const crossing = compiled.walk.links.find((link) => link.crossing?.control === 'zebra')!;
  const span = crossing.crossing!.spans[0]!;
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  vehicles.insert(0, span.lane, span.atM);
  const people = createWalkers(compiled, scenario(), params, vehicles, true)!;
  const id = people.spawn(
    {
      ...owner,
      timeS: 100,
      route: {
        links: [crossing.idx],
        legs: [{ link: crossing.idx, fromM: 0, toM: crossing.lengthM }],
        lengthM: crossing.lengthM,
        costS: crossing.lengthM,
      },
    },
    () => {},
  );
  people.step(100);
  expect(people.inspect(id)).toMatchObject({ state: 'waiting', crossing: 'zebra' });
  vehicles.remove(0);
  people.step(101);
  expect(people.inspect(id)).toMatchObject({ state: 'crossing', personId: 'person:1' });
  expect(people.metrics().crossings.zebra).toBe(1);
});

test('edits reroute a person to the original partial-link target and report drops', () => {
  const { city, compiled } = fixture();
  const before = compiled();
  const people = walkers(before);
  const arrivals: [number, boolean][] = [];
  const id = people.spawn({ ...owner, route: path(before), timeS: 100 }, (...args) =>
    arrivals.push(args),
  );
  people.step(100);
  delete city.walk!.links['wl:21'];
  people.patch(compiled(), 101);
  expect(people.inspect(id)!.route!.lengthM).toBeGreaterThan(30);
  for (let t = 101; t <= 160; t++) people.step(t);
  expect(arrivals).toHaveLength(1);
  expect(arrivals[0]![1]).toBe(false);
  expect(people.inspect(id)).toMatchObject({ state: 'done', positionM: 4 });

  const dropping = walkers(before);
  const dropped: [number, boolean][] = [];
  const droppedId = dropping.spawn({ ...owner, route: path(before), timeS: 100 }, (...args) =>
    dropped.push(args),
  );
  delete city.walk!.links['wl:20'];
  dropping.patch(compiled(), 102);
  expect(dropping.inspect(droppedId)).toMatchObject({ state: 'dropped' });
  expect(dropped).toEqual([[102, true]]);
  dropping.patch(compiled(), 103);
  expect(dropped).toHaveLength(1);
});

// TASK-178: a live edit that removes a link the walker already walked keeps the walker; the
// next edit crashed remapping that gone leg (T19's live turn ban after a drawn road).
test('a second edit after one removed a walked link keeps the walker and its route', () => {
  const { city, compiled } = fixture();
  const before = compiled();
  const people = walkers(before);
  const arrivals: [number, boolean][] = [];
  const id = people.spawn({ ...owner, route: path(before), timeS: 100 }, (...args) =>
    arrivals.push(args),
  );
  for (let t = 100; t <= 120; t++) people.step(t);
  const last = before.walk.links[people.inspect(id)!.link]!.id;
  expect(last.startsWith('wl:22/')).toBe(true);
  delete city.walk!.links['wl:20'];
  const edited = compiled();
  people.patch(edited, 121);
  delete city.walk!.links['wl:24'];
  const again = compiled();
  people.patch(again, 122);
  const detail = people.inspect(id)!;
  expect(detail.state).toBe('walking');
  expect(detail.route!.links.every((link) => again.walk.links[link] !== undefined)).toBe(true);
  for (let t = 122; t <= 140; t++) people.step(t);
  expect(arrivals).toEqual([[expect.any(Number), false]]);
});
