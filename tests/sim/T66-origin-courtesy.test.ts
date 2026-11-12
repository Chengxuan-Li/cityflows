import { expect, test } from 'vitest';
import { allocateId, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { createOriginCourtesy } from '../../src/sim/origin-courtesy';
import { createParking } from '../../src/sim/parking';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING, QUEUED_ORIGIN } from '../../src/sim/vehicle';
import { parkingWorld } from '../parking-world';
import { setup } from './fixtures';

function roadsidePlatoon() {
  const w = parkingWorld('roadside');
  w.street.speedLimitMps = 3;
  w.city.parking![w.id]!.occupancyAtStart = 1;
  const gateway = (positionM: number) => {
    const id = allocateId(w.city, 'p');
    w.city.places[id] = {
      ...structuredClone(w.home),
      id,
      kind: 'gateway',
      population: 0,
      jobs: 0,
      capacity: null,
      connectors: [
        {
          id: allocateId(w.city, 'c'),
          roadId: w.street.id,
          lane: 0,
          positionM,
          direction: 'both',
          throughputPerMin: 600,
        },
      ],
    };
    return id;
  };
  const origin = gateway(5),
    destination = gateway(380);
  const owner: TripRequest = { ...w.trip('owner', 300), personId: null };
  const through: TripRequest[] = Array.from({ length: 160 }, (_, i) => ({
    ...owner,
    id: `through:${i}`,
    originPlaceId: origin,
    destinationPlaceId: destination,
    departS: 100 + i * 0.1,
    purpose: 'through',
  }));
  const compiled = setup(w.city),
    engine = createEngine();
  engine.load({
    compiled,
    trips: [owner, ...through],
    scenario: { ...w.scenario, simParams: { streetParkingShare: 1 } },
    params: { maxReplans: 0, spawnMinGapM: 2 },
  });
  return { engine, compiled };
}

test('T66 a long-ready roadside departure obtains a bounded courtesy gap in a moving platoon', () => {
  const { engine } = roadsidePlatoon();
  let manoeuvreSamples = 0;
  let previous = engine.snapshot();
  for (let step = 0; step < 5000; step++) {
    engine.step();
    const snapshot = engine.snapshot();
    if (engine.timeS >= 480 && engine.timeS < 494) {
      for (const [i, id] of snapshot.id.entries()) {
        const old = previous.id.indexOf(id);
        if (id !== 1 && old !== -1 && snapshot.lane[i] === previous.lane[old])
          expect(previous.speed[old]! - snapshot.speed[i]!).toBeLessThanOrEqual(0.3001);
      }
    }
    if (engine.inspect(1)?.parkingPhase === 'leave') {
      manoeuvreSamples++;
      const owner = snapshot.id.indexOf(1);
      const corners = (i: number) =>
        [
          [0, -0.9],
          [0, 0.9],
          [-4.5, -0.9],
          [-4.5, 0.9],
        ].map(([x, y]) => ({
          x:
            snapshot.x[i]! +
            x! * Math.cos(snapshot.heading[i]!) -
            y! * Math.sin(snapshot.heading[i]!),
          y:
            snapshot.y[i]! +
            x! * Math.sin(snapshot.heading[i]!) +
            y! * Math.cos(snapshot.heading[i]!),
        }));
      for (const [i, id] of snapshot.id.entries()) {
        if (
          id === 1 ||
          Math.hypot(snapshot.x[i]! - snapshot.x[owner]!, snapshot.y[i]! - snapshot.y[owner]!) > 15
        )
          continue;
        const a = corners(owner),
          b = corners(i);
        const separated = [
          snapshot.heading[owner]!,
          snapshot.heading[owner]! + Math.PI / 2,
          snapshot.heading[i]!,
          snapshot.heading[i]! + Math.PI / 2,
        ].some((h) => {
          const project = (p: { x: number; y: number }) => p.x * Math.cos(h) + p.y * Math.sin(h);
          const aa = a.map(project),
            bb = b.map(project);
          return (
            Math.max(...aa) <= Math.min(...bb) + 1e-4 || Math.max(...bb) <= Math.min(...aa) + 1e-4
          );
        });
        expect(separated, `body overlap at ${engine.timeS}`).toBe(true);
      }
    }
    previous = snapshot;
  }
  expect(manoeuvreSamples).toBeGreaterThan(20);
  expect(Object.values(engine.metrics().trips).reduce((a, b) => a + b, 0)).toBe(161);
  expect(engine.inspect(1)?.departedS).not.toBeNull();
  expect(engine.inspect(1)!.departedS!).toBeLessThan(500);
});

