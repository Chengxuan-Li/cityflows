import { expect, test } from 'vitest';
import { nearestOnPolyline } from '../../src/geo/polyline';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { compile } from '../../src/network';
import { allocateId, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { createLaneChanges } from '../../src/sim/lane-change';
import { bodyClearLane, type ParkingPose } from '../../src/sim/manoeuvre';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { setup } from './fixtures';

const { lengthM, widthM } = DEFAULT_SIM_PARAMS.vehicleClasses.car;
const GAP = Math.max(DEFAULT_SIM_PARAMS.spawnMinGapM, DEFAULT_SIM_PARAMS.idm.minGapM);

const corners = (p: ParkingPose) =>
  [
    [-lengthM, -widthM / 2],
    [0, -widthM / 2],
    [0, widthM / 2],
    [-lengthM, widthM / 2],
  ].map(([x, y]) => ({
    x: p.x + x! * Math.cos(p.heading) - y! * Math.sin(p.heading),
    y: p.y + x! * Math.sin(p.heading) + y! * Math.cos(p.heading),
  }));

/** SAT on two car bodies, each given by its front bumper. */
function overlap(a: ParkingPose, b: ParkingPose) {
  return ![a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2].some((h) => {
    const project = (p: { x: number; y: number }) => p.x * Math.cos(h) + p.y * Math.sin(h),
      aa = corners(a).map(project),
      bb = corners(b).map(project);
    return Math.max(...aa) <= Math.min(...bb) + 1e-4 || Math.max(...bb) <= Math.min(...aa) + 1e-4;
  });
}

type Traffic = 'near' | 'far' | 'stream' | 'spawn' | 'lanes' | 'none';

/**
 * A two-way street along y = 0 with a stocked lot south of it whose only exit is on the far
 * (westbound) carriageway: a car leaving it crosses the near (eastbound) one to join. `near` and
 * `far` put a gateway admitting one car per 20 s just past the mouth on that lane, so a platoon
 * queues back across it; `stream` sends a platoon along the near lane at speed; `spawn` starts
 * cars on the near lane inside the span the merge crosses, from just after the grant (177.6 s
 * with no other traffic). In `lanes` each way has two lanes,
 * the exit is on the inner westbound lane, and eastbound cars change lanes across the mouth.
 */
function farLaneWorld(traffic: Traffic) {
  const { city, node, street, place } = buildCity('Far-lane exit', 157);
  const lanes = traffic === 'lanes' ? 2 : 1;
  const [east, west] = street(node(0, 0), node(400, 0), lanes);
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
  // Just past the mouth (x = 150) on each carriageway: x = 165 eastbound, x = 135 westbound.
  place('Near stop', 'gateway', { x: 165, y: 10 }, [
    { road: east!, positionM: 165, direction: 'in' },
  ]);
  place('Far stop', 'gateway', { x: 135, y: -10 }, [
    { road: west!, positionM: 265, direction: 'in' },
  ]);
  place('Mouth', 'gateway', { x: 146, y: 10 }, [{ road: east!, positionM: 146, direction: 'out' }]);
  place('Inner start', 'gateway', { x: 120, y: 10 }, [
    { road: east!, positionM: 120, direction: 'out', lane: 0 },
  ]);
  place('Outer end', 'gateway', { x: 175, y: 10 }, [
    { road: east!, positionM: 175, direction: 'in', lane: lanes - 1 },
  ]);
  const [shop, westEnd, westStart, eastStart, eastEnd, nearStop, farStop, mouth, inner, outer] =
    Object.values(city.places);
  for (const p of Object.values(city.places)) p.population = p.jobs = 0;
  nearStop!.connectors[0]!.throughputPerMin = farStop!.connectors[0]!.throughputPerMin = 3;
  const id = allocateId(city, 'pk');
  const connector = (roadId: string, lane: number, positionM: number, direction: 'in' | 'out') => ({
    id: allocateId(city, 'c'),
    roadId,
    lane,
    positionM,
    direction,
    throughputPerMin: 60,
  });
  city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 10,
      access: 'public',
      placeId: shop!.id,
      connectors: [connector(east!.id, lanes - 1, 150, 'in'), connector(west!.id, 0, 250, 'out')],
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
  const platoon = (
    count: number,
    origin: string,
    destination: string,
    headwayS: number,
    at = 100,
  ) =>
    Array.from({ length: count }, (_, i) =>
      trip(`${traffic}:${i}`, origin, destination, at + i * headwayS),
    );
  const through = {
    near: () => platoon(12, westStart!.id, nearStop!.id, 1),
    far: () => platoon(12, eastStart!.id, farStop!.id, 1),
    stream: () => platoon(30, westStart!.id, eastEnd!.id, 2.5),
    spawn: () => platoon(5, mouth!.id, eastEnd!.id, 2, 178),
    lanes: () => platoon(40, inner!.id, outer!.id, 2),
    none: () => [],
  }[traffic]();
  const exit = net.connectors[net.parking[net.index.parking.get(id)!]!.connectorsOut[0]!]!;
  const near = east!.lanes.map((_, i) => net.lanes[net.index.lane.get(`${east!.id}#${i}`)!]!);
  return { net, through, leaving: trip('leaving', shop!.id, westEnd!.id, 110), exit, near };
}

const scenario = {
  ...defaultScenario('grid5x5', 157),
  startS: 100,
  endS: 1500,
  simParams: { streetParkingShare: 0 },
};

function drive(w: ReturnType<typeof farLaneWorld>) {
  const trips = [...w.through, w.leaving];
  const engine = createEngine();
  engine.load({ compiled: w.net, trips, scenario });
  return { engine, id: trips.length };
}

test.each(['near', 'far', 'stream', 'spawn', 'lanes', 'none'] as const)(
  'TASK-157 a lot exit bound for the far lane holds clear of the near lane and crosses with both gaps (%s)',
  (traffic) => {
    const w = farLaneWorld(traffic);
    const far = w.net.lanes[w.exit.lane]!;
    const { engine, id } = drive(w);
    const bodies = (lane: number) =>
      w.through.flatMap((_, i) => {
        const o = engine.inspect(i + 1);
        return o?.state === 'driving' && o.lane === lane
          ? [[o.positionM - lengthM, o.positionM]]
          : [];
      });
    // Lane bodies while it holds and when it is granted, judged after the run against the span
    // its merge covered on each lane.
    type Lanes = { near: number[][][]; far: number[][] };
    const lanes = (): Lanes => ({ near: w.near.map((l) => bodies(l.idx)), far: bodies(far.idx) });
    const held: Lanes[] = [];
    const merge: ParkingPose[] = [];
    let grant: Lanes | undefined,
      joinM = NaN,
      minAccel = 0;
    const speeds = new Map<number, number>();
    for (let step = 0; step < 14000; step++) {
      engine.step();
      const detail = engine.inspect(id);
      const s = engine.snapshot();
      const at = [...s.id].indexOf(id);
      const pose = at === -1 ? undefined : { x: s.x[at]!, y: s.y[at]!, heading: s.heading[at]! };
      // Never any body overlap, holding, crossing or driving on.
      if (pose)
        for (let i = 0; i < s.count; i++)
          if (s.id[i] !== id)
            expect(
              overlap(pose, { x: s.x[i]!, y: s.y[i]!, heading: s.heading[i]! }),
              `overlaps ${s.id[i]} at ${engine.timeS}`,
            ).toBe(false);
      if (detail?.parkingPhase === 'exit' || detail?.parkingPhase === 'drive_out')
        for (const lane of [...w.near, far])
          expect(bodyClearLane(pose!, lane, lengthM, widthM), `${lane.id} at ${engine.timeS}`).toBe(
            true,
          );
      if (detail?.parkingPhase === 'exit') held.push(lanes());
      if (detail?.parkingPhase === 'merge') {
        if (!merge.length) {
          joinM = detail.positionM;
          grant = lanes();
        }
        merge.push(pose!);
      }
      // While it crosses, the hardest any other car brakes.
      for (let i = 0; i < s.count; i++) {
        const before = speeds.get(s.id[i]!);
        if (s.id[i] !== id && before !== undefined && detail?.parkingPhase === 'merge')
          minAccel = Math.min(minAccel, (s.speed[i]! - before) / DEFAULT_SIM_PARAMS.dtS);
        speeds.set(s.id[i]!, s.speed[i]!);
      }
      if (detail?.state === 'completed' || detail?.state === 'failed') break;
    }
    expect(engine.inspect(id)!.state).toBe('completed');
    expect(engine.metrics().trips.failed).toBe(0);
    expect(merge.length).toBeGreaterThan(20);
    expect(joinM).toBeGreaterThanOrEqual(w.exit.positionM);
    // The span its body covered on each near lane while merging: it crossed all of them.
    const spans = w.near.map((lane) => {
      let fromM = Infinity,
        toM = -Infinity;
      for (const pose of merge)
        if (!bodyClearLane(pose, lane, lengthM, widthM))
          for (const corner of corners(pose)) {
            const along = nearestOnPolyline(lane.polyline, corner).along;
            fromM = Math.min(fromM, along);
            toM = Math.max(toM, along);
          }
      return [fromM, toM] as const;
    });
    for (const [fromM, toM] of spans) expect(toM - fromM).toBeGreaterThan(widthM);
    const inside = (on: number[][], from: number, to: number) =>
      on.some(([rear, front]) => front! > from - GAP && rear! < to + GAP);
    const nearBusy = (h: Lanes) => spans.some(([from, to], i) => inside(h.near[i]!, from, to)),
      farBusy = (h: Lanes) => inside(h.far, joinM - lengthM, joinM);
    // Granted only with both gaps: nobody within the gap of a near-lane span or the join.
    expect([nearBusy(grant!), farBusy(grant!)]).toEqual([false, false]);
    // It waited while either lane was occupied, each on its own.
    if (traffic === 'near')
      expect(held.filter((h) => nearBusy(h) && !farBusy(h)).length).toBeGreaterThan(100);
    if (traffic === 'far')
      expect(held.filter((h) => farBusy(h) && !nearBusy(h)).length).toBeGreaterThan(100);
    // Followers brake for it no harder than the insertion limit.
    console.log(traffic, minAccel);
    expect(minAccel).toBeGreaterThanOrEqual(-DEFAULT_SIM_PARAMS.mobil.safeDecelMps2 - 1e-6);
  },
);

test('TASK-157 no lane change lands in a span a lot car is crossing', () => {
  const { city, node, road, place } = buildCity('Crossing span', 157);
  const street = road(node(0, 0), node(400, 0), { lanes: 2 });
  place('East', 'work', { x: 390, y: 10 }, [
    { road: street, lane: 1, positionM: 180, direction: 'in' },
  ]);
  const compiled = setup(city);
  const [inner, outer] = street.lanes.map((_, i) => compiled.index.lane.get(`${street.id}#${i}`)!);
  // A car on the inner lane 30 m short of its outer-lane destination must change now.
  const accepted = (span: [number, number] | null) => {
    const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
    const laneChanges = createLaneChanges(
      compiled,
      vehicles,
      DEFAULT_SIM_PARAMS,
      () => false,
      (lane, fromM, toM) => lane === outer && !!span && span[0] < toM && span[1] > fromM,
    );
    vehicles.insert(0, inner!, 150);
    vehicles.speed[0] = 5;
    vehicles.speedFactor[0] = 1;
    vehicles.state[0] = DRIVING;
    vehicles.destination[0] = 0;
    vehicles.route[0] = { roads: [0], movements: [], targetLanes: [[1]], costS: 0 };
    laneChanges.propose(0, compiled.lanes[inner!]!, 0, true);
    let changed = false;
    laneChanges.resolve(0, () => (changed = true));
    return changed;
  };
  expect(accepted(null)).toBe(true);
  expect(accepted([144, 150])).toBe(false); // its body would land in the span
  expect(accepted([151, 156])).toBe(false); // or within the minimum gap behind it
  expect(accepted([160, 166])).toBe(true);
});
