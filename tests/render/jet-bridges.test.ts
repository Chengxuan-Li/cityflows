import { expect, test } from 'vitest';
import { distance, pointInPolygon, segmentDistance } from '../../src/geo/polyline';
import { syntheticAirport } from '../../src/fixtures/synthetic-airport';
import { boardingDoor, boardingDoors } from '../../src/render/aircraft-outline';
import {
  apronLayout,
  bridgeSize,
  cabBack,
  closed,
  dockedPose,
  JetBridgeStates,
  placeJetBridges,
  reaches,
  tunnelLength,
} from '../../src/render/apron';
import { aircraftTypes } from '../../src/schema/aircraft';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { setup } from '../sim/fixtures';

// TASK-315: jet bridges by rule on the synthetic airport: a 940 m terminal along y = 460 to
// 530, contact stands 1 to 3 (code E) and 4 to 6 (code C) nose-in 11 m short of its facade,
// remote stands R1 and R2 west of it, a maintenance stand.

const city = syntheticAirport(1);
const graph = setup(city).airside!;
const airport = city.airport!;
const { bridges, masts, boards } = apronLayout(airport, graph, city.context);
const terminal = closed(Object.values(airport.terminals)[0]!.rings[0]!);
const facadeDistance = (p: { x: number; y: number }) =>
  Math.min(...terminal.slice(1).map((b, i) => segmentDistance(p, terminal[i]!, b)));
const type = (id: string) => aircraftTypes.find((t) => t.id === id)!;

test('a bridge at each contact stand with a mapped gate, its rotunda on the facade', () => {
  const contact = graph.stands.filter((s) => s.kind === 'contact');
  expect(contact.every((s) => airport.stands[s.id]!.gate)).toBe(true);
  expect(bridges.map((b) => graph.stands[b.index]!.ref).sort()).toEqual(
    contact.map((s) => s.ref).sort(),
  );
  for (const bridge of bridges) {
    const stand = graph.stands[bridge.index]!;
    // The rotunda stands just outside the facade, on the aircraft's port side (east here).
    expect(pointInPolygon(bridge.rotunda, terminal)).toBe(false);
    expect(facadeDistance(bridge.rotunda)).toBeLessThan(bridgeSize.rotundaRadiusM + 0.6);
    expect(bridge.rotunda.x).toBeGreaterThan(stand.pos.x);
    expect(bridge.link).toBeNull();
    // The reference aircraft docks within the tunnels' travel, the parked cab stands clear of
    // that aircraft's fuselage (port side) and nearer the rotunda.
    const reference = type(stand.maxCode >= 4 ? 'B77W' : 'A20N');
    const dock = dockedPose(stand, reference);
    expect(reaches(bridge, dock)).toBe(true);
    expect(tunnelLength(bridge, bridge.rest)).toBeGreaterThanOrEqual(bridge.segmentM + 0.5);
    expect(distance(bridge.rest.cab, bridge.rotunda)).toBeLessThan(
      distance(dock.cab, bridge.rotunda),
    );
    expect(bridge.rest.cab.x - stand.pos.x).toBeGreaterThan(bridgeSize.cabWidthM / 2);
  }
  // Stand guidance on the facade ahead of each bridged stand, facing the pilot; a mast under
  // each stand floodlight outside the buildings (the contact stands' fall inside the terminal,
  // the maintenance stand's inside the hangar).
  expect(boards).toHaveLength(bridges.length);
  for (const board of boards) {
    const stand = graph.stands.find((s) => s.id === board.stand)!;
    expect(board.mount).toBe('facade');
    expect(board.pos.x).toBeCloseTo(stand.pos.x, 6);
    expect(facadeDistance(board.pos)).toBeCloseTo(0.3, 6);
    expect(Math.cos(board.facing - stand.heading)).toBeCloseTo(-1, 6);
  }
  const hangar = closed(airport.hangars[0]!.rings[0]!);
  expect(masts.map((m) => graph.stands.find((s) => s.pos.x === m.pos.x)!.ref).sort()).toEqual([
    'R1',
    'R2',
  ]);
  expect(pointInPolygon({ x: 2000, y: 461 }, hangar)).toBe(true);
});

