import { expect, test } from 'vitest';
import { headingAtDistance, pointAtDistance } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { allocateId, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { bodyClearLane, type ParkingPose } from '../../src/sim/manoeuvre';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createParking } from '../../src/sim/parking';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { parkingWorld } from '../parking-world';

const STEP_LIMIT_M = DEFAULT_SIM_PARAMS.lotSpeedMps * DEFAULT_SIM_PARAMS.dtS + 0.05;

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

/** TASK-149's witness world: the shop owns lot pk:13 with stock, and the home is a gateway. */
function exitWorld() {
  const w = parkingWorld();
  w.home.kind = 'gateway';
  w.home.population = 0;
  w.shop.jobs = 0;
  w.city.parking![w.id]!.placeId = w.shop.id;
  w.city.parking![w.id]!.occupancyAtStart = 0.25;
  // A gateway just beyond the lot, so through traffic passes its mouth without parking. It
  // admits one car per 10 s, so a queue stands across the mouth for a while.
  const east = allocateId(w.city, 'p');
  w.city.places[east] = {
    ...w.home,
    id: east,
    name: 'East',
    shape: { kind: 'point', pos: { x: 360, y: -12 } },
    connectors: [
      {
        id: allocateId(w.city, 'c'),
        roadId: w.street.id,
        lane: 0,
        positionM: 190,
        direction: 'in',
        throughputPerMin: 6,
      },
    ],
  };
  const result = compile(w.city);
  if (!result.ok) throw new Error('Exit world compile');
  const net = result.compiled,
    exit = net.connectors[net.parking[net.index.parking.get(w.id)!]!.connectorsOut[0]!]!;
  const leaving = (name: string): TripRequest => ({
    ...w.trip(name),
    personId: null,
    originPlaceId: w.shop.id,
    destinationPlaceId: w.home.id,
  });
  const through = (name: string, departS: number): TripRequest => ({
    ...w.trip(name, departS),
    personId: null,
    destinationPlaceId: east,
  });
  return { ...w, net, exit, lane: net.lanes[exit.lane]!, leaving, through };
}

test('T77 a refused exit holds clear of the lane beside a through car, then merges continuously', () => {
  const w = exitWorld();
  const trips = [w.through('through', 100), w.leaving('stock')];
  const vehicles = createVehicles(2, w.net.lanes.length, w.net.movements.length);
  const parking = createParking(w.net, trips, w.scenario, DEFAULT_SIM_PARAMS, vehicles);
  // The witness: an ordinary vehicle stands at the exit station, so every gap is refused.
  vehicles.insert(0, w.exit.lane, w.exit.positionM);
  vehicles.state[0] = DRIVING;
  const standing = {
    ...pointAtDistance(w.lane.polyline, w.lane.cumulative, w.exit.positionM),
    heading: headingAtDistance(w.lane.polyline, w.lane.cumulative, w.exit.positionM),
  };
  expect(parking.startsInLot(1, w.exit.idx)).toBe(true);
  parking.depart(1, 100, w.exit.idx);
  let granted = false,
    asked = 0,
    joinM = NaN,
    overlaps = 0,
    intrusions = 0,
    before: ParkingPose | undefined,
    maxStep = 0;
  const callbacks = {
    clearLane() {},
    park() {},
    exit(_id: number, connector: number, positionM: number) {
      expect(connector).toBe(w.exit.idx);
      asked++;
      joinM = positionM;
      // As the engine's grant does: the car is inserted at its join station.
      if (granted) vehicles.position[1] = positionM;
      return granted;
    },
    resume() {},
  };
  for (let i = 0; i < 3000 && parking.motion(1); i++) {
    const timeS = 100 + i * DEFAULT_SIM_PARAMS.dtS;
    granted = timeS >= 250;
    parking.advance(timeS, callbacks);
    const m = parking.motion(1);
    if (!m) break;
    if (m.phase !== 'merge') {
      if (!bodyClearLane(m.pose, w.lane, 4.5, 1.8)) intrusions++;
      if (overlap(m.pose, standing)) overlaps++;
    }
    if (before && (m.phase === 'exit' || m.phase === 'merge'))
      maxStep = Math.max(maxStep, Math.hypot(m.pose.x - before.x, m.pose.y - before.y));
    before = { ...m.pose };
  }
  expect(parking.motion(1)).toBeUndefined();
  expect(asked).toBeGreaterThan(900); // it held for most of 150 s
  expect([overlaps, intrusions]).toEqual([0, 0]);
  expect(maxStep).toBeLessThanOrEqual(STEP_LIMIT_M);
  // The merge ends on the lane, at its join station and heading, where the engine inserts it.
  const join = pointAtDistance(w.lane.polyline, w.lane.cumulative, joinM);
  expect(Math.hypot(before!.x - join.x, before!.y - join.y)).toBeLessThan(1e-6);
  expect(before!.heading).toBeCloseTo(
    headingAtDistance(w.lane.polyline, w.lane.cumulative, joinM),
    6,
  );
  expect(joinM).toBeGreaterThanOrEqual(w.exit.positionM);
});

function run(trips: TripRequest[], w: ReturnType<typeof exitWorld>) {
  const engine = createEngine();
  engine.load({ compiled: w.net, trips, scenario: w.scenario });
  return engine;
}

