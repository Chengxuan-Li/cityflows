import { expect, test } from 'vitest';
import { nearestOnPolyline } from '../../src/geo/polyline';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { compile } from '../../src/network';
import { allocateId, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { bodyClearLane, type ParkingPose } from '../../src/sim/manoeuvre';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';

/** SAT on two 4.5 x 1.8 m car bodies, each given by its front bumper. */
function overlap(a: ParkingPose, b: ParkingPose) {
  const corners = (p: ParkingPose) =>
    [
      [-4.5, -0.9],
      [0, -0.9],
      [0, 0.9],
      [-4.5, 0.9],
    ].map(([x, y]) => ({
      x: p.x + x! * Math.cos(p.heading) - y! * Math.sin(p.heading),
      y: p.y + x! * Math.sin(p.heading) + y! * Math.cos(p.heading),
    }));
  return ![a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2].some((h) => {
    const project = (p: { x: number; y: number }) => p.x * Math.cos(h) + p.y * Math.sin(h),
      aa = corners(a).map(project),
      bb = corners(b).map(project);
    return Math.max(...aa) <= Math.min(...bb) + 1e-4 || Math.max(...bb) <= Math.min(...aa) + 1e-4;
  });
}

/**
 * A two-way street along y = 0 with a stocked lot south of it whose only exit is on the far
 * (westbound) lane: a car leaving it crosses the near (eastbound) lane to join. `near` and `far`
 * put a gateway admitting one car per 20 s just past the mouth on that lane, so a platoon queues
 * back across it; `stream` sends a platoon along the near lane at speed.
 */
function farLaneWorld(traffic: 'near' | 'far' | 'stream' | 'none') {
  const { city, node, street, place } = buildCity('Far-lane exit', 157);
  const a = node(0, 0),
    b = node(400, 0);
  const [east, west] = street(a, b);
  place('Shop', 'retail', { x: 160, y: 30 }, []);
  place('West end', 'gateway', { x: -10, y: -10 }, [
    { road: west!, positionM: 390, direction: 'in' },
  ]);
  place('West start', 'gateway', { x: -10, y: 10 }, [
    { road: east!, positionM: 5, direction: 'out' },
  ]);
  place('East start', 'gateway', { x: 410, y: -10 }, [
    { road: west!, positionM: 5, direction: 'out' },
  ]);
  place('East end', 'gateway', { x: 410, y: 10 }, [
    { road: east!, positionM: 390, direction: 'in' },
  ]);
  // Just past the mouth (x = 150) on each lane: x = 165 eastbound, x = 135 westbound.
  place('Near stop', 'gateway', { x: 165, y: 10 }, [
    { road: east!, positionM: 165, direction: 'in' },
  ]);
  place('Far stop', 'gateway', { x: 135, y: -10 }, [
    { road: west!, positionM: 265, direction: 'in' },
  ]);
  const [shop, westEnd, westStart, eastStart, eastEnd, nearStop, farStop] = Object.values(
    city.places,
  );
  for (const p of Object.values(city.places)) p.population = p.jobs = 0;
  nearStop!.connectors[0]!.throughputPerMin = farStop!.connectors[0]!.throughputPerMin = 3;
  const id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 10,
      access: 'public',
      placeId: shop!.id,
      connectors: [
        {
          id: allocateId(city, 'c'),
          roadId: east!.id,
          lane: 0,
          positionM: 150,
          direction: 'in',
          throughputPerMin: 60,
        },
        {
          id: allocateId(city, 'c'),
          roadId: west!.id,
          lane: 0,
          positionM: 250,
          direction: 'out',
          throughputPerMin: 60,
        },
      ],
      shape: {
        kind: 'polygon',
        ring: [
          { x: 80, y: 8 },
          { x: 240, y: 8 },
          { x: 240, y: 50 },
          { x: 80, y: 50 },
        ],
      },
      occupancyAtStart: 0.1,
      provenance: { source: 'authored', inferred: ['driveway'] },
    },
  };
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  const net = result.compiled;
  const trip = (name: string, origin: string, destination: string, departS: number) =>
    ({
      id: name,
      personId: null,
      originPlaceId: origin,
      destinationPlaceId: destination,
      departS,
      mode: 'car',
      vehicleClass: 'car',
      purpose: 'private',
      legs: [],
    }) satisfies TripRequest;
  const through =
    traffic === 'near'
      ? Array.from({ length: 12 }, (_, i) =>
          trip(`near:${i}`, westStart!.id, nearStop!.id, 100 + i),
        )
      : traffic === 'far'
        ? Array.from({ length: 12 }, (_, i) =>
            trip(`far:${i}`, eastStart!.id, farStop!.id, 100 + i),
          )
        : traffic === 'stream'
          ? Array.from({ length: 30 }, (_, i) =>
              trip(`stream:${i}`, westStart!.id, eastEnd!.id, 100 + i * 2.5),
            )
          : [];
  const leaving = trip('leaving', shop!.id, westEnd!.id, 110);
  const exit = net.connectors[net.parking[net.index.parking.get(id)!]!.connectorsOut[0]!]!;
  const near = net.lanes[net.index.lane.get(`${east!.id}#0`)!]!;
  return { net, through, leaving, exit, far: net.lanes[exit.lane]!, near };
}

const scenario = {
  ...defaultScenario('grid5x5', 157),
  startS: 100,
  endS: 1500,
  simParams: { streetParkingShare: 0 },
};

function drive(w: ReturnType<typeof farLaneWorld>, withLot = true) {
  const trips = withLot ? [...w.through, w.leaving] : w.through;
  const engine = createEngine();
  engine.load({ compiled: w.net, trips, scenario });
  return { engine, id: trips.length };
}

