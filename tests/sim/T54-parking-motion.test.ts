import { expect, test } from 'vitest';
import { compile } from '../../src/network';
import { createEngine } from '../../src/sim/engine';
import { parkingWorld } from '../parking-world';
import { OFF_LANE } from '../../src/sim/vehicle';
import { createParking } from '../../src/sim/parking';
import { createVehicles } from '../../src/sim/vehicle';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { bodyClearLane, parkedPose } from '../../src/sim/manoeuvre';
import { createExportRecorder } from '../../src/host/export-data';
import { buildCity } from '../../src/fixtures/build-city';
import { allocateId } from '../../src/schema';

test('T54 a driveway arrival drives inside its lot before parking, deterministically', () => {
  const w = parkingWorld();
  const result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const runs = [createEngine(), createEngine()];
  for (const engine of runs)
    engine.load({ compiled: result.compiled, trips: [w.trip('arrival')], scenario: w.scenario });
  let inLot = 0;
  let previous: { x: number; y: number } | undefined;
  for (let step = 0; step < 2500; step++) {
    for (const engine of runs) engine.step();
    expect(runs[0]!.stateHash()).toBe(runs[1]!.stateHash());
    const engine = runs[0]!,
      snapshot = engine.snapshot();
    if (snapshot.count) {
      const pose = { x: snapshot.x[0]!, y: snapshot.y[0]! };
      if (previous)
        expect(Math.hypot(pose.x - previous.x, pose.y - previous.y)).toBeLessThanOrEqual(
          snapshot.speed[0]! * 0.1 + 0.05,
        );
      previous = pose;
    }
    if (engine.inspect(1)?.state === ('in_lot' as string)) inLot++;
    if (engine.inspect(1)?.state === 'completed') break;
  }
  expect(inLot).toBeGreaterThan(20);
  expect(runs[0]!.inspect(1)?.state).toBe('completed');
  expect([...runs[0]!.snapshot().parkedCars!.id]).toContain(1);
});

test('T54 strip pull-in poses move between the lane and slot', () => {
  const w = parkingWorld('roadside'),
    result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const engine = createEngine();
  engine.load({ compiled: result.compiled, trips: [w.trip('arrival')], scenario: w.scenario });
  const ys = new Set<number>();
  while (engine.timeS < 300 && engine.inspect(1)?.state !== 'completed') {
    engine.step();
    if (engine.inspect(1)?.state === 'queued_destination') ys.add(engine.snapshot().y[0]!);
  }
  expect(ys.size).toBeGreaterThan(10);
  expect(engine.inspect(1)?.state).toBe('completed');
});

test.each([118, 2, 7, 31, 52])(
  'T54 seed %i: cars follow without overlap, park, reverse out, and wait for street gaps',
  (seed) => {
    const w = parkingWorld(),
      result = compile(w.city);
    w.scenario.seed = seed;
    if (!result.ok) throw new Error('compile');
    const inbound = [w.trip('a'), w.trip('b', 103)];
    const requests = [
      ...inbound,
      ...inbound.map((t, i) => ({
        ...t,
        id: `return:${i}`,
        originPlaceId: w.shop.id,
        destinationPlaceId: w.home.id,
        departS: 350 + i * 5,
      })),
    ];
    const engine = createEngine();
    engine.load({ compiled: result.compiled, trips: requests, scenario: w.scenario });
    let together = 0,
      leaving = 0;
    const poses = new Map<number, { x: number; y: number }>();
    // TASK-112: the two return drivers walk back to their stalls before leaving.
    for (let step = 0; step < 12000; step++) {
      engine.step();
      const s = engine.snapshot();
      for (let i = 0; i < s.count; i++) {
        const id = s.id[i]!,
          p = { x: s.x[i]!, y: s.y[i]! },
          before = poses.get(id);
        if (before)
          expect(
            Math.hypot(p.x - before.x, p.y - before.y),
            `step ${step}, car ${id}`,
          ).toBeLessThanOrEqual(s.speed[i]! * 0.1 + 0.05);
        poses.set(id, p);
        if (engine.inspect(id)?.state === 'in_lot') {
          expect(s.lane[i]).toBe(OFF_LANE);
          if (id > 2) leaving++;
        }
      }
      if (s.count === 2 && [...s.state].every((v) => v === 6)) {
        together++;
        // SAT on oriented car bodies, expressed by each car's front bumper.
        const corners = (i: number) =>
          [
            [-4.5, -0.9],
            [0, -0.9],
            [0, 0.9],
            [-4.5, 0.9],
          ].map(([x, y]) => ({
            x: s.x[i]! + x! * Math.cos(s.heading[i]!) - y! * Math.sin(s.heading[i]!),
            y: s.y[i]! + x! * Math.sin(s.heading[i]!) + y! * Math.cos(s.heading[i]!),
          }));
        const a = corners(0),
          b = corners(1);
        const separated = [
          s.heading[0]!,
          s.heading[0]! + Math.PI / 2,
          s.heading[1]!,
          s.heading[1]! + Math.PI / 2,
        ].some((h) => {
          const project = (p: { x: number; y: number }) => p.x * Math.cos(h) + p.y * Math.sin(h),
            aa = a.map(project),
            bb = b.map(project);
          return (
            Math.max(...aa) <= Math.min(...bb) + 1e-4 || Math.max(...bb) <= Math.min(...aa) + 1e-4
          );
        });
        expect(separated, `overlap at ${engine.timeS}`).toBe(true);
      }
    }
    expect(together).toBeGreaterThan(20);
    expect(leaving).toBeGreaterThan(20);
    expect(engine.metrics().trips.completed).toBe(4);
    expect(engine.metrics().parking.motion!.meanEntryToParkS).toBeGreaterThan(4);
    expect(engine.metrics().parking.motion!.meanLotLeaveS).toBeGreaterThan(4);
  },
);

