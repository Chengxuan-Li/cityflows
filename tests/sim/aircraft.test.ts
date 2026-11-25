import { expect, test } from 'vitest';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { syntheticAirport, syntheticAirportBacktrack } from '../../src/fixtures/synthetic-airport';
import { routeAirside, arcEdge, createAirsideRouteFinder } from '../../src/routing/airside';
import { aircraftCodes } from '../../src/schema/aircraft';
import {
  createAircraftFleet,
  type AircraftFleet,
  type AircraftPoseSnapshot,
} from '../../src/sim/aircraft';
import { createEngine } from '../../src/sim/engine';
import { exemptRunwayPair, overlaps, runwayConflictCheck } from './aircraft-checks';
import { airportFixture } from './airside-fixture';
import { setup } from './fixtures';

// TASK-298: aircraft on an inline airport (tests/sim/airside-fixture.ts).

function fleetOf(
  options?: Parameters<typeof airportFixture>[0],
  edit?: (city: ReturnType<typeof airportFixture>['city']) => void,
) {
  const { city, stands } = airportFixture(options);
  edit?.(city);
  const compiled = setup(city);
  const graph = compiled.airside!;
  return { graph, stands, fleet: createAircraftFleet(graph, 1), compiled, city };
}

/** Steps the fleet at 0.1 s until `untilS` or `done`, checking bodies and runway use at every
 * second; returns every pose by aircraft. */
function run(
  fleet: AircraftFleet,
  untilS: number,
  done = () => false,
  at: (step: number) => void = () => {},
) {
  const poses = new Map<number, (AircraftPoseSnapshot & { timeS: number })[]>();
  const events: ReturnType<AircraftFleet['drainEvents']> = [];
  const checkRunways = runwayConflictCheck(fleet.graph);
  for (let step = 0; step * 0.1 <= untilS; step++) {
    const timeS = step * 0.1;
    at(step);
    fleet.step(timeS);
    events.push(...fleet.drainEvents());
    const snapshot = fleet.snapshot();
    for (const pose of snapshot) {
      const list = poses.get(pose.id) ?? [];
      list.push({ ...pose, timeS });
      poses.set(pose.id, list);
    }
    if (step % 10 === 0) {
      expect(overlaps(snapshot), `bodies at ${timeS} s`).toEqual([]);
      if (fleet.graph.runways.length === 1) {
        // TASK-330: one aircraft on the runway at a time, but for the sharing the owner approved
        // (TASK-345: crossings together or behind a landing roll, a line-up behind a roll).
        const on = snapshot.filter((p) => p.onRunway);
        const shared = on.flatMap((a, i) => on.slice(i + 1).filter((b) => !exemptRunwayPair(a, b)));
        expect(shared.length, `runway at ${timeS} s`).toBe(0);
      } else expect(checkRunways(snapshot), `runway at ${timeS} s`).toBe(0);
    }
    if (done()) break;
  }
  return { poses, events };
}

const kinds = (events: { kind: string; id: number }[], id: number) =>
  events.filter((e) => e.id === id).map((e) => e.kind);
const states = (poses: AircraftPoseSnapshot[]) =>
  poses.map((p) => p.state).filter((s, i, all) => s !== all[i - 1]);

