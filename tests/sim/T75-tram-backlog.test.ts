import { expect, test } from 'vitest';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { railTimetable } from '../../src/network/trams';
import { createRailCrossings } from '../../src/sim/rail-crossings';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { setup } from './fixtures';

/**
 * TASK-228 (Freiburg's tram backlog): a run waiting at its origin waited for every delayed run on
 * any track its route shares, until that run left the map, so one delay queued every later
 * departure behind it. Here the first run of a tram line is held at the crossing by a car, then
 * goes on behind its timetable over three 1 km blocks; the next run is due well after it has
 * cleared each block it will use, and enters on time. While the first run stands, it waits.
 */
function lateLeader() {
  const city = operatingCrossing('tram');
  const rail = city.rail!;
  // rt:2 (rn:2 to rn:3) is the first 1 km block past the crossing; two more follow it.
  for (const i of [4, 5]) {
    rail.nodes[`rn:${i}`] = {
      id: `rn:${i}`,
      pos: { x: 0, y: (i - 2) * 1000 },
      kind: 'plain',
      layer: 0,
    };
    rail.tracks[`rt:${i - 1}`] = {
      ...rail.tracks['rt:2']!,
      id: `rt:${i - 1}`,
      from: `rn:${i - 1}`,
      to: `rn:${i}`,
      line: [
        { x: 0, y: (i - 3) * 1000 },
        { x: 0, y: (i - 2) * 1000 },
      ],
    };
  }
  const compiled = setup(city),
    table = railTimetable(compiled.rail!);
  expect(table.routes).toHaveLength(1);
  expect(table.routes[0]!.sections).toHaveLength(4);
  table.departures = [
    { route: 0, timeS: 0, requestedS: 0 },
    { route: 0, timeS: 250, requestedS: 250 },
  ];
  const span = compiled.rail!.facilities![0]!.spans!.find((s) => s.segment >= 0)!;
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  vehicles.state[0] = DRIVING;
  vehicles.insert(0, span.segment, (span.fromM + span.toM) / 2);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 0, () => false)!;
  return { control, vehicles, span };
}

function run(clearAtS: number) {
  const { control, vehicles, span } = lateLeader();
  let enteredS = Infinity;
  for (let i = 0; i < 4000; i++) {
    const timeS = i * 0.1;
    if (timeS === clearAtS) vehicles.position[0] = span.toM + 40;
    control.step(timeS);
    const trains = control.snapshot().trains;
    const tracks = trains.flatMap((t) => t.occupied);
    expect(new Set(tracks).size).toBe(tracks.length);
    if (trains.some((t) => t.id.includes('/250/') && t.cars.length))
      enteredS = Math.min(enteredS, timeS);
  }
  return enteredS;
}

test('T75 a run enters on time behind a late run that has cleared its blocks (TASK-228)', () => {
  // The car leaves at 150 s: the first run is about a minute late, three minutes ahead of the next.
  expect(run(150)).toBeLessThan(251);
});

test('T75 a run waits at its origin while a late run on its tracks stands (TASK-228)', () => {
  expect(run(Infinity)).toBe(Infinity);
});