test.each(['near', 'far', 'stream', 'none'] as const)(
  'a lot exit bound for the far lane holds clear of the near lane, crosses with both gaps (%s)',
  (traffic) => {
    const w = farLaneWorld(traffic);
    const { engine, id } = drive(w);
    const alone = drive(w, false).engine;
    const { lengthM } = DEFAULT_SIM_PARAMS.vehicleClasses.car;
    const gap = Math.max(DEFAULT_SIM_PARAMS.spawnMinGapM, DEFAULT_SIM_PARAMS.idm.minGapM);
    const bodies = (lane: number) =>
      w.through.flatMap((_, i) => {
        const o = engine.inspect(i + 1);
        return o?.state === 'driving' && o.lane === lane
          ? [[o.positionM - lengthM, o.positionM]]
          : [];
      });
    // Lane bodies while it holds and when it is granted, judged after the run against the span
    // its merge covered on each lane.
    const held: { near: number[][]; far: number[][] }[] = [];
    let grant: (typeof held)[number] | undefined,
      joinM = NaN,
      inNearLane = 0,
      minAccel = 0,
      minAccelAlone = 0;
    const merge: ParkingPose[] = [];
    const speeds = new Map<number, number>(),
      speedsAlone = new Map<number, number>();
    for (let step = 0; step < 14000; step++) {
      engine.step();
      alone.step();
      const detail = engine.inspect(id);
      const s = engine.snapshot();
      const at = [...s.id].indexOf(id);
      const pose = at === -1 ? undefined : { x: s.x[at]!, y: s.y[at]!, heading: s.heading[at]! };
      if (pose)
        for (let i = 0; i < s.count; i++)
          if (s.id[i] !== id)
            expect(
              overlap(pose, { x: s.x[i]!, y: s.y[i]!, heading: s.heading[i]! }),
              `overlaps ${s.id[i]} at ${engine.timeS}`,
            ).toBe(false);
      if (detail?.parkingPhase === 'exit' || detail?.parkingPhase === 'drive_out') {
        // Holding: never in either lane band.
        expect(bodyClearLane(pose!, w.near, lengthM, 1.8), `near lane at ${engine.timeS}`).toBe(
          true,
        );
        expect(bodyClearLane(pose!, w.far, lengthM, 1.8)).toBe(true);
      }
      if (detail?.parkingPhase === 'exit')
        held.push({ near: bodies(w.near.idx), far: bodies(w.far.idx) });
      if (detail?.parkingPhase === 'merge') {
        if (!merge.length) {
          joinM = detail.positionM;
          grant = { near: bodies(w.near.idx), far: bodies(w.far.idx) };
        }
        merge.push(pose!);
        if (!bodyClearLane(pose!, w.near, lengthM, 1.8)) inNearLane++;
      }
      // Near-lane followers never brake harder than the insertion limit.
      for (const [snap, seen, isAlone] of [
        [s, speeds, false],
        [alone.snapshot(), speedsAlone, true],
      ] as const)
        for (let i = 0; i < snap.count; i++) {
          if (snap.id[i] === id) continue;
          const before = seen.get(snap.id[i]!);
          const accel = before === undefined ? 0 : (snap.speed[i]! - before) / 0.1;
          if (isAlone) minAccelAlone = Math.min(minAccelAlone, accel);
          else minAccel = Math.min(minAccel, accel);
          seen.set(snap.id[i]!, snap.speed[i]!);
        }
      if (detail?.state === 'completed' || detail?.state === 'failed') break;
    }
    expect(engine.inspect(id)!.state).toBe('completed');
    expect(engine.metrics().trips.failed).toBe(0);
    expect(merge.length).toBeGreaterThan(20);
    expect(inNearLane).toBeGreaterThan(5); // it does cross the near lane
    expect(joinM).toBeGreaterThanOrEqual(w.exit.positionM);
    // The span its body covered on the near lane while merging.
    let fromM = Infinity,
      toM = -Infinity;
    for (const pose of merge)
      if (!bodyClearLane(pose, w.near, lengthM, 1.8))
        for (const [x, y] of [
          [0, -0.9],
          [0, 0.9],
          [-lengthM, -0.9],
          [-lengthM, 0.9],
        ]) {
          const along = nearestOnPolyline(w.near.polyline, {
            x: pose.x + x! * Math.cos(pose.heading) - y! * Math.sin(pose.heading),
            y: pose.y + x! * Math.sin(pose.heading) + y! * Math.cos(pose.heading),
          }).along;
          fromM = Math.min(fromM, along);
          toM = Math.max(toM, along);
        }
    const inside = (spans: number[][], from: number, to: number) =>
      spans.some(([rear, front]) => front! > from - gap && rear! < to + gap);
    const nearBusy = (h: (typeof held)[number]) => inside(h.near, fromM, toM),
      farBusy = (h: (typeof held)[number]) => inside(h.far, joinM - lengthM, joinM);
    // Granted only with both gaps: nobody within the gap of the near-lane span or the join.
    expect(grant).toBeDefined();
    expect([nearBusy(grant!), farBusy(grant!)]).toEqual([false, false]);
    // It waited while either lane was occupied, each on its own.
    if (traffic === 'near')
      expect(held.filter((h) => nearBusy(h) && !farBusy(h)).length).toBeGreaterThan(100);
    if (traffic === 'far')
      expect(held.filter((h) => farBusy(h) && !nearBusy(h)).length).toBeGreaterThan(100);
    // Near-lane followers brake for it no harder than the insertion limit.
    expect(minAccel).toBeGreaterThanOrEqual(
      Math.min(minAccelAlone, -DEFAULT_SIM_PARAMS.mobil.safeDecelMps2) - 1e-6,
    );
  },
);