test.each(['09', null])('a departure at a closed hold recovers with target %s', (target) => {
  const { fleet, stands, graph } = fleetOf(undefined, (city) => {
    // A long unsplit connector puts the fallback hold less than half an edge from the turn.
    const airport = city.airport!;
    const hold = Object.values(airport.holdingPositions).find(
      ({ node }) => airport.nodes[node]!.pos.x === 1500,
    )!;
    const toward = airport.edges[hold.toward!]!;
    const other = Object.values(airport.edges).find(({ from }) => from === hold.node)!;
    toward.to = other.to;
    toward.line = [toward.line[0]!, other.line.at(-1)!];
    delete airport.edges[other.id];
    delete airport.holdingPositions[hold.id];
    delete airport.nodes[hold.node];
  });
  fleet.setRunwayConfiguration({ id: '27', arrivalEnds: ['27'], departureEnds: ['27'] });
  const departure = fleet.spawnParked({ typeId: 'BCS3', stand: stands.E2 });
  if (!departure.ok) throw new Error(departure.reason);
  expect(fleet.requestDeparture(departure.id, '27').ok).toBe(true);
  let closed = false;
  const { poses, events } = run(
    fleet,
    1200,
    () => closed && (fleet.idle(departure.id) || fleet.metrics().departed > 0),
    (step) => {
      if (step === 1000)
        expect(fleet.requestArrival({ typeId: 'E190', runwayEnd: '27', stand: stands.C1 }).ok).toBe(
          true,
        );
      if (closed || fleet.statusOf(departure.id) !== 'holding') return;
      closed = true;
      fleet.setRunwayConfiguration(
        target ? { id: target, arrivalEnds: [target], departureEnds: [target] } : null,
        step / 10,
      );
    },
  );
  expect(closed).toBe(true);
  const track = poses.get(departure.id)!;
  if (target) {
    expect(kinds(events, departure.id)).toEqual(['off-block', 'departed']);
    expect(track.find((pose) => pose.state === 'takeoff-roll')?.runwayEnd).toBe(target);
    expect(fleet.metrics().rerouted).toBe(1);
  } else {
    expect(kinds(events, departure.id)).toEqual(['off-block', 'returned']);
    expect(fleet.idle(departure.id)).toBe(true);
    const stand = graph.index.stand.get(track.at(-1)!.stand!)!;
    expect(track.at(-1)?.state).toBe('parked');
    expect(fleet.standOccupant(stand)).toBe(departure.id);
    expect(events.at(-1)).toMatchObject({ id: departure.id, kind: 'returned', stand });
    expect(track.some((pose) => pose.state === 'takeoff-roll')).toBe(false);
  }
});

test('departures queued at a hold can clear it after the runway closes', () => {
  const { fleet, stands } = fleetOf();
  fleet.setRunwayConfiguration({ id: '27', arrivalEnds: ['27'], departureEnds: ['27'] });
  const first = fleet.spawnParked({ typeId: 'BCS3', stand: stands.E2 });
  const second = fleet.spawnParked({ typeId: 'BCS3', stand: stands.E1 });
  if (!first.ok || !second.ok) throw new Error('Two departures must park');
  expect(fleet.requestDeparture(first.id, '27').ok).toBe(true);
  let closed = false;
  const { events } = run(
    fleet,
    1800,
    () => closed && fleet.idle(first.id) && fleet.idle(second.id),
    (step) => {
      if (step === 30) expect(fleet.requestDeparture(second.id, '27').ok).toBe(true);
      if (step === 1000)
        expect(fleet.requestArrival({ typeId: 'E190', runwayEnd: '27', stand: stands.C1 }).ok).toBe(
          true,
        );
      if (closed || fleet.statusOf(first.id) !== 'holding') return;
      expect(fleet.statusOf(second.id)).toBe('taxi');
      closed = true;
      fleet.setRunwayConfiguration(null, step / 10);
    },
  );
  expect(closed).toBe(true);
  expect(kinds(events, first.id)).toEqual(['off-block', 'returned']);
  expect(kinds(events, second.id)).toEqual(['off-block', 'returned']);
});

test('an arrival appears 10 km out, lands, vacates at the first usable exit and parks', () => {
  const { fleet, stands, graph } = fleetOf();
  const arrival = fleet.requestArrival({ typeId: 'E190', runwayEnd: '27', stand: stands.C1 });
  expect(arrival.ok).toBe(true);
  const id = arrival.ok ? arrival.id : 0;
  const { poses, events } = run(fleet, 900, () => fleet.idle(id));
  const track = poses.get(id)!;
  // 10 km beyond the 27 end on its extended centreline, on a 3-degree glide path.
  expect(track[0]!.x).toBeGreaterThan(1500 + 9900);
  expect(Math.abs(track[0]!.y)).toBeLessThan(1);
  expect(track[0]!.heightM / 10_000).toBeCloseTo(Math.tan((3 * Math.PI) / 180), 1);
  expect(kinds(events, id)).toEqual(['landed', 'parked']);
  expect(states(track).slice(0, 3)).toEqual(['approach', 'flare', 'landing-roll']);
  // E190: 300 m aiming point, 710 m roll: the exit at x = 300 is the first it can use.
  const exit = track.find((p) => !p.onRunway && p.state === 'taxi')!;
  expect(exit.x).toBeCloseTo(300, -1);
  const last = track.at(-1)!;
  expect(last.state).toBe('parked');
  expect(last.stand).toBe(stands.C1);
  const stand = graph.stands[graph.index.stand.get(stands.C1)!]!;
  expect(Math.hypot(last.x - stand.pos.x, last.y - (stand.pos.y - 18.1))).toBeLessThan(0.5);
  expect(fleet.standOccupant(stand.idx)).toBe(id);
});

