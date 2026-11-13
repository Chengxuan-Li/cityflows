import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile, type CompiledCity } from '../../src/network';
import { parkingEgress } from '../../src/network/parking-egress';
import { placeConnector, connectCarExits } from '../../src/importers/osm/places';
import { addImplicitGarages } from '../../src/network/parking';
import { createHash } from 'node:crypto';
import { loadAuditCity } from '../../bench/junction-audit';
import { tierCities } from '../tier';
import {
  allocateId,
  type City,
  type Connector,
  type Road,
  type ParkingFacility,
} from '../../src/schema';

function network(trapY = -100) {
  const build = buildCity('Car exits', 124);
  const { node, road } = build;
  const a = node(0, 0),
    b = node(200, 0),
    c = node(200, 200),
    d = node(0, 200);
  const loop = [road(a, b), road(b, c), road(c, d), road(d, a)];
  const start = node(50, trapY),
    end = node(150, trapY);
  const trap = road(start, end);
  const barrier = road(end, b);
  const entry = road(a, start);
  return { ...build, loop, trap, barrier, entry };
}

function garage(city: City, road: Road, shape: ParkingFacility['shape']) {
  const id = allocateId(city, 'pk');
  const facility: ParkingFacility = {
    id,
    kind: 'garage',
    name: null,
    capacity: 40,
    placeId: null,
    access: 'public',
    shape,
    provenance: { source: 'osm' },
    connectors: [
      {
        id: allocateId(city, 'c'),
        roadId: road.id,
        lane: 0,
        positionM: 40,
        direction: 'both',
        throughputPerMin: 30,
      },
    ],
  };
  (city.parking ??= {})[id] = facility;
  return facility;
}