test('T54 200 seeded arrivals choose different stalls, uniformly within the score slack', () => {
  const w = parkingWorld(),
    result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const chosen = new Set<number>();
  for (let seed = 0; seed < 200; seed++) {
    const engine = createEngine();
    engine.load({
      compiled: result.compiled,
      trips: [w.trip('arrival')],
      scenario: { ...w.scenario, seed },
    });
    engine.step(2500);
    const detail = engine.inspect(1)!;
    expect(detail.state).toBe('completed');
    expect(detail.stallChoice).not.toBeNull();
    const space = result.compiled.parkingSpaces![detail.parkingSpace!]!,
      g = result.compiled.lots![0]!.circulation!,
      e = g.entries[0]!;
    const destination =
      result.compiled.places[result.compiled.index.place.get(w.shop.id)!]!.centroid;
    const score =
      e.distances[g.stallNodes[space.lotStall!]!]! +
      Math.hypot(space.position.x - destination.x, space.position.y - destination.y);
    expect(detail.stallChoice!.scoreM).toBeCloseTo(score);
    expect(detail.stallChoice!.scoreM - detail.stallChoice!.bestScoreM).toBeLessThanOrEqual(
      25 + 1e-8,
    );
    chosen.add(detail.parkingSpace!);
  }
  expect(chosen.size).toBeGreaterThan(5);
});

test('T54 an unrelated patch preserves a moving lot car and its reservation', () => {
  const w = parkingWorld(),
    result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const engine = createEngine();
  engine.load({ compiled: result.compiled, trips: [w.trip('a')], scenario: w.scenario });
  while (engine.timeS < 250 && engine.inspect(1)?.state !== 'in_lot') engine.step();
  expect(engine.inspect(1)?.state).toBe('in_lot');
  const before = engine.snapshot();
  const next = compile({ ...w.city, version: w.city.version + 1 });
  if (!next.ok) throw new Error('compile');
  engine.patch(next.compiled);
  expect(engine.snapshot().x).toEqual(before.x);
  expect(engine.snapshot().y).toEqual(before.y);
  engine.step(2000);
  expect(engine.inspect(1)?.state).toBe('completed');
});

test('T54 trajectory recording includes off-lane lot travel without counting it as a movement', () => {
  const w = parkingWorld(),
    result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const engine = createEngine();
  engine.load({ compiled: result.compiled, trips: [w.trip('a')], scenario: w.scenario });
  const recorder = createExportRecorder(engine, result.compiled);
  recorder.setTrajectories(true);
  for (let i = 0; i < 2500; i++) {
    engine.step();
    recorder.observe();
  }
  const samples = recorder.trajectories().filter((s) => s.lane === `parking:${w.id}`);
  expect(samples.length).toBeGreaterThan(0);
  expect(samples.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y))).toBe(true);
});