test('an arrival parks on its stand heading clear of the apron road and pushes back from there', () => {
  // TASK-320: stand K's lead-in turns back 137 degrees 25 m short of its stop; an apron service
  // road crosses the stand's line behind it.
  const { fleet, stands, graph } = fleetOf({ hook: true });
  const stand = graph.stands[graph.index.stand.get(stands.K!)!]!;
  const arrival = fleet.requestArrival({ typeId: 'E190', runwayEnd: '27', stand: stands.K! });
  if (!arrival.ok) throw new Error(arrival.reason);
  const { poses } = run(fleet, 900, () => fleet.idle(arrival.id));
  const parked = fleet.snapshot().find((p) => p.id === arrival.id)!;
  expect(parked.state).toBe('parked');
  const off = (a: number) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
  expect(off(parked.heading - stand.heading)).toBeLessThan((3 * Math.PI) / 180);
  // The drawn pose is the simulation's.
  const drawn = parked.visual!;
  expect(Math.hypot(drawn.x - parked.x, drawn.y - parked.y)).toBeLessThan(0.01);
  expect(off(drawn.heading - parked.heading)).toBeLessThan(1e-3);
  // The nose on the stand's line, moved ahead of the stop so the tail keeps 1 m off the road.
  const ux = Math.cos(stand.heading),
    uy = Math.sin(stand.heading);
  const dx = parked.x + ux * 18.1 - stand.pos.x,
    dy = parked.y + uy * 18.1 - stand.pos.y;
  const ahead = dx * ux + dy * uy;
  expect(Math.abs(dx * uy - dy * ux)).toBeLessThan(0.05);
  const [road] = stand.roadBandsM;
  expect(ahead).toBeGreaterThan(0);
  expect(ahead).toBeLessThanOrEqual(stand.aheadM);
  expect(36.2 - ahead + 1).toBeLessThanOrEqual(road![0] + 0.05);
  // The pushback starts from that pose.
  expect(fleet.requestDeparture(arrival.id, '27').ok).toBe(true);
  let moving: AircraftPoseSnapshot | undefined;
  for (let timeS = poses.get(arrival.id)!.at(-1)!.timeS; !moving?.speedMps;) {
    expect(timeS).toBeLessThan(1500);
    fleet.step((timeS += 0.1));
    moving = fleet.snapshot().find((p) => p.id === arrival.id && p.state === 'pushback');
  }
  expect(Math.hypot(moving!.x - parked.x, moving!.y - parked.y)).toBeLessThan(0.1);
  expect(off(moving!.heading - parked.heading)).toBeLessThan((0.5 * Math.PI) / 180);
});

test('a departure pushes back, taxis, holds for a landing, lines up and climbs out', () => {
  const { fleet, stands } = fleetOf();
  const parked = fleet.spawnParked({ typeId: 'BCS3', stand: stands.E2 });
  if (!parked.ok) throw new Error(parked.reason);
  expect(fleet.requestDeparture(parked.id, '27').ok).toBe(true);
  // A landing on 27 booked as the departure nears the hold holds it there until it has vacated.
  const { poses } = run(
    fleet,
    1200,
    () => fleet.metrics().departed === 1,
    (step) => {
      if (step === 1000)
        fleet.requestArrival({ typeId: 'E190', runwayEnd: '27', stand: stands.C1 });
    },
  );
  const track = poses.get(parked.id)!;
  expect(states(track)).toEqual([
    'ready-for-pushback',
    'pushback',
    'taxi',
    'holding',
    'line-up',
    'takeoff-roll',
    'rotation',
    'climb',
  ]);
  // Pushed back with engines starting, a stop for the tug, then taxi.
  expect(track.find((p) => p.state === 'pushback')!.enginesRunning).toBe(true);
  // It holds with its nose at the 27 hold (x = 1500, y = 100), 19 m behind which is its centre.
  const holding = track.find((p) => p.state === 'holding')!;
  expect(holding.x).toBeCloseTo(1500, 0);
  expect(holding.y).toBeCloseTo(100 + 38.7 / 2, 0);
  expect(holding.onRunway).toBe(false);
  // Lined up at the end and off along the runway heading west, gear up once climbing.
  const roll = track.find((p) => p.state === 'takeoff-roll')!;
  expect(Math.abs(Math.cos(roll.heading) + 1)).toBeLessThan(1e-3);
  const last = track.at(-1)!;
  expect(last.x).toBeLessThan(-1500 - 9000);
  expect(last.gearDown).toBe(false);
  expect(fleet.metrics()).toMatchObject({ departed: 1, landed: 1, stuck: 0 });
});

