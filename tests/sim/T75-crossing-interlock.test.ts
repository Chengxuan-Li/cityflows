import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { railTimetable } from '../../src/network/trams';
import { trainPositionAt } from '../../src/network/trains';
import {
  createRailCrossings,
  CROSSING_CLOSED,
  CROSSING_OPEN,
  CROSSING_WARNING,
} from '../../src/sim/rail-crossings';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicleProfiles, createVehicles, DRIVING } from '../../src/sim/vehicle';
import { setup } from './fixtures';

function interlockedCrossings() {
  const { city, node, road } = buildCity(
    'A downstream crossing releases an upstream discharge',
    147,
  );
  const first = road(node(-400, 0), node(400, 0));
  const second = road(node(-400, 60), node(400, 60));
  first.provenance = { source: 'generated', osmIds: [10] };
  second.provenance = { source: 'generated', osmIds: [20] };
  city.rail = operatingCrossing('tram').rail;
  const rail = city.rail!;
  rail.nodes['rn:4'] = {
    id: 'rn:4',
    pos: { x: 0, y: 60 },
    kind: 'level_crossing',
    layer: 0,
    crossing: { kind: 'tram', roadOsmIds: [20] },
  };
  rail.tracks['rt:2']!.to = 'rn:4';
  rail.tracks['rt:2']!.line = [
    { x: 0, y: 0 },
    { x: 0, y: 60 },
  ];
  rail.tracks['rt:3'] = {
    ...rail.tracks['rt:2']!,
    id: 'rt:3',
    from: 'rn:4',
    to: 'rn:3',
    line: [
      { x: 0, y: 60 },
      { x: 0, y: 1000 },
    ],
  };
  const compiled = setup(city),
    table = railTimetable(compiled.rail!);
  table.departures = [{ route: 0, timeS: 0, requestedS: 0 }];
  expect(compiled.rail!.facilities).toHaveLength(2);
  const facilities = compiled.rail!.facilities!;
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  vehicles.state[0] = DRIVING;
  const span = facilities[0]!.spans!.find((s) => s.segment >= 0)!;
  vehicles.insert(0, span.segment, (span.fromM + span.toM) / 2);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 60, () => false)!;
  const route = table.routes[0]!;
  const downstreamRailStart = Math.min(
    ...facilities[1]!.railSpans!.flatMap((span) =>
      route.sections
        .filter((s) => s.track === span.track)
        .map(
          (s) =>
            s.startM +
            (s.forward ? span.fromM : compiled.rail!.tracks[s.track]!.lengthM - span.toM),
        ),
    ),
  );
  return { compiled, facilities, vehicles, span, control, route, table, downstreamRailStart };
}

test('T75 a train positively held at an upstream crossing releases the downstream discharge', () => {
  const { control } = interlockedCrossings();
  let held = 0,
    previouslyProtected = false;
  for (let i = 0; i < 1000; i++) {
    control.step(60 + i * 0.1);
    const rail = control.snapshot();
    previouslyProtected ||= rail.crossings[1] === CROSSING_CLOSED;
    if (rail.trains[0]?.speedMps === 0 && previouslyProtected) {
      held++;
      expect(rail.crossings[0]).toBe(CROSSING_CLOSED);
      expect(rail.crossings[1]).toBe(CROSSING_OPEN);
    }
  }
  expect(held).toBeGreaterThan(100);
});

test('T75 a released downstream crossing gives a full fresh warning before rail nose entry', () => {
  const { compiled, facilities, vehicles, span, control, downstreamRailStart } =
    interlockedCrossings();
  for (let i = 0; i < 1000; i++) control.step(60 + i * 0.1);
  expect(control.snapshot().crossings[1]).toBe(CROSSING_OPEN);
  vehicles.position[0] = span.toM + 40;
  let warningAt = Infinity,
    enteredAt = Infinity;
  for (let i = 0; i < 600; i++) {
    const time = 160 + i * 0.1;
    control.step(time);
    const rail = control.snapshot();
    if (rail.crossings[1] === CROSSING_WARNING) warningAt = Math.min(warningAt, time + 0.1);
    if (rail.trains[0] && rail.trains[0].positionM + 18 >= downstreamRailStart)
      enteredAt = Math.min(enteredAt, time + 0.1);
  }
  const profiles = createVehicleProfiles(DEFAULT_SIM_PARAMS);
  const speed = Math.max(
    ...facilities[1]!.stops!.map((s) => compiled.lanes[s.lane]!.speedLimitMps),
  );
  const warningS = Math.max(12, speed / Math.min(...profiles.map((p) => p.idm.bMps2)) + 6);
  expect(Number.isFinite(warningAt)).toBe(true);
  expect(Number.isFinite(enteredAt)).toBe(true);
  expect(enteredAt - warningAt).toBeGreaterThanOrEqual(warningS - 0.11);
});

test('T75 an overlapping service already in the downstream band keeps it protected', () => {
  const { compiled, vehicles, control, table, route, downstreamRailStart } = interlockedCrossings();
  for (let i = 0; i < 1000; i++) control.step(60 + i * 0.1);
  table.departures.push({ route: 0, timeS: -60, requestedS: -60 });
  let low = 0,
    high = route.durationS;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (trainPositionAt(route, mid).positionM + 18 < downstreamRailStart + 2) low = mid;
    else high = mid;
  }
  const overlapping = createRailCrossings(
    compiled,
    vehicles,
    DEFAULT_SIM_PARAMS,
    160,
    () => false,
    [
      ...control.clocks(),
      { routeId: route.id, requestedS: -60, cycle: 0, ageS: high, held: false },
    ],
  )!;
  for (let i = 0; i < 20; i++) {
    overlapping.step(160 + i * 0.1);
    expect(overlapping.snapshot().crossings[1]).toBe(CROSSING_CLOSED);
  }
});

test('T75 live edits retain both the released interlock and a fresh warning already in progress', () => {
  const { compiled, vehicles, span, control } = interlockedCrossings();
  for (let i = 0; i < 1000; i++) control.step(60 + i * 0.1);
  let patched = createRailCrossings(
    compiled,
    vehicles,
    DEFAULT_SIM_PARAMS,
    160,
    () => false,
    control.clocks(),
  )!;
  expect(patched.snapshot()).toEqual(control.snapshot());
  vehicles.position[0] = span.toM + 40;
  for (let i = 0; i < 600; i++) {
    const time = 160 + i * 0.1;
    control.step(time);
    patched.step(time);
    expect(patched.snapshot()).toEqual(control.snapshot());
    if (i === 5) {
      patched = createRailCrossings(
        compiled,
        vehicles,
        DEFAULT_SIM_PARAMS,
        time + 0.1,
        () => false,
        patched.clocks(),
      )!;
      expect(patched.snapshot()).toEqual(control.snapshot());
    }
  }
});
