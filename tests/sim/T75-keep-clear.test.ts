import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { railTimetable } from '../../src/network/trams';
import { createIntersections } from '../../src/sim/intersection';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { setup } from './fixtures';

function keepClear(signal = false, service = true) {
  const { city, node, road } = buildCity('Crossing evacuation', 147),
    junction = node(0, 0);
  const west = road(node(-100, 0), junction),
    east = road(junction, node(100, 0));
  const north = road(node(-10, -100), junction),
    second = road(node(10, -100), junction),
    south = road(junction, node(0, 100));
  const remoteNode = node(1000, 1000),
    remoteFrom = road(node(900, 1000), remoteNode),
    remoteTo = road(remoteNode, node(1100, 1000));
  west.provenance = { source: 'generated', osmIds: [10] };
  west.crossings = { end: false };
  city.rail = operatingCrossing('tram').rail;
  for (const n of Object.values(city.rail!.nodes)) n.pos.x -= 10;
  for (const track of Object.values(city.rail!.tracks))
    for (const point of track.line) point.x -= 10;
  if (signal) {
    junction.control = 'signal';
    junction.signal = {
      offsetS: 0,
      amberS: 3,
      allRedS: 1,
      phases: [
        { durationS: 30, groups: [{ from: west.id, to: east.id }] },
        { durationS: 30, groups: [{ from: north.id, to: south.id }] },
      ],
    };
  }
  const compiled = setup(city),
    lane = (id: string) => compiled.lanes[compiled.index.lane.get(`${id}#0`)!]!;
  const movement = (from: string, to: string) =>
    compiled.movements.find((m) => m.fromLane === lane(from).idx && m.toLane === lane(to).idx)!;
  const through = movement(west.id, east.id),
    enter = movement(north.id, south.id),
    other = movement(second.id, south.id),
    remote = movement(remoteFrom.id, remoteTo.id);
  const table = railTimetable(compiled.rail!);
  expect(table.departures.length).toBeGreaterThan(0);
  if (!service) table.departures = [];
  const vehicles = createVehicles(4, compiled.lanes.length, compiled.movements.length);
  vehicles.state.fill(DRIVING);
  vehicles.insert(0, lane(north.id).idx, lane(north.id).stopM - 1);
  vehicles.movement[0] = enter.idx;
  vehicles.insert(1, lane(second.id).idx, lane(second.id).stopM - 30);
  vehicles.movement[1] = other.idx;
  vehicles.insert(3, lane(west.id).idx, lane(west.id).stopM - 1);
  vehicles.movement[3] = through.idx;
  const intersections = createIntersections(compiled, vehicles, DEFAULT_SIM_PARAMS);
  return {
    compiled,
    vehicles,
    intersections,
    through,
    enter,
    other,
    remote,
    receiver: lane(south.id),
    west: lane(west.id),
  };
}

test.each(['moving', 'waited'] as const)(
  'T75 keep-clear rejects %s tail credit and leaves the track exit free',
  (kind) => {
    const { vehicles, intersections, receiver, enter, through } = keepClear(true);
    vehicles.insert(2, receiver.idx, 7);
    vehicles.speed[2] = kind === 'moving' ? 10 : 0;
    vehicles.speed[0] = 5;
    if (kind === 'waited') vehicles.stopped[0] = DEFAULT_SIM_PARAMS.intersection.boxWaitS + 1;
    intersections.signals(34);
    intersections.request(0, enter);
    intersections.resolve();
    expect(intersections.grants[0]).toBe(-1);
    intersections.signals(68);
    intersections.request(3, through);
    intersections.resolve();
    expect(intersections.grants[3]).toBe(through.idx);
  },
);

test('T75 keep-clear reserves receiving space across same-tick grants', () => {
  const { vehicles, intersections, receiver, enter, other } = keepClear();
  vehicles.insert(2, receiver.idx, 11);
  intersections.signals(0);
  intersections.request(0, enter);
  intersections.request(1, other);
  intersections.resolve();
  expect(intersections.grants[0]).toBe(enter.idx);
  expect(intersections.grants[1]).toBe(-1);
});

test('T75 keep-clear counts a body already inside an incoming movement', () => {
  const { vehicles, intersections, receiver, enter, other } = keepClear();
  vehicles.remove(1);
  vehicles.insert(1, -other.idx - 1, 0);
  intersections.grants[1] = other.idx;
  intersections.occupancy[other.idx] = 1;
  vehicles.insert(2, receiver.idx, 11);
  expect(intersections.blockedExit(0, enter)).not.toBeNull();
});

test('T75 keep-clear preserves actual red and unserved road behavior', () => {
  const served = keepClear(true);
  served.intersections.signals(0);
  served.intersections.request(0, served.enter);
  served.intersections.resolve();
  expect(served.intersections.grants[0]).toBe(-1);
  for (const service of [true, false]) {
    const { vehicles, intersections, receiver, enter } = keepClear(false, service);
    vehicles.insert(2, receiver.idx, 7);
    vehicles.speed[2] = 10;
    vehicles.speed[0] = 5;
    intersections.signals(0);
    intersections.request(0, enter);
    intersections.resolve();
    expect(intersections.grants[0]).toBe(service ? -1 : enter.idx);
  }
});

test('T75 a draining turn cannot take storage already reserved by a conflicting entry', () => {
  const { compiled, vehicles, intersections, receiver, enter, west } = keepClear();
  const drain = compiled.movements.find(
    (m) => m.fromLane === west.idx && m.toLane === receiver.idx,
  )!;
  vehicles.insert(2, receiver.idx, 11);
  intersections.signals(0);
  intersections.request(0, enter);
  intersections.resolve();
  expect(intersections.grants[0]).toBe(enter.idx);
  expect(intersections.blockedExit(3, drain)).not.toBeNull();
});

test('T75 cancelled grants release the reserved receiving space', () => {
  const { vehicles, intersections, receiver, enter, other } = keepClear();
  vehicles.insert(2, receiver.idx, 11);
  intersections.signals(0);
  intersections.request(0, enter);
  intersections.resolve();
  expect(intersections.grants[0]).toBe(enter.idx);
  intersections.release(0);
  intersections.request(1, other);
  intersections.resolve();
  expect(intersections.grants[1]).toBe(other.idx);
});

test('T75 served crossings leave unrelated receiving movement forecasts unchanged', () => {
  for (const service of [true, false]) {
    const { compiled, vehicles, intersections, remote } = keepClear(false, service);
    vehicles.remove(3);
    vehicles.insert(3, remote.fromLane, compiled.lanes[remote.fromLane]!.stopM - 20);
    vehicles.movement[3] = remote.idx;
    vehicles.insert(2, remote.toLane, 7);
    vehicles.speed[2] = 10;
    vehicles.speed[3] = 5;
    intersections.signals(0);
    intersections.request(3, remote);
    intersections.resolve();
    expect(intersections.grants[3]).toBe(remote.idx);
  }
});
