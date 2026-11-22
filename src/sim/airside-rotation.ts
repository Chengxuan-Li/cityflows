import { createRandom } from '../geo/random';
import { londonCitySchedule } from '../demand/flight-schedule';
import { aircraftTurnaroundMinutes, aircraftTypes } from '../schema/aircraft';
import type { AircraftFleet } from './aircraft';
import { chooseRunwayConfiguration } from './runway-configuration';

// TASK-298: a scripted rotation that keeps an airport moving until flight operations (TASK-299)
// drive the fleet from a schedule. Every 5 minutes it alternates a departure of the aircraft
// parked longest past its turnaround with an arrival to a free stand, about a dozen movements an
// hour; at the start every other stand holds a parked aircraft. Arrivals and departures use the
// runway end TASK-308's chooser picks for the prevailing west-south-westerly (240 degrees, 8 kt).

const INTERVAL_S = 300;
const PREVAILING_WIND = { fromDeg: 240, speedKt: 8 };

export function createAirsideRotation(fleet: AircraftFleet, seed: number, startS: number) {
  const { graph } = fleet;
  const random = createRandom(seed).derive('airside-rotation');
  const ends = graph.runways.flatMap((r) =>
    r.ends.map((e) => ({ designator: e.designator, headingRad: e.heading })),
  );
  const configuration = ends.length
    ? chooseRunwayConfiguration({ ends }, ((startS % 86_400) + 86_400) % 86_400, PREVAILING_WIND)
    : null;
  const arrivalEnd = configuration?.arrivalEnds[0] ?? ends[0]?.designator;
  const departureEnd = configuration?.departureEnds[0] ?? ends[0]?.designator;
  const longestM = Math.max(0, ...graph.runways.map((r) => r.lengthM));
  // London City's mix where it is London City, else every fixed-wing type the runway takes.
  const mix =
    graph.icao === 'EGLC'
      ? londonCitySchedule.typeMix.map((t) => t.typeId)
      : aircraftTypes
          .filter(
            (t) => t.performance.kind === 'fixedWing' && t.performance.takeoffRollM < longestM,
          )
          .map((t) => t.id);
  const stands = graph.stands.map((s) => s.idx);
  let nextS = startS + INTERVAL_S;
  let departureTurn = true;
  let started = false;

  function freeStand(typeId: string) {
    const options = stands.filter((s) => fleet.standFree(s) && fleet.standAdmits(s, typeId));
    return options.length ? options[Math.floor(random.next() * options.length)]! : -1;
  }

  function arrival() {
    for (let attempt = 0; attempt < mix.length; attempt++) {
      const typeId = mix[Math.floor(random.next() * mix.length)]!;
      const stand = freeStand(typeId);
      if (stand < 0 || !arrivalEnd) continue;
      if (
        fleet.requestArrival({ typeId, runwayEnd: arrivalEnd, stand: graph.stands[stand]!.id }).ok
      )
        return true;
    }
    return false;
  }

  function departure(timeS: number) {
    const ready = fleet
      .parked()
      .filter(
        (p) => p.stand >= 0 && timeS - p.sinceS >= (aircraftTurnaroundMinutes[p.typeId] ?? 30) * 60,
      )
      .sort((a, b) => a.sinceS - b.sinceS || a.id - b.id);
    for (const p of ready)
      if (departureEnd && fleet.requestDeparture(p.id, departureEnd).ok) return true;
    return false;
  }

  return {
    step(timeS: number) {
      if (!started) {
        started = true;
        stands.forEach((stand, i) => {
          if (i % 2) return;
          const typeId = mix[Math.floor(random.next() * mix.length)];
          // Parked since a turnaround ago, so each may leave at its turn.
          if (typeId && fleet.standAdmits(stand, typeId))
            fleet.spawnParked({ typeId, stand: graph.stands[stand]!.id }, timeS - 3600);
        });
      }
      if (timeS < nextS) return;
      nextS += INTERVAL_S;
      if (!(departureTurn ? departure(timeS) || arrival() : arrival() || departure(timeS))) return;
      departureTurn = !departureTurn;
    },
  };
}