function compiled(city: Parameters<typeof compile>[0]): CompiledCity {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

test.each(['bus', 'private', 'crop'] as const)('T61 departure check rejects a %s trap', (cause) => {
  const { city, place, trap, barrier, loop } = network();
  if (cause === 'bus') barrier.lanes[0]!.allowed = ['bus'];
  if (cause === 'private') barrier.access = { all: 'private' };
  if (cause === 'crop') delete city.roads[barrier.id];
  place('Trapped', 'work', { x: 100, y: -100 }, [{ road: trap, direction: 'both', positionM: 40 }]);
  place('Connected', 'residential', { x: 100, y: 0 }, [
    { road: loop[0]!, direction: 'both', positionM: 40 },
  ]);
  const net = compiled(city),
    exit = parkingEgress(net, 30);
  const trapped = net.places.find((p) => city.places[p.id]!.name === 'Trapped')!;
  const connected = net.places.find((p) => city.places[p.id]!.name === 'Connected')!;
  expect(exit.connectors[trapped.connectorsOut[0]!]).toBe(0);
  expect(exit.connectors[connected.connectorsOut[0]!]).toBe(1);
});

test.each(['bus', 'private', 'crop'] as const)(
  'T61 snapping bypasses a %s trap and the implicit garage follows',
  (cause) => {
    const { city, place, trap, barrier } = network();
    if (cause === 'bus') barrier.lanes[0]!.allowed = ['bus'];
    if (cause === 'private') barrier.access = { all: 'private' };
    if (cause === 'crop') delete city.roads[barrier.id];
    const point = { x: 100, y: -100 };
    const entry = placeConnector(city, compiled(city))(point)!;
    expect(entry.roadId).not.toBe(trap.id);
    place('Work', 'work', point, []);
    const owner = Object.values(city.places)[0]!;
    owner.connectors = [entry];
    addImplicitGarages(city);
    const net = compiled(city),
      exit = parkingEgress(net, 30);
    expect(exit.facilities[0]).toBe(1);
    expect(net.parking[0]!.connectorsOut).toEqual(net.places[0]!.connectorsOut);
  },
);

test('T61 a private road with a car exit retains its connector', () => {
  const { city, trap } = network();
  trap.access = { all: 'private' };
  const entry = placeConnector(city, compiled(city))({ x: 100, y: -100 })!;
  expect(entry.roadId).toBe(trap.id);
});

test('T61 only the direction of a two-way street with a car exit is chosen', () => {
  const { city, road, trap, barrier, loop } = network();
  barrier.lanes[0]!.allowed = ['bus'];
  trap.streetGroupId = 'two-way';
  trap.lateralOffsetM = 1.5;
  const reverse = road(city.nodes[trap.to]!, city.nodes[trap.from]!, { streetGroupId: 'two-way' });
  road(city.nodes[trap.from]!, city.nodes[loop[0]!.from]!);
  road(city.nodes[loop[1]!.from]!, city.nodes[trap.to]!);
  expect(placeConnector(city, compiled(city))({ x: 100, y: -99 })!.roadId).toBe(reverse.id);
});

test('T61 a reachable arrival stays in-only and gets an exit on the opposite lane', () => {
  const { city, road, place, trap, barrier, loop } = network();
  barrier.lanes[0]!.allowed = ['bus'];
  trap.streetGroupId = 'two-way';
  trap.lateralOffsetM = 1.5;
  const reverse = road(city.nodes[trap.to]!, city.nodes[trap.from]!, { streetGroupId: 'two-way' });
  road(city.nodes[trap.from]!, city.nodes[loop[0]!.from]!);
  road(city.nodes[loop[1]!.from]!, city.nodes[trap.to]!);
  place('Work', 'work', { x: 100, y: -99 }, [{ road: trap, direction: 'both', positionM: 40 }]);
  addImplicitGarages(city);
  const owner = Object.values(city.places)[0]!,
    original = { ...owner.connectors[0]! };
  connectCarExits(city, compiled(city));
  expect(owner.connectors).toHaveLength(2);
  expect(owner.connectors[0]).toEqual({ ...original, direction: 'in' });
  expect(owner.connectors[1]).toMatchObject({ roadId: reverse.id, direction: 'out' });
  expect(owner.connectors[1]!.id).not.toBe(original.id);
  expect(Object.values(city.parking!)[0]!.connectors).toBe(owner.connectors);
  expect(
    compile(city).diagnostics.filter((d) =>
      ['connector_unreachable', 'parking_no_exit', 'place_no_exit'].includes(d.code),
    ),
  ).toEqual([]);
});

test('T61 an unreachable old arrival moves instead of gaining an in-only portal', () => {
  const { city, place, trap, barrier, entry } = network();
  barrier.lanes[0]!.allowed = ['bus'];
  delete city.roads[entry.id];
  place('Work', 'work', { x: 100, y: -100 }, [{ road: trap, direction: 'both', positionM: 40 }]);
  const owner = Object.values(city.places)[0]!,
    id = owner.connectors[0]!.id;
  connectCarExits(city, compiled(city));
  expect(owner.connectors).toHaveLength(1);
  expect(owner.connectors[0]).toMatchObject({ id, direction: 'both' });
  expect(owner.connectors[0]!.roadId).not.toBe(trap.id);
});

test('T61 a split departure can use an exit-only lane unreachable from the street core', () => {
  const { city, road, node, place, trap, barrier, loop } = network();
  barrier.lanes[0]!.allowed = ['bus'];
  const exit = road(node(100, -80), city.nodes[loop[1]!.from]!);
  place('Work', 'work', { x: 100, y: -100 }, [{ road: trap, direction: 'both', positionM: 40 }]);
  const net = compiled(city),
    idx = net.index.lane.get(`${exit.id}#0`)!;
  expect(parkingEgress(net, 30).earliestArrival(idx)).toBe(Infinity);
  connectCarExits(city, net);
  expect(Object.values(city.places)[0]!.connectors.find((c) => c.direction === 'out')!.roadId).toBe(
    exit.id,
  );
});

test('T61 arrival lane changes fit in both the source and receiving lane', () => {
  const base = compiled(network().city),
    start = base.lanes.length;
  const core = base.lanes[0]!;
  const road = {
    ...base.roads[core.road]!,
    idx: base.roads.length,
    id: 'r:999',
    lanes: [start, start + 1],
  };
  const source = {
    ...core,
    idx: start,
    id: 'r:999#0',
    road: road.idx,
    lengthM: 20,
    left: -1,
    right: start + 1,
    in: [],
    out: [],
  };
  const target = { ...source, idx: start + 1, id: 'r:999#1', lengthM: 100, left: start, right: -1 };
  const first = {
    ...base.movements[0]!,
    idx: base.movements.length,
    id: `${core.id}>${source.id}`,
    fromLane: core.idx,
    toLane: start,
    turn: 'right' as const,
    neverGreen: false,
  };
  const last = {
    ...first,
    idx: first.idx + 1,
    id: `${target.id}>${core.id}`,
    fromLane: start + 1,
    toLane: core.idx,
  };
  const net = {
    ...base,
    lanes: [...base.lanes, source, target],
    roads: [...base.roads, road],
    movements: [...base.movements, first, last],
    connectors: [],
    parking: [],
    parkingSpaces: [],
  };
  const access = parkingEgress(net, 30);
  expect(access.earliestArrival(start)).toBe(0);
  expect(access.latestDeparture(start + 1)).toBe(100);
  expect(access.earliestArrival(start + 1)).toBe(Infinity);
});

test('T61 lane changes require 30 m remaining at the actual connector station', () => {
  const { city, place, trap, barrier } = network();
  trap.lanes.push({ ...trap.lanes[0]! });
  city.nodes[trap.to]!.turnRules.push({
    from: trap.id,
    to: barrier.id,
    fromLane: 1,
    allowed: false,
    provenance: { source: 'generated' },
  });
  city.nodes[trap.to]!.turnRules.push({
    from: trap.id,
    to: barrier.id,
    fromLane: 0,
    allowed: true,
    provenance: { source: 'generated' },
  });
  const before = compiled(city),
    lane = before.lanes[before.index.lane.get(`${trap.id}#1`)!]!;
  const last = parkingEgress(before, 30).latestDeparture(lane.idx);
  expect(last).toBeCloseTo(lane.lengthM - 30);
  place('Before change deadline', 'work', { x: 80, y: -100 }, [
    { road: trap, lane: 1, positionM: last - 1, direction: 'out' },
  ]);
  place('After change deadline', 'work', { x: 120, y: -100 }, [
    { road: trap, lane: 1, positionM: last + 1, direction: 'out' },
  ]);
  const net = compiled(city),
    access = parkingEgress(net, 30);
  for (const p of net.places)
    expect(access.connectors[p.connectorsOut[0]!]).toBe(
      city.places[p.id]!.name.startsWith('Before') ? 1 : 0,
    );
});

test('T61 mapped parking uses its footprint within 30 m, and has no fabricated remote entry', () => {
  const { city, trap, barrier } = network();
  delete city.roads[barrier.id];
  const snap = placeConnector(city, compiled(city), true);
  const ring = [
    { x: 60, y: -105 },
    { x: 190, y: -105 },
    { x: 190, y: -20 },
    { x: 60, y: -20 },
  ];
  const entry = snap({ x: 100, y: -100 }, [ring])!;
  expect(entry).toBeDefined();
  expect(entry.roadId).not.toBe(trap.id);
  expect(snap({ x: 10000, y: 10000 })).toBeUndefined();
});

test('T61 a point garage measures the replacement limit from its mapped point', () => {
  const { city, trap, barrier } = network(-20);
  barrier.lanes[0]!.allowed = ['bus'];
  const facility = garage(city, trap, { kind: 'point', pos: { x: 1000, y: 1000 } });
  connectCarExits(city, compiled(city));
  expect(facility.connectors[0]!.roadId).toBe(trap.id);
});

test('T61 a multi-wing garage can connect within 30 m of its second footprint', () => {
  const { city, trap, barrier } = network();
  barrier.lanes[0]!.allowed = ['bus'];
  const far = [
    { x: 900, y: 900 },
    { x: 1000, y: 900 },
    { x: 1000, y: 1000 },
    { x: 900, y: 1000 },
  ];
  const near = [
    { x: 60, y: -20 },
    { x: 160, y: -20 },
    { x: 160, y: -10 },
    { x: 60, y: -10 },
  ];
  const facility = garage(city, trap, { kind: 'polygon', ring: far });
  connectCarExits(city, compiled(city), new Map([[facility.id, [far, near]]]));
  expect(facility.connectors.find((c) => c.direction === 'out')!.roadId).not.toBe(trap.id);
});

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

test('T61 saved aisle entries and split exits retain the walk door; a moved arrival can attach', () => {
  const { city, trap, loop } = network();
  const facility = garage(city, trap, {
    kind: 'polygon',
    ring: [
      { x: 40, y: -120 },
      { x: 160, y: -120 },
      { x: 160, y: -80 },
      { x: 40, y: -80 },
    ],
  });
  facility.kind = 'lot';
  facility.connectors = [];
  facility.aisles = [trap.id];
  facility.entries = [trap.from];
  const before = compiled(city),
    lot = before.parking[before.index.parking.get(facility.id)!]!;
  facility.connectors = lot.connectorsIn.map((i) => {
    const c = before.connectors[i]!,
      l = before.lanes[c.lane]!;
    return { ...c, id: allocateId(city, 'c'), roadId: before.roads[l.road]!.id, lane: l.lane };
  });
  facility.provenance.inferred = ['materializedAisleEntries'];
  expect(compiled(city).walk).toEqual(before.walk);
  const extra: Connector = {
    id: allocateId(city, 'c'),
    roadId: loop[0]!.id,
    lane: 0,
    positionM: 80,
    direction: 'out',
    throughputPerMin: 30,
  };
  facility.connectors.push(extra);
  expect(compiled(city).walk).toEqual(before.walk);
  extra.direction = 'both';
  expect(compiled(city).walk.connectors.has(extra.id)).toBe(true);
});

// 5438353 / 754c1fa: the original car geometry and every original strip remain exact.
// TASK-131 keeps OSM geometry (no node merges, junction groups): lanes and movements move, and
// strips keep their rings but sit on other road ids and stations, so neither equals main's;
// fewer roadside gaps remain (main: Munich 16 with 85 spaces, Sindelfingen 32 with 721).
// Munich re-pinned for 06dae00 (median crossings offset by half their lane block)
// and e4654d8 (merging lanes kept on a group's inner roads).
test.each(
  tierCities([
    [
      'munich',
      // TASK-175: compiled nodes, roads and lanes gain `grade`; with it stripped every pin equals 6ea2994's.
      'e1525e9029b6fcf729720daff642605180d994bfefe0efdf4d81fc4ae543dd73',
      '9e15a4d6ac0cd7d3254c2abb9d8e7e8ed88365a158a6ae2f596319a6d680cafe',
      14,
      79,
    ],
    [
      'sindelfingen',
      // TASK-175: compiled nodes, roads and lanes gain `grade`; with it stripped every pin equals 6ea2994's.
      'a4de4301abf294a4da9074eb6ea8f154dae170d61b8b21ea5a9e175e0453e1f5',
      'e386a323dff201af5378e7cee85444cf6d04a9fbe33db85d7ba0f61a794a8e68',
      31,
      703,
    ],
  ] as const),
)(
  'T61 %s repairs facilities and populated places, retaining the car graph and crop strips',
  (name, geometry, strips, gapCount, gapSpaces) => {
    const city = loadAuditCity(name),
      net = compiled(city),
      exit = parkingEgress(net, 30);
    expect(
      hash({
        lanes: net.lanes.map((l) => ({ ...l, connectors: undefined })),
        movements: net.movements,
      }),
    ).toBe(geometry);
    expect(hash(Object.values(city.parking!).filter((f) => f.kind === 'roadside'))).toBe(strips);
    for (const f of net.parking.filter((f) => f.kind !== 'roadside' && f.capacity > 20))
      expect(exit.facilities[f.idx], f.id).toBe(1);
    for (const p of net.places.filter(
      (p) => p.kind !== 'gateway' && (city.places[p.id]!.population || city.places[p.id]!.jobs),
    ))
      expect(
        p.connectorsOut.some((i) => exit.connectors[i]),
        p.id,
      ).toBe(true);
    const gaps = net.parking.filter((f) => f.kind === 'roadside' && !exit.facilities[f.idx]);
    expect(gaps).toHaveLength(gapCount);
    expect(gaps.reduce((n, f) => n + f.capacity, 0)).toBe(gapSpaces);
  },
);

test('T61 saved trap connectors produce warnings naming the owner, connector and lane', () => {
  const { city, place, trap, barrier } = network();
  barrier.lanes[0]!.allowed = ['bus'];
  place('Work', 'work', { x: 100, y: -100 }, [{ road: trap, direction: 'both', positionM: 40 }]);
  addImplicitGarages(city);
  const result = compile(city);
  expect(result.ok).toBe(true);
  const owner = Object.values(city.places)[0]!,
    garage = Object.values(city.parking!)[0]!;
  for (const [code, id] of [
    ['place_no_exit', owner.id],
    ['parking_no_exit', garage.id],
  ])
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code,
        severity: 'warning',
        refs: expect.arrayContaining([id, owner.connectors[0]!.id, `${trap.id}#0`]),
      }),
    );
  owner.connectors = [placeConnector(city, compiled(city))({ x: 100, y: -100 })!];
  expect(
    compile(city).diagnostics.filter((d) => ['place_no_exit', 'parking_no_exit'].includes(d.code)),
  ).toEqual([]);
});
