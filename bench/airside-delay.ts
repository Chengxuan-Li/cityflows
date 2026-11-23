import { readFileSync, writeFileSync } from 'node:fs';
import { compileAirside } from '../src/network/airside';
import { openProject } from '../src/project/open';
import { createAircraftFleet, type AircraftPoseSnapshot } from '../src/sim/aircraft';
import { createFlightOperations } from '../src/sim/flight-operations';

// node --experimental-strip-types --import ./bench/register.ts bench/airside-delay.ts PROJECT SEED OUTPUT
const [projectPath, seedArg, output] = process.argv.slice(2);
if (!projectPath || !seedArg || !output) throw new Error('Expected project path, seed and output');
const seed = Number(seedArg);
const project = await openProject(readFileSync(projectPath));
if (!project.ok) throw new Error('Project did not open');
const { city } = project.project;
if (!city.airport) throw new Error('Project has no airport');
const graph = compileAirside(city.airport, city, {
  roads: [],
  lanes: [],
  movements: [],
  index: { road: new Map() },
});
const fleet = createAircraftFleet(graph, seed);
const dayS = 86_400;
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

let timeS = 0;
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
const drainEvents = fleet.drainEvents;
fleet.drainEvents = () => {
  const events = drainEvents();
  for (const event of events) {
    const row = track(event.id);
    switch (event.kind) {
      case 'landed':
        row.touchdownS = event.timeS;
        break;
      case 'parked':
        row.parkedS = event.timeS;
        break;
      case 'off-block':
        row.offBlockS = event.timeS;
        break;
      case 'departed':
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

const operations = createFlightOperations(fleet, seed, 0);
console.info({ airport: graph.icao, seed, ...operations.metrics() });
for (let step = 0; step < dayS * 10; step++) {
  timeS = step / 10;
  operations.step(timeS);
  fleet.step(timeS);
  if (step % 10) continue;
  const seen = new Set<number>();
  for (const pose of fleet.snapshot()) {
    seen.add(pose.id);
    const row = track(pose.id);
    if (row.arrivalRequestS !== undefined && row.parkedS === undefined) sample(row.arrival, pose);
    if (row.offBlockS !== undefined && row.departedS === undefined) {
      if (pose.airborne && pose.state !== 'hover-taxi') row.wheelsOffS ??= timeS;
      sample(row.departure, pose);
    }
  }
  // The fleet keeps queued aircraft off the map. Parked departures with a request
  // are waiting for surface clearance, separately from turnaround or a tow.
  for (const [id, row] of tracks) {
    if (row.arrivalRequestS !== undefined && row.touchdownS === undefined && !seen.has(id))
      row.arrival.sequencingS++;
    if (row.departureRequestS !== undefined && row.offBlockS === undefined)
      row.departure.surfaceWaitS++;
  }
  if (timeS !== 0 && timeS % 21_600 === 0)
    console.info({ hour: timeS / 3600, ...operations.metrics(), fleet: fleet.metrics() });
}
timeS = dayS;
operations.step(dayS);

// Separate stand admission and pre-departure readiness from the aircraft-level clocks.
const board = operations.board(dayS);
const byRegistration = new Map<string, Track>();
for (const [id, row] of tracks) {
  const registration = fleet.registrationOf(id)!;
  if (byRegistration.has(registration)) throw new Error(`Duplicate registration ${registration}`);
  byRegistration.set(registration, row);
}
const arrivals = board.arrivals.map((movement) => {
  const row = movement.registration ? byRegistration.get(movement.registration) : undefined;
  const dispatchS = Math.max(0, Math.ceil(movement.timeS - fleet.arrivalLeadS(movement.typeId)));
  const endS =
    row?.arrivalRequestS ??
    (movement.state === 'diverted' ? movement.timeS + movement.delayS! : dayS);
  return {
    ...movement,
    ...(row?.arrival ?? newTiming()),
    standWaitS: Math.max(0, endS - dispatchS),
    goArounds: row?.goArounds ?? 0,
    taxiS:
      row?.parkedS !== undefined && row.touchdownS !== undefined
        ? row.parkedS - row.touchdownS
        : null,
  };
});
const departures = board.departures.map((movement) => {
  const row = movement.registration ? byRegistration.get(movement.registration) : undefined;
  const endS = row?.departureRequestS ?? row?.offBlockS ?? dayS;
  return {
    ...movement,
    ...(row?.departure ?? newTiming()),
    readinessS: movement.state === 'cancelled' ? 0 : Math.max(0, endS - movement.timeS),
    taxiS:
      row?.wheelsOffS !== undefined && row.offBlockS !== undefined
        ? row.wheelsOffS - row.offBlockS
        : null,
  };
});
const summary = { airport: graph.icao, seed, ...operations.metrics(), fleet: fleet.metrics() };
writeFileSync(output, JSON.stringify({ ...summary, arrivals, departures }, null, 2));
console.info(JSON.stringify(summary));