test('the docked cab meets each jet at its boarding door, at its sill height', () => {
  const stand = graph.stands.find((s) => s.ref === '1')!;
  for (const id of ['A388', 'B77W', 'A333', 'A20N', 'E175', 'CRJ9']) {
    const t = type(id);
    const pose = dockedPose(stand, t);
    const door = boardingDoor(t);
    const fx = Math.cos(stand.heading),
      fy = Math.sin(stand.heading);
    const along = door.x - t.lengthM / 2;
    // The door on the port surface: starboard is (-fy, fx) in the map frame, z < 0.
    const at = {
      x: stand.pos.x + fx * along - fy * door.z,
      y: stand.pos.y + fy * along + fx * door.z,
    };
    const front = {
      x: pose.cab.x + (Math.cos(pose.facing) * bridgeSize.cabDepthM) / 2,
      y: pose.cab.y + (Math.sin(pose.facing) * bridgeSize.cabDepthM) / 2,
    };
    expect(distance(front, at)).toBeLessThan(1e-9);
    expect(pose.floorM).toBe(door.sillM);
    expect(distance(cabBack(pose), at)).toBeCloseTo(bridgeSize.cabDepthM, 9);
  }
});

test('mapped links keep their bends and dock to distinct doors on the same aircraft', () => {
  const stand = graph.stands.find((s) => s.ref === '1')!;
  const jet = type('A333');
  const docks = boardingDoors(jet)
    .slice(0, 2)
    .map((door) => dockedPose(stand, jet, door));
  const lines = docks.map((dock, i) => {
    const c = Math.cos(dock.facing);
    const s = Math.sin(dock.facing);
    const pivot = { x: dock.cab.x - c * 20, y: dock.cab.y - s * 20 };
    return {
      osmId: i + 1,
      stand: stand.id,
      line: [{ x: pivot.x + 4, y: pivot.y - 10 }, { x: pivot.x, y: pivot.y - 8 }, pivot, dock.cab],
    };
  });
  const mapped = placeJetBridges({ ...airport, jetBridges: lines }, graph, city.context);
  expect(mapped).toHaveLength(2);
  const fleet = createAircraftFleet(graph, 1);
  expect(fleet.spawnParked({ typeId: jet.id, stand: stand.id }).ok).toBe(true);
  const states = new JetBridgeStates(mapped);
  states.update(fleet.snapshot(), 0);
  for (const [i, bridge] of mapped.entries()) {
    expect(bridge.link).toEqual(lines[i]!.line.slice(0, -1));
    const actual = states.poseAt(i, 0);
    expect(distance(actual.cab, docks[i]!.cab)).toBeLessThan(1e-6);
    expect(actual.floorM).toBeCloseTo(docks[i]!.floorM);
  }
});