test('with no taxiway to the 27 end a departure backtracks and turns round on the runway', () => {
  const { fleet, stands } = fleetOf({ backtrack: true });
  const parked = fleet.spawnParked({ typeId: 'E190', stand: stands.C2 });
  if (!parked.ok) throw new Error(parked.reason);
  fleet.requestDeparture(parked.id, '27');
  const { poses } = run(fleet, 900);
  const track = poses.get(parked.id)!;
  const lineUp = track.filter((p) => p.state === 'line-up');
  // Onto the runway at x = 1400 heading east, round the loop near the end, then west.
  expect(Math.max(...lineUp.map((p) => p.x))).toBeGreaterThan(1450);
  expect(lineUp.some((p) => Math.cos(p.heading) > 0.99 && p.onRunway)).toBe(true);
  const roll = track.find((p) => p.state === 'takeoff-roll')!;
  expect(Math.cos(roll.heading)).toBeLessThan(-0.999);
  expect(roll.x).toBeGreaterThan(1400);
  expect(fleet.metrics().departed).toBe(1);
});

test.each([
  { intersectionX: -900, waits: false },
  { intersectionX: 300, waits: true },
])(
  'a departure waits for an intersecting arrival only if it reaches the intersection ($intersectionX m)',
  ({ intersectionX, waits }) => {
    const { fleet, stands } = fleetOf({ intersectionX });
    const parked = fleet.spawnParked({ typeId: 'E190', stand: stands.South! });
    const arrival = fleet.requestArrival({ typeId: 'E190', runwayEnd: '27', stand: stands.C1 });
    if (!parked.ok) throw new Error(parked.reason);
    if (!arrival.ok) throw new Error(arrival.reason);
    const { poses } = run(
      fleet,
      900,
      () => fleet.metrics().departed === 1 && fleet.idle(arrival.id),
      (step) => {
        if (step === 500) expect(fleet.requestDeparture(parked.id, '36').ok).toBe(true);
      },
    );
    const departure = poses.get(parked.id)!;
    const landing = poses.get(arrival.id)!;
    expect(fleet.metrics()).toMatchObject({ departed: 1, landed: 1, goArounds: 0, stuck: 0 });
    expect(departure.some(({ state }) => state === 'holding')).toBe(waits);
    const grant = departure.find(({ state }) => state === 'line-up')!;
    const arrivalAtGrant = landing.find(({ timeS }) => timeS === grant.timeS)!;
    if (waits) {
      expect(arrivalAtGrant.y).toBeGreaterThan(70);
      expect(arrivalAtGrant.y).toBeLessThan(100);
    } else expect(arrivalAtGrant.onRunway).toBe(true);
  },
);

test('a crossing of an unused runway can pass while the intersecting runway is occupied elsewhere', () => {
  const { fleet, stands } = fleetOf({ intersectionX: -900 });
  const parked = fleet.spawnParked({ typeId: 'E190', stand: stands.West! });
  const arrival = fleet.requestArrival({ typeId: 'E190', runwayEnd: '27', stand: stands.C1 });
  if (!parked.ok) throw new Error(parked.reason);
  if (!arrival.ok) throw new Error(arrival.reason);
  const { poses } = run(
    fleet,
    900,
    () => fleet.idle(parked.id) && fleet.idle(arrival.id),
    (step) => {
      if (step === 550) expect(fleet.requestTow(parked.id, { stand: stands.East! }).ok).toBe(true);
    },
  );
  const crossing = poses.get(parked.id)!.find(({ x, y }) => Math.abs(x + 900) < 5 && y < -780)!;
  expect(crossing.onRunway).toBe(true);
  const landing = poses.get(arrival.id)!.filter(({ onRunway }) => onRunway);
  expect(
    landing.some(({ timeS }) => timeS === crossing.timeS),
    `crossing at ${crossing.timeS} s, landing at ${landing[0]?.timeS}–${landing.at(-1)?.timeS} s`,
  ).toBe(true);
  expect(fleet.metrics()).toMatchObject({ towed: 1, landed: 1, goArounds: 0, stuck: 0 });
});