test('T54 a strip departure replans after a patch shifts its destination connector indices', () => {
  const w = parkingWorld('roadside');
  const original = w.city.parking![w.id]!;
  original.occupancyAtStart = 1;
  w.city.parking!['pk:0'] = {
    ...structuredClone(original),
    id: 'pk:0',
    occupancyAtStart: 0,
    strip: { ...original.strip!, fromM: 300, toM: 355 },
  };
  w.city.parking!['pk:1'] = {
    ...structuredClone(original),
    id: 'pk:1',
    occupancyAtStart: 0,
    strip: { ...original.strip!, fromM: 165, toM: 220 },
  };
  const result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const engine = createEngine();
  engine.load({
    compiled: result.compiled,
    trips: [w.trip('owner')],
    scenario: { ...w.scenario, simParams: { streetParkingShare: 1 } },
  });
  while (engine.timeS < 500 && (engine.snapshot().poseLane?.[0] ?? -1) < 0) engine.step();
  expect(engine.snapshot().poseLane?.[0]).toBeGreaterThanOrEqual(0);
  delete w.city.parking!['pk:0'];
  w.city.version++;
  const next = compile(w.city);
  if (!next.ok) throw new Error('compile');
  engine.patch(next.compiled);
  engine.step(3000);
  expect(engine.inspect(1)?.state).toBe('completed');
  expect(engine.inspect(1)?.parkingFacility).toBe('pk:1');
});

test('T54 a parallel pull-in waits for room for its forward approach', () => {
  const w = parkingWorld('roadside'),
    result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const vehicles = createVehicles(
    2,
    result.compiled.lanes.length,
    result.compiled.movements.length,
  );
  const parking = createParking(
    result.compiled,
    [w.trip('parking'), w.trip('ahead')],
    w.scenario,
    DEFAULT_SIM_PARAMS,
    vehicles,
  );
  const space = result.compiled.parkingSpaces![0]!,
    connector = result.compiled.connectors[space.connector]!;
  vehicles.insert(0, connector.lane, connector.positionM);
  vehicles.insert(1, connector.lane, connector.positionM + 8);
  expect(parking.startArrival(0, connector.idx, 100)).toBe(false);
  vehicles.position[1] = connector.positionM + 15;
  expect(parking.startArrival(0, connector.idx, 101)).toBe(true);
});

test('T54 a strip departure waits for room for its full forward sweep', () => {
  const w = parkingWorld('roadside');
  w.city.parking![w.id]!.occupancyAtStart = 1;
  const result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const vehicles = createVehicles(
    2,
    result.compiled.lanes.length,
    result.compiled.movements.length,
  );
  const parking = createParking(
    result.compiled,
    [w.trip('parking'), w.trip('ahead')],
    w.scenario,
    { ...DEFAULT_SIM_PARAMS, streetParkingShare: 1 },
    vehicles,
  );
  const c = result.compiled.connectors[parking.exits(0, [])[0]!]!;
  vehicles.insert(1, c.lane, c.positionM + 6.5);
  expect(parking.departureRoom(0)).toBe(false);
  vehicles.position[1] = c.positionM + 15;
  expect(parking.departureRoom(0)).toBe(true);
});

test('T54 an edit removing an active end bridge requires restart before changing the run', () => {
  const b = buildCity('Bridge edit', 118);
  const first = b.road(b.node(0, 0), b.node(60, 0), { roadClass: 'service' }),
    second = b.road(b.node(0, 20), b.node(60, 20), { roadClass: 'service' });
  for (const road of [first, second]) road.lanes[0]!.widthM = 6;
  b.place('Home', 'residential', { x: 5, y: 0 }, [
    { road: first, positionM: 5, direction: 'both' },
  ]);
  b.place('Shop', 'retail', { x: 50, y: 20 }, [{ road: second, positionM: 50, direction: 'both' }]);
  const [home, shop] = Object.values(b.city.places);
  home!.population = 2;
  shop!.jobs = 2;
  const id = allocateId(b.city, 'pk');
  b.city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 0,
      access: 'public',
      placeId: null,
      connectors: [
        {
          id: allocateId(b.city, 'c'),
          roadId: first.id,
          lane: 0,
          positionM: 10,
          direction: 'both',
          throughputPerMin: 30,
        },
      ],
      shape: {
        kind: 'polygon',
        ring: [
          { x: -5, y: -10 },
          { x: 65, y: -10 },
          { x: 65, y: 30 },
          { x: -5, y: 30 },
        ],
      },
      aisles: [first.id, second.id],
      provenance: { source: 'authored' },
    },
  };
  const result = compile(b.city);
  if (!result.ok) throw new Error('compile');
  const w = parkingWorld(),
    engine = createEngine();
  engine.load({
    compiled: result.compiled,
    trips: [{ ...w.trip('a'), originPlaceId: home!.id, destinationPlaceId: shop!.id }],
    scenario: w.scenario,
  });
  while (engine.timeS < 150 && engine.inspect(1)?.state !== 'in_lot') engine.step();
  expect(engine.inspect(1)?.state).toBe('in_lot');
  const graph = result.compiled.lots![0]!.circulation!,
    bridge = graph.edges.find((e) => Math.abs(graph.nodes[e.from]!.y - graph.nodes[e.to]!.y) > 10)!;
  const a = graph.nodes[bridge.from]!,
    c = graph.nodes[bridge.to]!,
    x = (a.x + c.x) / 2,
    y = (a.y + c.y) / 2;
  b.city.parking[id]!.exclusions = [
    [
      { x: x - 0.4, y: y - 0.4 },
      { x: x + 0.4, y: y - 0.4 },
      { x: x + 0.4, y: y + 0.4 },
      { x: x - 0.4, y: y + 0.4 },
    ],
  ];
  b.city.version++;
  const next = compile(b.city);
  if (!next.ok) throw new Error('compile');
  expect(next.compiled.lots![0]!.circulation!.nodes).toEqual(graph.nodes);
  expect(next.compiled.lots![0]!.circulation!.edges).not.toEqual(graph.edges);
  const hash = engine.stateHash();
  expect(() => engine.patch(next.compiled)).toThrow(/active manoeuvre.*restart/);
  expect(engine.stateHash()).toBe(hash);
});