test('bridges dock after parking and retract before the tug moves the aircraft', () => {
  const fleet = createAircraftFleet(graph, 1);
  fleet.setActiveEnds({ arrivalEnds: ['27'], departureEnds: ['27'] });
  const standId = (ref: string) => graph.stands.find((s) => s.ref === ref)!.id;
  const bridgeAt = (ref: string) => bridges.findIndex((b) => b.stand === standId(ref));
  // A jet parked at stand 1, a turboprop at stand 2: only the jet is served.
  const jet = fleet.spawnParked({ typeId: 'A333', stand: standId('1') });
  const prop = fleet.spawnParked({ typeId: 'AT76', stand: standId('2') });
  if (!jet.ok || !prop.ok) throw new Error('spawn');
  const startS = 36_000;
  const states = new JetBridgeStates(bridges);
  states.update(fleet.snapshot(), startS);
  const skipped = new JetBridgeStates(bridges);
  skipped.update(fleet.snapshot(), startS);
  const one = bridgeAt('1'),
    two = bridgeAt('2'),
    four = bridgeAt('4');
  expect(states.progress(one, startS)).toBe(1);
  expect(states.progress(two, startS)).toBe(0);
  expect(states.counts(startS)).toMatchObject({ bridges: bridges.length, docked: 1, moving: 0 });
  // Docked at the parked aircraft's own boarding door, from its pose.
  const parked = fleet.snapshot().find((p) => p.id === jet.id)!;
  const door = boardingDoor(type('A333'));
  const c = Math.cos(parked.heading),
    s = Math.sin(parked.heading);
  const doorAt = { x: parked.x + c * door.x - s * door.z, y: parked.y + s * door.x + c * door.z };
  const docked = states.poseAt(one, startS);
  const front = {
    x: docked.cab.x + (Math.cos(docked.facing) * bridgeSize.cabDepthM) / 2,
    y: docked.cab.y + (Math.sin(docked.facing) * bridgeSize.cabDepthM) / 2,
  };
  expect(distance(front, doorAt)).toBeLessThan(0.05);

  expect(fleet.requestDeparture(jet.id, '27').ok).toBe(true);
  expect(fleet.requestArrival({ typeId: 'E175', runwayEnd: '27', stand: standId('4') }).ok).toBe(
    true,
  );
  let readyS = NaN,
    pushStartS = NaN,
    movedS = NaN,
    parkedS = NaN;
  const start = { x: parked.x, y: parked.y };
  for (let step = 1; step * 0.1 <= 900; step++) {
    const t = startS + step * 0.1;
    fleet.step(t);
    const poses = fleet.snapshot();
    states.update(poses, t);
    const mine = poses.find((p) => p.id === jet.id);
    if (mine?.state === 'ready-for-pushback') {
      readyS = mine.pushbackReadySinceS!;
      expect(distance(mine, start)).toBe(0);
      expect(mine.speedMps).toBe(0);
      expect(mine.enginesRunning).toBe(false);
    }
    if (Number.isNaN(pushStartS) && mine?.state === 'pushback') pushStartS = t;
    if (mine?.state === 'pushback') {
      expect(states.progress(one, t)).toBe(0);
      skipped.update(poses, t);
      expect(skipped.progress(one, t)).toBe(0);
    }
    if (Number.isNaN(movedS) && mine && distance(mine, start) > 0.05) {
      movedS = t;
      expect(states.progress(one, t)).toBe(0);
    }
    const arrival = poses.find((p) => p.typeId === 'E175');
    if (Number.isNaN(parkedS) && arrival?.state === 'parked') parkedS = t;
    if (Number.isNaN(parkedS)) expect(states.progress(four, t)).toBe(0);
    if (!Number.isNaN(parkedS) && !Number.isNaN(movedS) && t > parkedS + 60) break;
  }
  expect(readyS).toBe(startS + 0.1);
  expect(pushStartS - readyS).toBeGreaterThanOrEqual(8);
  expect(states.progress(one, readyS + 2)).toBeCloseTo(0.5);
  expect(movedS - pushStartS).toBeLessThan(1);
  // The arrival's bridge extends after it parks and has docked within 45 s.
  expect(parkedS).toBeGreaterThan(0);
  expect(states.progress(four, parkedS)).toBe(0);
  expect(states.progress(four, parkedS + 20)).toBeGreaterThan(0);
  expect(states.progress(four, parkedS + 20)).toBeLessThan(1);
  expect(states.progress(four, parkedS + 45.1)).toBe(1);
});

test('a single-storey terminal front gets no bridges; an untagged one neither', () => {
  for (const tags of [{ heightM: 6 }, { levels: 2 }, {}]) {
    const low = syntheticAirport(1);
    const lowGraph = setup(low).airside!;
    const features = low.context!.features.map((f) =>
      f.kind === 'area' && f.sub === 'terminal'
        ? { ...f, heightM: undefined, levels: undefined, ...tags }
        : f,
    );
    // A fresh compile, so the layout is not the one memoised for the 14 m terminal.
    expect(apronLayout(low.airport!, lowGraph, { ...low.context!, features }).bridges).toEqual([]);
  }
  expect(apronLayout(airport, graph, city.context).bridges).toHaveLength(6);
});