test('two aircraft on crossing taxi paths never overlap: one waits short of the junction', () => {
  const { fleet, stands } = fleetOf();
  const a = fleet.spawnParked({ typeId: 'E190', stand: stands.R });
  const b = fleet.spawnParked({ typeId: 'E190', stand: stands.L1 });
  if (!a.ok || !b.ok) throw new Error('parked');
  // R's tow runs north up the link, L1's east along the loop: both through (-600, 400).
  expect(fleet.requestTow(a.id, { stand: stands.E1 }).ok).toBe(true);
  expect(fleet.requestTow(b.id, { stand: stands.L2 }).ok).toBe(true);
  const { poses, events } = run(fleet, 1500, () => fleet.metrics().towed === 2);
  expect(
    events
      .filter((e) => e.kind === 'towed')
      .map((e) => e.id)
      .sort(),
  ).toEqual([a.id, b.id]);
  const near = (p: AircraftPoseSnapshot) => Math.hypot(p.x + 600, p.y - 400) < 40;
  expect(poses.get(a.id)!.some(near)).toBe(true);
  expect(poses.get(b.id)!.some(near)).toBe(true);
  // Towed: engines off throughout.
  expect(poses.get(a.id)!.every((p) => !p.enginesRunning)).toBe(true);
  // The two never come within the claim margins of each other.
  const byTime = new Map(poses.get(b.id)!.map((p) => [p.timeS, p]));
  let closest = Infinity;
  for (const p of poses.get(a.id)!) {
    const q = byTime.get(p.timeS);
    if (q) closest = Math.min(closest, Math.hypot(p.x - q.x, p.y - q.y));
  }
  expect(closest).toBeGreaterThan(45);
  // TASK-312: ordered by admission, both leave their stands before either arrives: the later one
  // waits short of the junction, not at its stand.
  const startS = (id: number) => poses.get(id)!.find((p) => p.speedMps > 0.05)!.timeS;
  const towedS = (id: number) => events.find((e) => e.id === id && e.kind === 'towed')!.timeS;
  expect(Math.max(startS(a.id), startS(b.id))).toBeLessThan(Math.min(towedS(a.id), towedS(b.id)));
});

test('a code E aircraft is never routed onto a code C edge or stand', () => {
  const { fleet, stands, graph } = fleetOf();
  const code = (c: string) => aircraftCodes.indexOf(c as never);
  // The direct way west from the apron is the code C stretch; code E goes round the loop.
  const from = { node: graph.stands[graph.index.stand.get(stands.E1)!]!.root };
  const goal = (arc: number) => graph.edges[arcEdge(arc)]!.from === graph.runways[0]!.ends[0].node;
  const viaC = routeAirside(graph, { code: code('C'), turnRadiusM: 15, from, goal })!;
  const viaE = routeAirside(graph, { code: code('E'), turnRadiusM: 28, from, goal })!;
  expect(viaC.arcs.some((a) => graph.edges[arcEdge(a)]!.maxCode === code('C'))).toBe(true);
  expect(viaE.arcs.every((a) => graph.edges[arcEdge(a)]!.maxCode >= code('E'))).toBe(true);
  expect(viaE.cost).toBeGreaterThan(viaC.cost);
  const findRoute = createAirsideRouteFinder(graph);
  expect(findRoute({ code: code('C'), turnRadiusM: 15, from, goal })).toEqual(viaC);
  const sameRadius = { code: code('E'), turnRadiusM: 15, from, goal };
  expect(findRoute(sameRadius)).toEqual(routeAirside(graph, sameRadius));
  expect(findRoute({ code: code('E'), turnRadiusM: 28, from, goal })).toEqual(viaE);
  expect(fleet.requestArrival({ typeId: 'A333', runwayEnd: '27', stand: stands.C1 })).toEqual({
    ok: false,
    reason: 'stand C1 admits code C',
  });
  const parked = fleet.spawnParked({ typeId: 'A333', stand: stands.E1 });
  if (!parked.ok) throw new Error(parked.reason);
  fleet.requestDeparture(parked.id, '09');
  const { poses } = run(fleet, 1500);
  const track = poses.get(parked.id)!;
  expect(fleet.metrics().departed).toBe(1);
  for (const p of track)
    for (const e of p.route) expect(graph.edges[e]!.maxCode).toBeGreaterThanOrEqual(code('E'));
  // It went round by the loop, never along the code C stretch at y = 200.
  expect(track.some((p) => p.y > 390 && p.y < 410 && p.x < -650)).toBe(true);
  expect(track.some((p) => Math.abs(p.y - 200) < 5 && p.x > -950 && p.x < -350)).toBe(false);
});

