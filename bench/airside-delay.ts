import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { compile } from '../src/network';
import { compileAirside } from '../src/network/airside';
import { openProject } from '../src/project/open';
import { airportSchedules, largeAirportSchedule } from '../src/demand/flight-schedule';
import { createAircraftFleet, type AircraftPoseSnapshot } from '../src/sim/aircraft';
import { createFlightOperations } from '../src/sim/flight-operations';
import { overlaps, runwayConflictCheck } from '../tests/sim/aircraft-checks';
import { nearestOnPolyline } from '../src/geo/polyline';
import { aircraftTypes } from '../src/schema/aircraft';

// TASK-317 / TASK-312: the airside alone (no roads, no rendering), sampled every simulated
// second, with each movement's time split by the state it spends it in.
//   node --experimental-strip-types --import ./bench/register.ts bench/airside-delay.ts \
//     PROJECT SEED OUTPUT [--from H] [--to H] [--drain H] [--daily N] [--checks]
// --from / --to: the window of planned times reported (hours; default the whole day); the run
// starts at --from with the apron as the schedule has it and goes on --drain hours past --to
// (default 1, or to midnight for a whole day). --daily: fixed-wing movements in place of the
// airport's schedule size. --checks: count body overlaps and runway conflicts each second.
// --roads (TASK-320): compile the whole city as the app does (road crossings, and the apron roads
// that parked aircraft keep clear of) in place of the airside alone.
const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  const bare = name === 'checks' || name === 'roads';
  return at < 0 ? undefined : (args.splice(at, bare ? 1 : 2)[1] ?? '');
};
const fromH = Number(flag('from') ?? 0);
const toH = Number(flag('to') ?? 24);
const drainH = Number(flag('drain') ?? (toH >= 24 ? 0 : 1));
const daily = flag('daily');
const checks = flag('checks') !== undefined;
const roads = flag('roads') !== undefined;
const [projectPath, seedArg, output] = args;
if (!projectPath || !seedArg || !output) throw new Error('Expected project path, seed and output');
const seed = Number(seedArg);
const project = await openProject(readFileSync(projectPath));
if (!project.ok) throw new Error('Project did not open');
const { city } = project.project;
if (!city.airport) throw new Error('Project has no airport');
const whole = roads ? compile(city) : null;
if (whole && !whole.ok) throw new Error('City did not compile');
const graph =
  whole?.compiled.airside ??
  compileAirside(city.airport, city, {
    roads: [],
    lanes: [],
    movements: [],
    index: { road: new Map() },
  });
if (daily !== undefined)
  (airportSchedules[graph.icao ?? ''] ?? largeAirportSchedule).dailyMovements = Number(daily);
const fleet = createAircraftFleet(graph, seed);
const startS = fromH * 3600;
const windowEndS = toH * 3600;
const endS = Math.min(86_400, windowEndS + drainH * 3600);
const newTiming = () => ({
  taxiMovingS: 0,
  taxiDistanceM: 0,
  peakTaxiMps: 0,
  surfaceWaitS: 0,
  holdS: 0,
  pushbackS: 0,
  pushbackDistanceM: 0,
  runwayS: 0,
  airborneS: 0,
  goAroundS: 0,
  sequencingS: 0,
  startWaitS: 0,
});
type Timing = ReturnType<typeof newTiming>;

interface Track {
  arrival: Timing;
  departure: Timing;
  arrivalRequestS?: number;
  departureRequestS?: number;
  touchdownS?: number;
  parkedS?: number;
  offBlockS?: number;
  wheelsOffS?: number;
  departedS?: number;
  goArounds: number;
}
const tracks = new Map<number, Track>();
function track(id: number) {
  let row = tracks.get(id);
  if (!row) {
    row = { arrival: newTiming(), departure: newTiming(), goArounds: 0 };
    tracks.set(id, row);
  }
  return row;
}

