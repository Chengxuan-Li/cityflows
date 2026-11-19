import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { railTimetable } from '../../src/network/trams';
import { createRailCrossings, CROSSING_OPEN, CROSSING_WARNING } from '../../src/sim/rail-crossings';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { setup } from './fixtures';

/**
 * TASK-225 (Freiburg's Siegesdenkmal, crossings 9 and 17 of jg:13305): a tram route enters the map
 * 60 m before a crossing, closer than its warning time. The second run waits at its origin while the
 * first, held at a downstream crossing a car occupies, is delayed on the same tracks; the waiting
 * run must not keep the near crossing closed, and it gives a full fresh warning when it moves.
 * Without the rule the near crossing stays closed for the whole hold and gives no warning on release.
 */
function heldAtOrigin() {
  const { city, node, road } = buildCity('A tram held at its origin before a crossing', 225);
  const near = road(node(-400, 0), node(400, 0));
  const far = road(node(-400, 600), node(400, 600));
  near.provenance = { source: 'generated', osmIds: [10] };
  far.provenance = { source: 'generated', osmIds: [20] };
  const rail = operatingCrossing('tram').rail!;
  rail.nodes['rn:1']!.pos = { x: 0, y: -60 };
  rail.tracks['rt:1']!.line = [
    { x: 0, y: -60 },
    { x: 0, y: 0 },
  ];
  rail.nodes['rn:4'] = {
    id: 'rn:4',
    pos: { x: 0, y: 600 },
    kind: 'level_crossing',
    layer: 0,
    crossing: { kind: 'tram', roadOsmIds: [20] },
  };
  rail.tracks['rt:2']!.to = 'rn:4';
  rail.tracks['rt:2']!.line = [
    { x: 0, y: 0 },
    { x: 0, y: 600 },
  ];
  rail.tracks['rt:3'] = {
    ...rail.tracks['rt:2']!,
    id: 'rt:3',
    from: 'rn:4',
    to: 'rn:3',
    line: [
      { x: 0, y: 600 },
      { x: 0, y: 1000 },
    ],
  };
  city.rail = rail;
  const compiled = setup(city),
    table = railTimetable(compiled.rail!);
  table.departures = [
    { route: 0, timeS: 0, requestedS: 0 },
    { route: 0, timeS: 90, requestedS: 90 },
  ];
  const facilities = compiled.rail!.facilities!;
  expect(facilities).toHaveLength(2);
  const [nearCrossing, farCrossing] = facilities[0]!.nodes.includes('rn:2') ? [0, 1] : [1, 0];
  // A car stands on the far crossing's road surface.
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  vehicles.state[0] = DRIVING;
  const span = facilities[farCrossing]!.spans!.find((s) => s.segment >= 0)!;
  vehicles.insert(0, span.segment, (span.fromM + span.toM) / 2);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 0, () => false)!;
  return { control, vehicles, span, nearCrossing };
}

test('T75 a run held at its origin does not keep the crossing ahead of it closed (TASK-225)', () => {
  const { control, nearCrossing } = heldAtOrigin();
  // The first run clears the near crossing within its first minute, then waits at the far one.
  let closedWhileWaiting = 0;
  for (let i = 0; i < 3000; i++) {
    const time = i * 0.1;
    control.step(time);
    if (time > 120 && control.snapshot().crossings[nearCrossing] !== CROSSING_OPEN)
      closedWhileWaiting++;
  }
  expect(closedWhileWaiting).toBe(0);
});

test('T75 a run released at its origin gives the crossing ahead a full warning (TASK-225)', () => {
  const { control, vehicles, span, nearCrossing } = heldAtOrigin();
  for (let i = 0; i < 3000; i++) control.step(i * 0.1);
  vehicles.position[0] = span.toM + 40;
  let warningAt = Infinity,
    closedAt = Infinity;
  for (let i = 0; i < 3000; i++) {
    const time = 300 + i * 0.1;
    control.step(time);
    const state = control.snapshot().crossings[nearCrossing];
    if (state === CROSSING_WARNING) warningAt = Math.min(warningAt, time);
    if (state !== CROSSING_OPEN && state !== CROSSING_WARNING) closedAt = Math.min(closedAt, time);
  }
  expect(Number.isFinite(warningAt)).toBe(true);
  expect(closedAt).toBeGreaterThan(warningAt);
});