function courtesyScene(twoOwners = false) {
  const w = parkingWorld('roadside');
  w.city.parking![w.id]!.occupancyAtStart = twoOwners ? 2 : 1;
  if (twoOwners) w.city.parking![w.id]!.strip!.toM = 117;
  const compiled = setup(w.city);
  const vehicles = createVehicles(
    twoOwners ? 4 : 3,
    compiled.lanes.length,
    compiled.movements.length,
  );
  vehicles.speedFactor.fill(1);
  const params = { ...DEFAULT_SIM_PARAMS, streetParkingShare: 1 };
  const parking = createParking(
    compiled,
    [
      w.trip('owner'),
      ...(twoOwners ? [w.trip('second-owner')] : []),
      ...[1, 2].map((i) => ({ ...w.trip(`through:${i}`), purpose: 'through' as const })),
    ],
    w.scenario,
    params,
    vehicles,
  );
  const connector = compiled.connectors[parking.exits(0, [])[0]!]!;
  vehicles.state[0] = QUEUED_ORIGIN;
  const follower = twoOwners ? 2 : 1,
    leader = twoOwners ? 3 : 2;
  for (const id of [follower, leader]) vehicles.state[id] = DRIVING;
  const second = twoOwners ? compiled.connectors[parking.exits(1, [])[0]!]! : connector;
  if (twoOwners) vehicles.state[1] = QUEUED_ORIGIN;
  vehicles.insert(follower, connector.lane, Math.min(connector.positionM, second.positionM) - 20);
  vehicles.insert(leader, connector.lane, Math.max(connector.positionM, second.positionM) - 6);
  vehicles.speed[follower] = 1;
  vehicles.speed[leader] = 3;
  const committed = new Set<number>();
  const courtesy = createOriginCourtesy(compiled, vehicles, params, parking, (id) =>
    committed.has(id),
  );
  const tick = (t: number, gap = false) => {
    courtesy.consider(0, connector, gap, t);
    courtesy.refresh(t);
  };
  const ready = () => {
    for (let i = 0; i <= 1800; i++) tick(100 + i * 0.1);
  };
  return {
    compiled,
    vehicles,
    parking,
    connector,
    second,
    params,
    courtesy,
    committed,
    tick,
    ready,
  };
}

test('T66 courtesy begins only after continuous eligible time and stops outside the full departure envelope', () => {
  const f = courtesyScene();
  for (let i = 0; i < 1800; i++) f.tick(100 + i * 0.1);
  expect(f.courtesy.hold(1)).toBeNull();
  f.tick(280);
  const held = f.courtesy.hold(1)!;
  expect(held).not.toBeNull();
  expect(held.frontM).toBeLessThanOrEqual(f.connector.positionM - 4.5 - f.params.spawnMinGapM);
  expect(f.courtesy.stats.started).toBe(1);
});

test.each(['stationaryLeader', 'unsafeFollower', 'committed', 'inner'] as const)(
  'T66 courtesy refuses %s',
  (refusal) => {
    const f = courtesyScene();
    if (refusal === 'stationaryLeader') f.vehicles.speed[2] = 0;
    if (refusal === 'unsafeFollower') {
      f.vehicles.position[1] = f.connector.positionM - 12.6;
      f.vehicles.speed[1] = 12;
    }
    if (refusal === 'committed') f.committed.add(1);
    if (refusal === 'inner') f.compiled.roads[f.compiled.lanes[f.connector.lane]!.road]!.group = 0;
    f.ready();
    expect(f.courtesy.stats.started).toBe(0);
    expect(f.courtesy.hold(1)).toBeNull();
  },
);

test('T66 a leader which slows cannot produce an indefinite or repeated courtesy hold', () => {
  const f = courtesyScene();
  f.ready();
  expect(f.courtesy.stats.started).toBe(1);
  f.vehicles.speed[2] = 0;
  for (let i = 1; i <= 200; i++) f.tick(280 + i * 0.1);
  expect(f.courtesy.hold(1)).toBeNull();
  expect(f.courtesy.stats).toEqual({ started: 1, succeeded: 0, aborted: 1 });
});

test('T66 losing eligibility resets the ready clock and releases the hold', () => {
  const f = courtesyScene();
  f.ready();
  f.courtesy.refresh(280.1);
  expect(f.courtesy.stats.aborted).toBe(1);
  expect(f.courtesy.hold(1)).toBeNull();
  f.tick(280.2);
  expect(f.courtesy.stats.started).toBe(1);
});

test('T66 an ordinary admitted departure ends courtesy and retains the parking manoeuvre', () => {
  const f = courtesyScene();
  f.ready();
  f.courtesy.consider(0, f.connector, true, 280.1);
  f.vehicles.state[0] = DRIVING;
  f.parking.depart(0, 280.1, f.connector.idx);
  f.courtesy.refresh(280.1);
  expect(f.courtesy.stats).toEqual({ started: 1, succeeded: 1, aborted: 0 });
  expect(f.courtesy.hold(1)).toBeNull();
  expect(f.parking.motion(0)?.phase).toBe('leave');
});

test('T66 a live edit cancels courtesy and discards its geometry and ready clock', () => {
  const f = courtesyScene();
  f.ready();
  f.courtesy.patch(f.compiled);
  expect(f.courtesy.hold(1)).toBeNull();
  expect(f.courtesy.stats.aborted).toBe(1);
  f.tick(280.1);
  expect(f.courtesy.stats.started).toBe(1);
});

test('T66 a newly committed follower immediately loses its courtesy hold', () => {
  const f = courtesyScene();
  f.ready();
  f.committed.add(1);
  expect(f.courtesy.hold(1)).toBeNull();
  expect(f.courtesy.stats.aborted).toBe(1);
});

test('T66 the roadside courtesy flow is deterministic', () => {
  const a = roadsidePlatoon(),
    b = roadsidePlatoon();
  a.engine.step(5000);
  b.engine.step(5000);
  expect(a.engine.stateHash()).toBe(b.engine.stateHash());
});

test('T66 overlapping roadside requests have one deterministic lane winner', () => {
  const f = courtesyScene(true);
  expect(f.second.idx).not.toBe(f.connector.idx);
  for (let i = 0; i <= 1800; i++) {
    const t = 100 + i * 0.1;
    f.courtesy.consider(0, f.connector, false, t);
    f.courtesy.consider(1, f.second, false, t);
    f.courtesy.refresh(t);
  }
  expect(f.courtesy.stats.started).toBe(1);
  expect(f.courtesy.hold(2)?.owner).toBe(0);
});