let timeS = startS;
// TASK-329: aircraft stuck 5 min or more (on the ground away from a stand: not parked or ready
// for pushback, still for 300 s), and a gridlock: 3 or more of them with no landing or departure
// for 30 min.
let lastCompletionS = startS;
const stillSince = new Map<number, number>();
let peakStuck5 = 0;
let stuck5 = 0;
let gridlockS: number | null = null;
const requestArrival = fleet.requestArrival;
fleet.requestArrival = (...args) => {
  const result = requestArrival(...args);
  if (result.ok) track(result.id).arrivalRequestS = timeS;
  return result;
};
const requestHelicopterArrival = fleet.requestHelicopterArrival;
fleet.requestHelicopterArrival = (...args) => {
  const result = requestHelicopterArrival(...args);
  if (result.ok) track(result.id).arrivalRequestS = timeS;
  return result;
};
const requestDeparture = fleet.requestDeparture;
fleet.requestDeparture = (...args) => {
  const result = requestDeparture(...args);
  if (result.ok) track(result.id).departureRequestS = timeS;
  return result;
};
/** TASK-330: touchdowns by runway end, for landings per hour and the gap between them. */
const touchdowns: { timeS: number; end: string }[] = [];
const drainEvents = fleet.drainEvents;
fleet.drainEvents = () => {
  const events = drainEvents();
  for (const event of events) {
    const row = track(event.id);
    switch (event.kind) {
      case 'landed':
        lastCompletionS = event.timeS;
        row.touchdownS = event.timeS;
        touchdowns.push({
          timeS: event.timeS,
          end: fleet.snapshot().find((pose) => pose.id === event.id)?.runwayEnd ?? '?',
        });
        break;
      case 'parked':
        row.parkedS = event.timeS;
        break;
      case 'off-block':
        row.offBlockS = event.timeS;
        break;
      case 'departed':
        lastCompletionS = event.timeS;
        row.departedS = event.timeS;
        break;
      case 'go-around':
        row.goArounds++;
        break;
    }
  }
  return events;
};

function sample(timing: Timing, pose: AircraftPoseSnapshot) {
  if (pose.state === 'go-around') timing.goAroundS++;
  else if (pose.state === 'holding') timing.holdS++;
  else if (pose.onRunway || pose.state === 'line-up') timing.runwayS++;
  else if (pose.state === 'pushback') {
    timing.pushbackS++;
    timing.pushbackDistanceM += pose.speedMps;
  } else if (pose.airborne && pose.state !== 'hover-taxi') timing.airborneS++;
  else if (pose.state === 'taxi' || pose.state === 'hover-taxi') {
    if (pose.speedMps > 0.05) {
      timing.taxiMovingS++;
      timing.taxiDistanceM += pose.speedMps;
      timing.peakTaxiMps = Math.max(timing.peakTaxiMps, pose.speedMps);
    } else timing.surfaceWaitS++;
  }
}

const checkRunwayConflicts = runwayConflictCheck(graph);
let overlapCount = 0;
let runwayConflicts = 0;
let runwayShared = 0;
let runwayCrossersApart = 0;
const spans = new Map(aircraftTypes.map((t) => [t.id, t.spanM]));
const rcKinds = new Map<string, number>();
let peakStuck = 0;
let peakActive = 0;