/** Three departures and three arrivals on 27 at once. */
function busy(fleet: AircraftFleet, stands: ReturnType<typeof airportFixture>['stands']) {
  for (const stand of [stands.E1, stands.L1, stands.R]) {
    const parked = fleet.spawnParked({ typeId: 'E190', stand });
    if (!parked.ok) throw new Error(parked.reason);
    fleet.requestDeparture(parked.id, '27');
  }
  for (const [typeId, stand] of [
    ['E175', stands.C1],
    ['DH8D', stands.C2],
    ['BCS3', stands.E2],
  ] as const)
    expect(fleet.requestArrival({ typeId, runwayEnd: '27', stand }).ok).toBe(true);
}

test('one aircraft on the runway at a time; every movement completes', () => {
  const { fleet, stands } = fleetOf();
  busy(fleet, stands);
  run(fleet, 3600, () => fleet.metrics().departed === 3 && fleet.metrics().active === 3);
  expect(fleet.metrics()).toMatchObject({ departed: 3, landed: 3, stuck: 0, queuedArrivals: 0 });
  expect(fleet.parked().length).toBe(3);
});

test('determinism: two runs of the same requests, one hash', () => {
  const hashes = [0, 1].map(() => {
    const { fleet, stands } = fleetOf();
    busy(fleet, stands);
    let hash = 0x811c9dc5;
    const word = (h: number, value: number) => Math.imul(h ^ value, 0x01000193);
    for (let step = 0; step < 12_000; step++) {
      fleet.step(step * 0.1);
      if (step % 100 === 0) hash = fleet.hash(word, hash);
    }
    return hash >>> 0;
  });
  expect(hashes[0]).toBe(hashes[1]);
});

test('a helicopter lands vertically on its pad and leaves climbing then forward', () => {
  const { fleet } = fleetOf();
  const arrival = fleet.requestHelicopterArrival({
    typeId: 'EC45',
    helipad: 'hl:1',
    headingRad: 0,
  });
  if (!arrival.ok) throw new Error(arrival.reason);
  const { poses } = run(fleet, 900, () => fleet.idle(arrival.id));
  expect(states(poses.get(arrival.id)!)).toEqual([
    'helicopter-approach',
    'vertical-descent',
    'parked',
  ]);
  expect(fleet.requestHelicopterDeparture(arrival.id, Math.PI / 2).ok).toBe(true);
  const { poses: after } = run(fleet, 900);
  expect(states(after.get(arrival.id)!).slice(0, 2)).toEqual([
    'vertical-climb',
    'helicopter-climb',
  ]);
});