test.each([[[110]], [[110, 145]]])(
  'T77 lot cars leaving at %j wait clear of through traffic without slowing it, then merge and finish',
  (departures) => {
    const w = exitWorld();
    // Eight through cars queue back across the mouth at the east gateway. The far-stall car
    // leaves at 110 s; a near-stall car leaving at 145 s reaches the mouth first and holds, so
    // the far one queues behind it on the shared aisle.
    const platoon = Array.from({ length: 8 }, (_, i) => w.through(`through:${i}`, 130 + i * 2));
    const leaving = departures.map((departS, i) => ({ ...w.leaving(`stock:${i}`), departS }));
    const alone = run(platoon, w),
      engine = run([...platoon, ...leaving], w);
    const exiting = leaving.map((_, i) => platoon.length + i + 1);
    let held = 0,
      besideThrough = 0,
      queued = 0,
      merges = 0;
    const last = new Map<number, ParkingPose>();
    for (let step = 0; step < 6000; step++) {
      alone.step();
      engine.step();
      const a = alone.snapshot(),
        s = engine.snapshot();
      const poses = new Map<number, ParkingPose & { speed: number }>();
      for (let i = 0; i < s.count; i++)
        poses.set(s.id[i]!, { x: s.x[i]!, y: s.y[i]!, heading: s.heading[i]!, speed: s.speed[i]! });
      // Through traffic keeps priority: the same poses and speeds as without the lot cars.
      for (let i = 0; i < a.count; i++)
        expect(poses.get(a.id[i]!), `through car ${a.id[i]} at ${engine.timeS}`).toEqual({
          x: a.x[i]!,
          y: a.y[i]!,
          heading: a.heading[i]!,
          speed: a.speed[i]!,
        });
      const phases = exiting.map((id) => engine.inspect(id)?.parkingPhase);
      for (const [k, id] of exiting.entries()) {
        const p = poses.get(id),
          detail = engine.inspect(id)!;
        if (!p) continue;
        const before = last.get(id);
        if (before && (detail.parkingPhase === 'exit' || detail.parkingPhase === 'merge'))
          expect(Math.hypot(p.x - before.x, p.y - before.y)).toBeLessThanOrEqual(STEP_LIMIT_M);
        if (before)
          expect(Math.hypot(p.x - before.x, p.y - before.y)).toBeLessThanOrEqual(
            p.speed * 0.1 + 0.05,
          );
        last.set(id, p);
        if (detail.state === 'in_lot')
          expect(bodyClearLane(p, w.lane, 4.5, 1.8), `car ${id} at ${engine.timeS}`).toBe(true);
        if (detail.parkingPhase === 'exit') {
          held++;
          besideThrough += Number(
            platoon.some((_, t) => {
              const through = engine.inspect(t + 1);
              return (
                through?.state !== 'completed' &&
                Math.abs((through?.positionM ?? Infinity) - w.exit.positionM) < 5
              );
            }),
          );
        }
        if (detail.parkingPhase === 'drive_out' && p.speed < 0.01)
          queued += Number(phases.some((phase, j) => j !== k && phase === 'exit'));
        if (detail.parkingPhase === 'merge') merges++;
        for (const [other, q] of poses)
          if (other !== id)
            expect(overlap(p, q), `car ${id} overlaps ${other} at ${engine.timeS}`).toBe(false);
      }
      if (exiting.every((id) => engine.inspect(id)?.state === 'completed')) break;
    }
    expect(besideThrough).toBeGreaterThan(20);
    expect(held).toBeGreaterThan(100);
    expect(merges).toBeGreaterThan(5 * exiting.length);
    if (exiting.length > 1) expect(queued).toBeGreaterThan(50);
    for (const id of exiting) expect(engine.inspect(id)!.state).toBe('completed');
  },
);

test('TASK-164 a car entering a lot from the street stays the lane occupant until its body has left the lane', () => {
  const w = parkingWorld(),
    result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const net = result.compiled;
  const lane = net.lanes[net.index.lane.get(`${w.street.id}#0`)!]!;
  const engine = createEngine();
  // Three arrivals close together: each follower queues on the street behind the one turning in.
  engine.load({
    compiled: net,
    trips: [w.trip('a'), w.trip('b', 101), w.trip('c', 102)],
    scenario: w.scenario,
  });
  let held = 0,
    turning = 0;
  for (let step = 0; step < 6000; step++) {
    engine.step();
    const s = engine.snapshot();
    const poses = [...s.id].map((_, i) => ({ x: s.x[i]!, y: s.y[i]!, heading: s.heading[i]! }));
    for (let i = 0; i < s.count; i++) {
      const phase = engine.inspect(s.id[i]!)!.parkingPhase;
      if (phase !== 'drive_in') continue;
      turning++;
      // While its body is in the street lane's band it holds the lane, so the car behind keeps
      // its gap instead of driving into the turning body.
      if (!bodyClearLane(poses[i]!, lane, 4.5, 1.8)) {
        expect(s.lane[i], `car ${s.id[i]} at ${engine.timeS}`).toBe(lane.idx);
        held++;
      }
      for (let j = 0; j < s.count; j++)
        if (j !== i && engine.inspect(s.id[j]!)!.state !== 'in_lot')
          expect(overlap(poses[i]!, poses[j]!), `cars ${s.id[i]}, ${s.id[j]}`).toBe(false);
    }
    if ([1, 2, 3].every((id) => engine.inspect(id)!.state === 'completed')) break;
  }
  expect(held).toBeGreaterThan(0);
  expect(turning).toBeGreaterThan(held);
  expect([1, 2, 3].map((id) => engine.inspect(id)!.state)).toEqual([
    'completed',
    'completed',
    'completed',
  ]);
});