const wall0 = performance.now();
const operations = createFlightOperations(fleet, seed, startS);
console.info({ airport: graph.icao, seed, fromH, toH, endH: endS / 3600, ...operations.metrics() });
for (let step = startS * 10; step < endS * 10; step++) {
  timeS = step / 10;
  operations.step(timeS);
  fleet.step(timeS);
  if (step % 10) continue;
  const poses = fleet.snapshot();
  const seen = new Set<number>();
  for (const pose of poses) {
    seen.add(pose.id);
    const row = track(pose.id);
    if (row.arrivalRequestS !== undefined && row.parkedS === undefined) sample(row.arrival, pose);
    if (row.offBlockS !== undefined && row.departedS === undefined) {
      if (pose.airborne && pose.state !== 'hover-taxi') row.wheelsOffS ??= timeS;
      sample(row.departure, pose);
    }
  }
  // The fleet keeps queued aircraft off the map. Parked departures with a request are waiting
  // for their start (surface clearance), apart from turnaround or a tow.
  for (const [id, row] of tracks) {
    if (row.arrivalRequestS !== undefined && row.touchdownS === undefined && !seen.has(id))
      row.arrival.sequencingS++;
    if (row.departureRequestS !== undefined && row.offBlockS === undefined)
      row.departure.startWaitS++;
  }
  stuck5 = 0;
  for (const pose of poses) {
    if (
      pose.airborne ||
      pose.state === 'parked' ||
      pose.state === 'ready-for-pushback' ||
      pose.speedMps > 0.3
    )
      stillSince.delete(pose.id);
    else if (timeS - (stillSince.get(pose.id) ?? (stillSince.set(pose.id, timeS), timeS)) >= 300)
      stuck5++;
  }
  peakStuck5 = Math.max(peakStuck5, stuck5);
  if (gridlockS === null && stuck5 >= 3 && timeS - lastCompletionS >= 1800) gridlockS = timeS;
  const metrics = fleet.metrics();
  peakStuck = Math.max(peakStuck, metrics.stuck);
  peakActive = Math.max(peakActive, metrics.active);
  if (checks) {
    {
      const found = overlaps(poses);
      overlapCount += found.length;
      if (found.length && process.env.OVDBG)
        for (const pair of found) {
          const [a, b] = pair.map((r: string) => poses.find((p) => p.registration === r)!);
          console.error(
            'OVERLAP',
            (timeS / 3600).toFixed(3),
            JSON.stringify(
              [a, b].map(
                (p) =>
                  p && [
                    p.id,
                    p.typeId,
                    p.state,
                    Math.round(p.x),
                    Math.round(p.y),
                    p.speedMps.toFixed(1),
                    p.stand,
                    p.runwayEnd,
                  ],
              ),
            ),
          );
        }
    }
    {
      const found = checkRunwayConflicts(poses);
      if (found) {
        // TASK-330 Phase 1e: of the pairs on one runway, a crossing aircraft (taxi or tow) at
        // least 150 m behind a landing roll or take-off moving away (the owner's crossing behind
        // a lander); RCDBG classifies the rest.
        const on = poses.filter((p) => p.onRunway);
        const runwayOf = (p: (typeof on)[number]) => {
          let best = -1;
          let away = Infinity;
          for (const r of graph.runways) {
            const near = nearestOnPolyline(r.line, p);
            if (near.away <= r.widthM / 2 + 5 && near.away < away) {
              away = near.away;
              best = r.idx;
            }
          }
          return best;
        };
        const rw = on.map(runwayOf);
        let apart = 0;
        for (let i = 0; i < on.length; i++)
          for (let j = i + 1; j < on.length; j++) {
            if (rw[i]! < 0 || rw[i] !== rw[j]) continue;
            const a = on[i]!,
              b = on[j]!;
            const crossing = (p: typeof a) => p.state === 'taxi' || p.state === 'tow';
            const note = (k: string) => {
              if (process.env.RCDBG) rcKinds.set(k, (rcKinds.get(k) ?? 0) + 1);
            };
            if (crossing(a) === crossing(b)) {
              if (crossing(a)) {
                // Two crossings: apart if their points along the runway are more than half their
                // spans plus 15 m apart and both run across it (over 30 degrees off its line).
                const r = graph.runways[rw[i]!]!;
                const ua = nearestOnPolyline(r.line, a).along;
                const ub = nearestOnPolyline(r.line, b).along;
                const span = (p: typeof a) => spans.get(p.typeId) ?? 40;
                const across = (p: typeof a) =>
                  Math.abs(Math.sin(p.heading - r.ends[0]!.heading)) > Math.sin(Math.PI / 6);
                const apartPoints =
                  Math.abs(ua - ub) > (span(a) + span(b)) / 2 + 15 && across(a) && across(b);
                if (apartPoints) runwayCrossersApart++;
                note(
                  `both crossing: ${apartPoints ? 'different points, paths apart' : 'same or meeting'}`,
                );
              } else note(`both moving: ${a.state}/${b.state}`);
              continue;
            }
            const [mover, crosser] = crossing(a) ? [b, a] : [a, b];
            const back =
              (mover.x - crosser.x) * Math.cos(mover.heading) +
              (mover.y - crosser.y) * Math.sin(mover.heading);
            if (back >= 150) apart++;
            note(
              `${back >= 150 ? 'behind>=150' : back >= 0 ? 'behind<150' : 'ahead'} of ${mover.state}`,
            );
          }
        runwayConflicts += found;
        runwayShared += Math.min(found, apart);
      }
    }
  }
  if (timeS % 3600 === 0 && timeS > startS)
    console.info(
      JSON.stringify({
        h: timeS / 3600,
        wallS: Math.round((performance.now() - wall0) / 1000),
        ...operations.metrics(),
        active: metrics.active,
        queued: metrics.queuedArrivals,
        stuck: metrics.stuck,
        stuck5,
      }),
    );
}
timeS = endS;
operations.step(endS);