const TOW_REQUEST_S = 30;
test('road traffic gives way where a service road crosses the airside; the aircraft never stops', () => {
  const { city, stands } = airportFixture({ road: true });
  const compiled = setup(city);
  const crossing = compiled.airside!.crossings[0]!;
  expect(crossing.stops.length).toBe(2);
  let fleet: AircraftFleet | undefined;
  let aircraft = -1;
  const engine = createEngine();
  const [homes, work] = Object.values(city.places);
  engine.load({
    compiled,
    trips: Array.from({ length: 6 }, (_, i) => ({
      id: `trip:${i}`,
      personId: null,
      originPlaceId: homes!.id,
      destinationPlaceId: work!.id,
      departS: 100 + i * 8,
      mode: 'car' as const,
      vehicleClass: 'car' as const,
      purpose: 'private' as const,
      legs: [],
    })),
    scenario: { ...defaultScenario('grid5x5'), startS: 0, endS: 1200 },
    airsideOperations: (f) => {
      fleet = f;
      return {
        step(timeS) {
          if (timeS === 0) {
            const parked = f.spawnParked({ typeId: 'E190', stand: stands.R });
            if (!parked.ok) throw new Error(parked.reason);
            aircraft = parked.id;
          }
          // Requested so that the tow reaches the road as the cars do.
          if (timeS === TOW_REQUEST_S) f.requestTow(aircraft, { stand: stands.E1 });
        },
      };
    },
  });
  const stopOn = new Map(crossing.stops.map((s) => [s.lane, s.positionM]));
  let held = 0,
    closedSteps = 0;
  for (let step = 0; step < 9000; step++) {
    engine.step();
    const snapshot = engine.snapshot();
    const plane = snapshot.aircraft!.find((p) => p.id === aircraft)!;
    const closed = fleet!.crossingClosed[0] === 1;
    if (closed) closedSteps++;
    // Across the road, the aircraft keeps moving.
    if (plane && Math.abs(plane.y - 300) < 25) expect(plane.speedMps).toBeGreaterThan(0.5);
    for (let i = 0; i < snapshot.count; i++) {
      const detail = engine.inspect(snapshot.id[i]!)!;
      if (detail.state !== 'driving') continue;
      // No car is within 20 m of the link while the aircraft's body is within 15 m of the road.
      if (plane && Math.abs(plane.y - 300) < 36.2 / 2 + 15)
        expect(Math.abs(snapshot.x[i]! + 600)).toBeGreaterThan(20);
      const stopM = stopOn.get(detail.lane);
      if (
        closed &&
        stopM !== undefined &&
        detail.speedMps < 0.1 &&
        Math.abs(detail.positionM - stopM) < 3
      )
        held++;
    }
  }
  expect(closedSteps).toBeGreaterThan(100);
  expect(held).toBeGreaterThan(50);
  expect(engine.metrics().trips.completed).toBe(6);
  expect(engine.metrics().aircraft!.towed).toBe(1);
});

test.each([
  ['parallel', syntheticAirport],
  ['backtrack', syntheticAirportBacktrack],
] as const)(
  'TASK-296 synthetic airport (%s): an arrival parks, two departures leave, the backtrack turns at the end',
  (layout, build) => {
    const compiled = setup(build(1));
    const graph = compiled.airside!;
    const fleet = createAircraftFleet(graph, 1);
    const stand = (ref: string) => graph.stands.find((s) => s.ref === ref)!.id;
    const e190 = fleet.spawnParked({ typeId: 'E190', stand: stand('1') });
    const a333 = fleet.spawnParked({ typeId: 'A333', stand: stand('3') });
    if (!e190.ok || !a333.ok) throw new Error('parked');
    fleet.requestDeparture(e190.id, '27');
    fleet.requestDeparture(a333.id, '09');
    const arrival = fleet.requestArrival({ typeId: 'BCS3', runwayEnd: '27', stand: stand('4') });
    if (!arrival.ok) throw new Error(arrival.reason);
    const { poses } = run(
      fleet,
      1800,
      () => fleet.metrics().departed === 2 && fleet.idle(arrival.id),
    );
    expect(fleet.metrics()).toMatchObject({ departed: 2, landed: 1, stuck: 0 });
    expect(fleet.parked().map((p) => p.id)).toEqual([arrival.id]);
    const lineUp = poses.get(e190.id)!.filter((p) => p.state === 'line-up');
    // With one midfield entrance (x = 1400) the 27 departure taxis east along the runway to
    // the end (x = 2800) and turns round; with the parallel taxiway it enters at the end.
    if (layout === 'backtrack') {
      expect(lineUp.some((p) => p.onRunway && Math.cos(p.heading) > 0.99 && p.x < 2600)).toBe(true);
      expect(Math.max(...lineUp.map((p) => p.x))).toBeGreaterThan(2780);
    } else expect(lineUp.every((p) => p.x > 2600)).toBe(true);
    // The widebody takes only code E edges.
    for (const p of poses.get(a333.id)!)
      for (const e of p.route) expect(graph.edges[e]!.maxCode).toBeGreaterThanOrEqual(4);
  },
);
