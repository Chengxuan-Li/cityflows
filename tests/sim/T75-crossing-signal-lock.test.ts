import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import type { TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createRailCrossings } from '../../src/sim/rail-crossings';
import { createSignalControl, GREEN } from '../../src/sim/signals';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { scenario, setup } from './fixtures';

/**
 * TASK-222: two actuated signals 10 m apart with a tram crossing on the link between them, as
 * Freiburg's n:18 and group 2 (n:39) around the crossing at r:1337. Each signal gives its two
 * approaches a phase each, so an eastbound car needs A's phase 0 and B's phase 0, a westbound one
 * B's phase 1 and A's phase 1. The link is too short to wait on: a car stops short of A (or B),
 * where the crossing holds it while the far signal's stop line, inside its clear zone, is red.
 * Started in opposite phases (A serving westbound, B eastbound), each signal's green is extended
 * by the cars waiting at the other's red, which call the other phase; both ran to their maximum
 * and swapped together, into phases where the crossing holds both heads, and back, for ever.
 */
function corridor() {
  const { city, node, street, place, signal } = buildCity('A crossing between two signals', 222);
  const a = node(0, 0),
    b = node(10, 0);
  const west = street(node(-150, 0), a),
    link = street(a, b),
    east = street(b, node(160, 0));
  for (const road of link) road.provenance = { source: 'generated', osmIds: [10] };
  signal(a, [west, [link[1], link[0]]]);
  signal(b, [link, [east[1], east[0]]]);
  a.signal!.actuated = b.signal!.actuated = true;
  // B starts in its phase 0 when A starts in its phase 1.
  b.signal!.offsetS = 29;
  const rail = operatingCrossing('tram').rail!;
  for (const [id, y] of [
    ['rn:1', -1000],
    ['rn:2', 0],
    ['rn:3', 1000],
  ] as const)
    rail.nodes[id]!.pos = { x: 5, y };
  rail.tracks['rt:1']!.line = [rail.nodes['rn:1']!.pos, rail.nodes['rn:2']!.pos];
  rail.tracks['rt:2']!.line = [rail.nodes['rn:2']!.pos, rail.nodes['rn:3']!.pos];
  city.rail = rail;
  const gate = (x: number, out: (typeof west)[0], into: (typeof west)[0]) =>
    place('Gate', 'gateway', { x, y: 10 }, [
      { road: out, direction: 'out', positionM: 5 },
      { road: into, direction: 'in', positionM: 140 },
    ]);
  gate(-150, west[0], west[1]);
  gate(160, east[1], east[0]);
  const compiled = setup(city);
  // The crossing holds both directions on the link, just past the signal before it (TASK-348: a
  // signal between two nodes is laid out as a plain node, so the link keeps its whole 10 m and
  // the crossing starts 3.5 m in, not 1 m past a 2.5 m cut).
  expect(compiled.rail!.facilities![0]!.spans!.map((s) => s.fromM)).toEqual([3.5, 3.5]);
  const [westGate, eastGate] = Object.values(city.places);
  const trips: TripRequest[] = Array.from({ length: 30 }, (_, i) => ({
    id: `trip:${i}`,
    personId: null,
    originPlaceId: (i % 2 ? eastGate : westGate)!.id,
    destinationPlaceId: (i % 2 ? westGate : eastGate)!.id,
    departS: 100 + Math.floor(i / 2) * 4,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  }));
  return { compiled, trips, nodes: [a, b].map((n) => compiled.index.node.get(n.id)!) };
}

test('TASK-222 two actuated signals joined by a tram crossing do not lock in opposite phases', () => {
  const { compiled, trips, nodes } = corridor();
  const engine = createEngine();
  engine.load({ compiled, trips, scenario: { ...scenario(), endS: 1300 } });
  const start = engine.snapshot().signals!;
  expect(nodes.map((n) => start.phase[n])).toEqual([1, 0]);
  // The phase pairs shown green at both signals at once.
  const together = new Set<string>();
  while (engine.timeS < 1300) {
    engine.step();
    const { phase, state } = engine.snapshot().signals!;
    if (nodes.every((n) => state[n] === 0)) together.add(nodes.map((n) => phase[n]).join('/'));
  }
  // Before TASK-222 only '0/1' and '1/0' ever showed, and no car crossed.
  expect(together).toContain('0/0');
  expect(together).toContain('1/1');
  expect(engine.metrics().trips).toMatchObject({ completed: 30, failed: 0, driving: 0 });
});

test.each([-0.5, 0, 0.5])(
  'TASK-362 a shared stop line gets green overlap (far max-out offset %s s)',
  (offsetS) => {
    const { compiled, nodes } = corridor();
    const signals = compiled.nodes.map((node) => node.signal);
    const [near, far] = nodes.map((n) => signals[n!]!);
    // Keep the cycles equal so offset greens never drift into overlap by chance.
    far!.phases[0]!.durationS -= offsetS;
    far!.phases[1]!.durationS += offsetS;
    far!.offsetS = far!.phases[0]!.durationS + far!.amberS + far!.allRedS;
    const [entry, exit, nearCall, farCall] = [
      near!.phases[0],
      far!.phases[0],
      near!.phases[1],
      far!.phases[1],
    ].map((phase) => compiled.movements[phase!.movements[0]!]!);
    const approach = compiled.lanes[entry!.fromLane]!;
    compiled.rail!.facilities![0]!.stops!.push({ lane: approach.idx, stopM: approach.stopM });
    const vehicles = createVehicles(3, compiled.lanes.length, compiled.movements.length);
    vehicles.state.fill(DRIVING);
    for (const [id, movement] of [entry!, nearCall!, farCall!].entries()) {
      const lane = compiled.lanes[movement.fromLane]!;
      vehicles.insert(id, lane.idx, lane.stopM - (id === 0 ? DEFAULT_SIM_PARAMS.idm.minGapM : 0));
      vehicles.movement[id] = movement.idx;
    }
    vehicles.route[0] = {
      roads: [entry!.fromLane, exit!.fromLane, exit!.toLane].map((n) => compiled.lanes[n]!.road),
      movements: [entry!.idx, exit!.idx],
      targetLanes: [],
      costS: 0,
    };
    const colors = new Uint8Array(compiled.movements.length);
    const rail = createRailCrossings(
      compiled,
      vehicles,
      DEFAULT_SIM_PARAMS,
      0,
      (m) => colors[m] !== GREEN,
    )!;
    const control = createSignalControl(
      compiled,
      signals,
      vehicles,
      DEFAULT_SIM_PARAMS,
      0,
      () => undefined,
      undefined,
      rail.holdRed,
    );
    control.update(0, colors);
    // The other two vehicles are independent detector calls, not held by the crossing.
    expect(rail.hold(0)).toBe(approach.stopM);
    expect(rail.holdRed(0)).toBe(exit!.idx);
    let overlap = 0;
    let served = false;
    let opposingGreen = false;
    for (let tick = 1; tick <= 1200; tick++) {
      vehicles.stopped[0] = tick / 10;
      control.update(tick / 10, colors);
      if (served) {
        if (colors[nearCall!.idx] === GREEN) {
          opposingGreen = true;
          break;
        }
        continue;
      }
      const stop = rail.hold(0);
      if (colors[entry!.idx] === GREEN && colors[exit!.idx] === GREEN && stop === Infinity)
        overlap++;
      else overlap = 0;
      if (overlap >= 30) {
        served = true;
        vehicles.remove(0);
      }
    }
    expect(served, 'the head gets a continuous start-up window').toBe(true);
    expect(opposingGreen, 'the near signal returns to opposing demand').toBe(true);
  },
);