test('T54 strip body holds the lane until clear; leaving starts at its exact parked pose', () => {
  const w = parkingWorld('roadside'),
    result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const incoming = w.trip('a'),
    out = {
      ...w.trip('back', 300),
      personId: incoming.personId,
      originPlaceId: w.shop.id,
      destinationPlaceId: w.home.id,
    };
  const engine = createEngine();
  engine.load({ compiled: result.compiled, trips: [incoming, out], scenario: w.scenario });
  let sawHeld = false,
    sawClear = false,
    sawLeave = false;
  // TASK-112: this one-way fixture's sidewalk route takes the driver around the block twice.
  for (let step = 0; step < 8000; step++) {
    engine.step();
    const s = engine.snapshot();
    for (let i = 0; i < s.count; i++) {
      const id = s.id[i]!,
        detail = engine.inspect(id)!;
      if ((s.poseLane?.[i] ?? -1) < 0) continue;
      const p = { x: s.x[i]!, y: s.y[i]!, heading: s.heading[i]! },
        lane = result.compiled.lanes[s.poseLane![i]!]!;
      if (id === 1) {
        const clear = bodyClearLane(p, lane, 4.5, 1.8);
        if (!clear) {
          expect(detail.lane).not.toBe(OFF_LANE);
          sawHeld = true;
        } else if (detail.lane === OFF_LANE) sawClear = true;
      } else if (!sawLeave) {
        const space = result.compiled.parkingSpaces![engine.inspect(1)!.parkingSpace!]!,
          from = parkedPose(space, 4.5);
        expect(Math.hypot(p.x - from.x, p.y - from.y)).toBeLessThan(0.05);
        sawLeave = true;
      }
    }
  }
  expect(sawHeld).toBe(true);
  expect(sawClear).toBe(true);
  expect(sawLeave).toBe(true);
});

test('T54 ten-slot departures have low slot/departure rank correlation across seeds', () => {
  const w = parkingWorld('roadside');
  w.city.parking![w.id]!.occupancyAtStart = 1;
  const result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const f = result.compiled.parking[result.compiled.index.parking.get(w.id)!]!,
    requests = Array.from({ length: 10 }, (_, i) => w.trip(`owner:${i}`, 100 + i));
  const correlations = [];
  for (let seed = 0; seed < 20; seed++) {
    const vehicles = createVehicles(
      10,
      result.compiled.lanes.length,
      result.compiled.movements.length,
    );
    const parking = createParking(
      result.compiled,
      requests,
      { ...w.scenario, seed },
      { ...DEFAULT_SIM_PARAMS, streetParkingShare: 1 },
      vehicles,
    );
    const order = requests.map((_, id) => f.connectorsOut.indexOf(parking.exits(id, [])[0]!));
    expect(new Set(order).size).toBe(10);
    correlations.push(
      1 - (6 * order.reduce((sum, slot, i) => sum + (slot - i) ** 2, 0)) / (10 * 99),
    );
  }
  expect(Math.abs(correlations.reduce((a, b) => a + b, 0) / correlations.length)).toBeLessThan(0.5);
});