// Separate stand admission and pre-departure readiness from the aircraft-level clocks.
const board = operations.board(endS);
const byRegistration = new Map<string, Track>();
for (const [id, row] of tracks) {
  const registration = fleet.registrationOf(id)!;
  if (byRegistration.has(registration)) throw new Error(`Duplicate registration ${registration}`);
  byRegistration.set(registration, row);
}
const inWindow = ({ timeS }: { timeS: number }) => timeS >= startS && timeS < windowEndS;
const arrivals = board.arrivals.filter(inWindow).map((movement) => {
  const row = movement.registration ? byRegistration.get(movement.registration) : undefined;
  const dispatchS = Math.max(0, Math.ceil(movement.timeS - fleet.arrivalLeadS(movement.typeId)));
  const waitEndS =
    row?.arrivalRequestS ??
    (movement.state === 'diverted' ? movement.timeS + movement.delayS! : endS);
  return {
    ...movement,
    ...(row?.arrival ?? newTiming()),
    standWaitS: Math.max(0, waitEndS - Math.max(startS, dispatchS)),
    goArounds: row?.goArounds ?? 0,
    taxiS:
      row?.parkedS !== undefined && row.touchdownS !== undefined
        ? row.parkedS - row.touchdownS
        : null,
  };
});
const departures = board.departures.filter(inWindow).map((movement) => {
  const row = movement.registration ? byRegistration.get(movement.registration) : undefined;
  const readyEndS = row?.departureRequestS ?? row?.offBlockS ?? endS;
  return {
    ...movement,
    ...(row?.departure ?? newTiming()),
    readinessS: movement.state === 'cancelled' ? 0 : Math.max(0, readyEndS - movement.timeS),
    taxiS:
      row?.wheelsOffS !== undefined && row.offBlockS !== undefined
        ? row.wheelsOffS - row.offBlockS
        : null,
  };
});

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / (values.length || 1);
const round = (value: number) => Math.round(value * 10) / 10;
function stages<T extends Record<string, unknown>>(rows: T[], keys: (keyof T)[]) {
  return Object.fromEntries(
    keys.map((key) => [key, round(mean(rows.map((r) => r[key] as number)))]),
  );
}
const done = (state: string) => state === 'arrived' || state === 'departed';
const delays = [...arrivals, ...departures].filter((m) => done(m.state)).map((m) => m.delayS!);
const moving = (rows: (Timing & { taxiS: number | null })[]) => {
  const finished = rows.filter((r) => r.taxiS !== null);
  return {
    meanMovingKt: round(
      (mean(finished.map((r) => r.taxiDistanceM)) /
        (mean(finished.map((r) => r.taxiMovingS)) || 1)) *
        1.943844,
    ),
    peakKt: round(Math.max(0, ...finished.map((r) => r.peakTaxiMps)) * 1.943844),
    meanTaxiMin: round(mean(finished.map((r) => r.taxiS!)) / 60),
  };
};
const summary = {
  airport: graph.icao,
  seed,
  window: [fromH, toH],
  wallS: Math.round((performance.now() - wall0) / 1000),
  scheduled: arrivals.length + departures.length,
  completed: delays.length,
  diverted: arrivals.filter((m) => m.state === 'diverted').length,
  cancelled: departures.filter((m) => m.state === 'cancelled').length,
  meanDelayS: round(mean(delays)),
  worstDelayS: round(Math.max(0, ...delays)),
  goArounds: arrivals.reduce((n, m) => n + m.goArounds, 0),
  peakActive,
  peakStuck,
  peakStuck5,
  endStuck5: stuck5,
  endQueued: fleet.metrics().queuedArrivals,
  gridlockH: gridlockS === null ? null : round(gridlockS / 3600),
  ...(checks && { overlapCount, runwayConflicts, runwayShared, runwayCrossersApart }),
  day: operations.metrics(),
  fleet: fleet.metrics(),
  arrivalStages: stages(arrivals, [
    'standWaitS',
    'sequencingS',
    'airborneS',
    'runwayS',
    'taxiMovingS',
    'surfaceWaitS',
    'holdS',
    'goAroundS',
  ]),
  departureStages: stages(departures, [
    'readinessS',
    'startWaitS',
    'surfaceWaitS',
    'pushbackS',
    'taxiMovingS',
    'holdS',
    'runwayS',
    'airborneS',
  ]),
  taxiIn: moving(arrivals),
  taxiOut: moving(departures),
  landings: Object.fromEntries(
    [...new Set(touchdowns.map((t) => t.end))].sort().map((end) => {
      const times = touchdowns
        .filter((t) => t.end === end && t.timeS >= startS && t.timeS < windowEndS)
        .map((t) => t.timeS);
      const gaps = times
        .slice(1)
        .map((t, i) => t - times[i]!)
        .sort((a, b) => a - b);
      return [
        end,
        {
          perHour: round(times.length / ((windowEndS - startS) / 3600)),
          medianGapS: gaps.length ? round(gaps[gaps.length >> 1]!) : null,
        },
      ];
    }),
  ),
};
writeFileSync(output, JSON.stringify({ ...summary, arrivals, departures }, null, 2));
console.info(JSON.stringify(summary, null, 1));
if (process.env.RCDBG) console.info('RCKINDS', JSON.stringify(Object.fromEntries(rcKinds)));
