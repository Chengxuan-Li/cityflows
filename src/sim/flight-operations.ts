import {
  airportSchedules,
  generateFlightSchedule,
  largeAirportSchedule,
  londonCitySchedule,
  type FlightScheduleInput,
  type ScheduledFlight,
} from '../demand/flight-schedule';
import { aircraftCodes, aircraftTurnaroundMinutes, aircraftTypes } from '../schema/aircraft';
import type { StandKind } from '../schema/airport';
import type { AircraftFleet, AircraftState, RunwaySnapshot, RunwayTransition } from './aircraft';
import {
  airportRunwayConcepts,
  createRunwayChooser,
  demonstratedCrosswindKt,
  windComponents,
  type AirportWind,
  type RunwayConfiguration,
  type RunwayConfigurationInput,
} from './runway-configuration';

const dayS = 86_400;
const standHoldS = 1800;
const returnLeadS = 1200;
const maintenanceS = 300;
const longTurnS = 75 * 60;
// A queued departure costs roughly one runway slot (75 s), expressed as taxi metres at 10 m/s.
const runwayQueueCostM = 750;
const prevailingWind: AirportWind = { fromDeg: 240, speedKt: 8 };
const isHelicopter = (typeId: string) =>
  aircraftTypes.find(({ id }) => id === typeId)!.class === 'helicopter';

/** Limit bursts at the single runway while retaining the seeded ordering and the two banks.
 * Published fixed-wing times are touchdown and off-block, so allow taxi-in before turnaround. */
function paceLondonDay(schedule: ScheduledFlight[]) {
  const { startS: closeS, endS: openS } = londonCitySchedule.curfew;
  const rows = schedule.flatMap((flight) =>
    flight.standKind === 'helipad'
      ? []
      : (['arrivalS', 'departureS'] as const).flatMap((kind) =>
          flight[kind] >= openS && flight[kind] < closeS
            ? [{ flight, kind, timeS: flight[kind] }]
            : [],
        ),
  );
  rows.sort((a, b) => a.timeS - b.timeS);
  for (const [i, { flight, kind, timeS }] of rows.entries()) {
    const slotS = openS + ((i + 0.5) * (closeS - openS)) / rows.length;
    flight[kind] = 0.85 * slotS + 0.15 * timeS;
  }
  for (const flight of schedule) {
    if (flight.overnight || flight.standKind === 'helipad') continue;
    const betweenS = aircraftTurnaroundMinutes[flight.typeId]! * 60 + 180;
    flight.departureS = Math.min(
      closeS - 1,
      Math.max(flight.departureS, flight.arrivalS + betweenS),
    );
    flight.arrivalS = Math.max(openS, Math.min(flight.arrivalS, flight.departureS - betweenS));
  }
  return schedule;
}

type FlightState =
  | AircraftState
  | 'scheduled'
  | 'before start'
  | 'holding for stand'
  | 'awaiting clearance'
  | 'awaiting approach'
  | 'arrived'
  | 'departed'
  | 'diverted'
  | 'cancelled';

interface Movement {
  id: string;
  timeS: number;
  typeId: string;
  registration?: string;
  stand: string | null;
  state: FlightState;
  delayS: number | null;
}

export interface FlightBoard {
  scheduled: number;
  completed: number;
  arrivals: Movement[];
  departures: Movement[];
  stands: { occupiedBy?: string; reservedFor?: string }[];
  /** The wind, the runway configuration in use and the last change, where there are runways. */
  runways: {
    wind: AirportWind;
    state: RunwaySnapshot | null;
    lastChange: RunwayTransition | null;
  } | null;
}

export interface FlightOperationsOptions {
  /** Configurations and time-of-day concepts in place of the airport's own table. */
  runways?: Pick<RunwayConfigurationInput, 'configurations' | 'concepts'>;
  /** The wind at the start; the prevailing 240 degrees at 8 kt by default. */
  wind?: AirportWind;
}

interface Turn {
  flight: ScheduledFlight;
  id?: number;
  phase:
    'scheduled' | 'holding' | 'arriving' | 'parked' | 'towing' | 'departing' | 'done' | 'diverted';
  stand: number;
  pad: number;
  arrivalStand: string | null;
  arrivedS?: number;
  offBlockS?: number;
  returned?: boolean;
  departedS?: number;
  divertedS?: number;
  readyS: number;
  service: 'out' | 'away' | 'back' | 'done';
  returnS: number;
  holdSinceS?: number;
  wasHeld?: boolean;
  leftStand?: number;
  dispatchS: number;
}

interface EndPair {
  cost: number;
  arrival: string;
  departure: string;
}

function flightStandKinds(kind: ScheduledFlight['standKind']): StandKind[] {
  switch (kind) {
    case 'contact':
      return ['contact', 'remote'];
    case 'general_aviation':
      return ['general_aviation', 'remote', 'contact'];
    case 'helipad':
      return [];
    default:
      return [kind];
  }
}

export function createFlightOperations(
  fleet: AircraftFleet,
  seed: number,
  startS: number,
  schedule?: readonly ScheduledFlight[],
  options: FlightOperationsOptions = {},
) {
  const { graph } = fleet;
  const midnight = Math.floor(startS / dayS) * dayS;
  // Fixed-wing runways; a helicopter runway (no fixed-wing code, Zurich's H01/H19) serves the
  // helicopters' approaches and climb-outs.
  const fixedWing = graph.runways.filter(({ maxCode }) => maxCode >= 0);
  const ends = fixedWing.flatMap((runway) =>
    runway.ends.map((end) => ({ designator: end.designator, headingRad: end.heading })),
  );
  const helicopterEnds = graph.runways
    .filter(({ maxCode }) => maxCode < 0)
    .flatMap((runway) => runway.ends.map((end) => end.heading));
  const profile = airportSchedules[graph.icao ?? ''] ?? largeAirportSchedule;
  const typeMix: FlightScheduleInput['typeMix'] = [
    ...profile.typeMix.filter(({ typeId }) => !isHelicopter(typeId)),
    ...(graph.helipads.length
      ? largeAirportSchedule.typeMix.filter(({ typeId }) => isHelicopter(typeId))
      : []),
    ...(graph.stands.some(({ kind }) => kind === 'cargo')
      ? (['B738', 'B77W', 'B748'] as const).map((typeId) => ({
          typeId,
          standKind: 'cargo' as const,
          weight: 3,
        }))
      : []),
  ];

  // TASK-300: the runway configuration follows the airport's concepts and the wind. It changes
  // at a concept's time boundary, or when the wind takes an end it uses past the tailwind (5 kt)
  // or the crosswind limit of the types the airport sees; the fleet runs the change.
  // TASK-305: an airport's own table (edited in the flight board) before the one for its code.
  const own = graph.runwayOperations;
  const table = airportRunwayConcepts[graph.icao ?? ''];
  const chooser = ends.length
    ? createRunwayChooser({
        ends,
        ...(options.runways ??
          (own
            ? {
                configurations: own.configurations ?? table?.configurations,
                concepts: own.concepts ?? table?.concepts,
                tailwindLimitKt: own.tailwindLimitKt,
              }
            : table)),
        crosswindLimitsKt: Object.fromEntries(
          typeMix.flatMap(({ typeId }) =>
            isHelicopter(typeId) ? [] : [[typeId, demonstratedCrosswindKt[typeId]!]],
          ),
        ),
      })
    : null;
  let wind = options.wind ?? prevailingWind;
  let windChanged = false;
  const timeOfDay = (timeS: number) => (((timeS - midnight) % dayS) + dayS) % dayS;
  let concept = chooser?.conceptAt(timeOfDay(startS));
  let configuration = chooser?.choose(timeOfDay(startS), wind) ?? null;
  // Stands are chosen for the configuration in use, or the last one during a closure.
  let lastOpen: RunwayConfiguration | null = configuration ?? chooser?.configurations[0] ?? null;
  if (chooser) fleet.setRunwayConfiguration(configuration);

  function updateRunways(timeS: number) {
    if (!chooser) return;
    const now = chooser.conceptAt(timeOfDay(timeS));
    const windOut = windChanged && (!configuration || !chooser.admits(configuration, wind));
    windChanged = false;
    if (now === concept && !windOut) return;
    concept = now;
    const next = chooser.choose(timeOfDay(timeS), wind);
    if ((next?.id ?? null) === (configuration?.id ?? null)) return;
    configuration = next;
    lastOpen = next ?? lastOpen;
    fleet.setRunwayConfiguration(next, timeS);
  }

  /** The compatible runway ends for this stand and type, ordered by taxi distance. */
  const endPairs = new Map<string, EndPair[]>();
  function pairsFor(stand: number, typeId: string, use: RunwayConfiguration) {
    const key = `${use.id}/${typeId}/${stand}`;
    const cached = endPairs.get(key);
    if (cached) return cached;
    const pairs: EndPair[] = [];
    for (const arrival of use.arrivalEnds)
      for (const departure of use.departureEnds) {
        const cost = fleet.standTurnCost(stand, typeId, arrival, departure);
        if (Number.isFinite(cost)) pairs.push({ cost, arrival, departure });
      }
    pairs.sort((a, b) => a.cost - b.cost);
    endPairs.set(key, pairs);
    return pairs;
  }

  function endsFor(stand: number, typeId: string, use = lastOpen) {
    return use ? pairsFor(stand, typeId, use)[0] : undefined;
  }

  function departureQueue() {
    const queue = new Map<string, number>();
    for (const { id, runwayEnd, airborne } of fleet.snapshot()) {
      if (runwayEnd && !airborne && byId.get(id)?.phase === 'departing')
        queue.set(runwayEnd, (queue.get(runwayEnd) ?? 0) + 1);
    }
    return queue;
  }

  function departureFor(
    stand: number,
    typeId: string,
    use: RunwayConfiguration,
    queue?: Map<string, number>,
  ) {
    const pairs = pairsFor(stand, typeId, use);
    const first = pairs[0];
    if (!first || !queue) return first?.departure;
    // Hold the inbound end fixed so its taxi distance cancels from the comparison.
    let best = first;
    let bestCost = first.cost + runwayQueueCostM * (queue.get(first.departure) ?? 0);
    for (const pair of pairs) {
      if (pair.arrival !== first.arrival) continue;
      const cost = pair.cost + runwayQueueCostM * (queue.get(pair.departure) ?? 0);
      if (cost < bestCost) {
        best = pair;
        bestCost = cost;
      }
    }
    return best.departure;
  }
  const headingOf = (designator: string | undefined) =>
    ends.find((end) => end.designator === designator)?.headingRad ?? 0;
  /** Helicopters fly in and out along the helicopter runway's end with the most headwind, or
   * along the fixed-wing flow. */
  const helicopterHeading = (designator: string | undefined) =>
    helicopterEnds.length
      ? helicopterEnds.reduce((best, heading) =>
          windComponents(heading, wind).headwindKt > windComponents(best, wind).headwindKt
            ? heading
            : best,
        )
      : headingOf(designator);

  const eligible = new Map<string, number[]>();
  function standsFor(typeId: string) {
    const key = `${lastOpen?.id}/${typeId}`;
    let stands = eligible.get(key);
    if (!stands) {
      stands = graph.stands
        .map(({ idx, maxCode }) => ({ idx, maxCode, cost: endsFor(idx, typeId)?.cost }))
        .filter((stand): stand is typeof stand & { cost: number } => stand.cost !== undefined)
        .sort((a, b) => a.maxCode - b.maxCode || a.cost - b.cost || a.idx - b.idx)
        .map(({ idx }) => idx);
      eligible.set(key, stands);
    }
    return stands;
  }

  const hangarStands = new Set(
    graph.hangars.flatMap(({ pos }) => {
      const stand = graph.stands.reduce<(typeof graph.stands)[number] | undefined>((best, s) => {
        const distance = (p: typeof pos) => (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2;
        return !best || distance(s.pos) < distance(best.pos) ? s : best;
      }, undefined);
      return stand ? [stand.idx] : [];
    }),
  );

  if (!schedule) {
    // Each mix entry needs a usable stand of its own kind. The generator still uses the actual
    // stand inventory to size the day and draw the turn types, times and service flags.
    const mix = typeMix.filter(({ typeId, standKind }) => {
      if (isHelicopter(typeId)) return true;
      return standsFor(typeId).some((stand) => {
        const kind = graph.stands[stand]!.kind;
        return standKind ? kind === standKind : kind !== 'maintenance' && kind !== 'cargo';
      });
    });
    const usable = new Set([...eligible.values()].flat());
    const stands = graph.stands.flatMap(({ idx, kind, maxCode }) => {
      const code = aircraftCodes[maxCode];
      if (!code || !usable.has(idx)) return [];
      const item = { kind, code, count: 1 };
      return hangarStands.has(idx) && kind !== 'maintenance'
        ? [item, { ...item, kind: 'maintenance' as const }]
        : [item];
    });
    const generated = generateFlightSchedule(
      {
        ...profile,
        typeMix: mix,
        stands,
        runwayCount: fixedWing.length,
        helipadCount: graph.helipads.length,
        helicopterMovements: Math.min(profile.helicopterMovements ?? 12, graph.helipads.length * 6),
      },
      seed,
    );
    schedule = graph.icao === 'EGLC' ? paceLondonDay(generated) : generated;
  }

  const turns: Turn[] = schedule
    .map((flight): Turn => ({
      flight: {
        ...flight,
        arrivalS: midnight + flight.arrivalS,
        departureS: midnight + flight.departureS,
      },
      phase: 'scheduled',
      stand: -1,
      pad: -1,
      arrivalStand: null,
      readyS: Infinity,
      service:
        flight.overnight ||
        flight.maintenance ||
        flight.irregularTow ||
        flight.departureS - flight.arrivalS >= longTurnS
          ? 'out'
          : 'done',
      returnS: Infinity,
      dispatchS: midnight + flight.arrivalS - fleet.arrivalLeadS(flight.typeId),
    }))
    .sort((a, b) => a.dispatchS - b.dispatchS);
  const inDay = (timeS: number) => timeS >= midnight && timeS < midnight + dayS;
  const arrivals = turns
    .filter(({ flight }) => inDay(flight.arrivalS))
    .sort((a, b) => a.flight.arrivalS - b.flight.arrivalS);
  const departures = turns
    .filter(({ flight }) => inDay(flight.departureS))
    .sort((a, b) => a.flight.departureS - b.flight.departureS);
  const scheduled =
    arrivals.filter(({ flight }) => flight.arrivalS >= startS).length +
    departures.filter(({ flight }) => flight.departureS >= startS).length;
  const active = new Set<Turn>();
  const byId = new Map<number, Turn>();
  const pads = new Set<number>();
  let next = 0;
  let nextUpdateS = startS;
  let holding = 0;
  let held = 0;
  let diverted = 0;
  let completed = 0;
  let totalDelayS = 0;
  let worstDelayS = 0;
  let tows = 0;
  let peakOccupied = 0;

  function standLabel(stand: number, pad: number) {
    const position = stand >= 0 ? graph.stands[stand] : graph.helipads[pad];
    return position ? (position.ref ?? position.id) : null;
  }

  function findStands(turn: Turn, kinds: StandKind[]) {
    const eligible = standsFor(turn.flight.typeId);
    return kinds.flatMap((kind) => eligible.filter((idx) => graph.stands[idx]!.kind === kind));
  }

  function maintenanceStands(turn: Turn) {
    return [
      ...findStands(turn, ['maintenance']),
      ...standsFor(turn.flight.typeId).filter((idx) => hangarStands.has(idx)),
    ];
  }

  function standAvailable(turn: Turn, idx: number) {
    if (!fleet.standFree(idx)) return false;
    return graph.stands.every((stand) => {
      if (stand.idx === turn.stand || fleet.standFree(stand.idx)) return true;
      const id = Math.max(fleet.standOccupant(stand.idx), fleet.standReservation(stand.idx));
      return fleet.standPairSafe(turn.flight.typeId, idx, id, stand.idx);
    });
  }

  function arrivalStands(turn: Turn) {
    return findStands(turn, flightStandKinds(turn.flight.standKind));
  }

  function requestArrival(turn: Turn, carryIn: boolean) {
    const { flight } = turn;
    if (flight.standKind === 'helipad') {
      const pad = graph.helipads.findIndex((_, idx) => !pads.has(idx) && fleet.helipadFree(idx));
      if (pad < 0) return false;
      const helipad = graph.helipads[pad]!.id;
      const result = carryIn
        ? fleet.spawnHelicopterParked(flight.typeId, helipad, flight.arrivalS)
        : fleet.requestHelicopterArrival({
            typeId: flight.typeId,
            helipad,
            headingRad: helicopterHeading(lastOpen?.arrivalEnds[0]),
          });
      if (!result.ok) return false;
      pads.add(pad);
      turn.pad = pad;
      turn.id = result.id;
    } else {
      const regular = arrivalStands(turn);
      const overnight =
        carryIn &&
        flight.overnight &&
        flight.standKind !== 'remote' &&
        flight.departureS - startS > returnLeadS;
      const candidates = overnight
        ? [...findStands(turn, ['remote']), ...maintenanceStands(turn), ...regular]
        : regular;
      for (const idx of candidates) {
        if (!standAvailable(turn, idx)) continue;
        const stand = graph.stands[idx]!.id;
        // No approaches while the runways are closed.
        const runwayEnd = configuration && endsFor(idx, flight.typeId, configuration)?.arrival;
        if (!carryIn && !runwayEnd) continue;
        const result = carryIn
          ? fleet.spawnParked({ typeId: flight.typeId, stand }, flight.arrivalS)
          : fleet.requestArrival({ typeId: flight.typeId, runwayEnd: runwayEnd!, stand });
        if (!result.ok) continue;
        turn.id = result.id;
        turn.stand = idx;
        if (
          overnight &&
          (graph.stands[idx]!.kind === 'remote' || maintenanceStands(turn).includes(idx))
        ) {
          turn.service = 'away';
          turn.leftStand = regular[0];
          turn.returnS = flight.departureS - returnLeadS;
        }
        break;
      }
      if (turn.id === undefined) return false;
    }
    byId.set(turn.id, turn);
    turn.arrivalStand = standLabel(turn.stand, turn.pad);
    turn.phase = carryIn ? 'parked' : 'arriving';
    if (carryIn) {
      turn.readyS = flight.departureS;
      if (!flight.overnight || turn.service !== 'away') turn.service = 'done';
    }
    return true;
  }

  function countMovement(actualS: number, plannedS: number) {
    if (plannedS < startS || !inDay(plannedS)) return;
    const delayS = Math.max(0, actualS - plannedS);
    completed++;
    totalDelayS += delayS;
    worstDelayS = Math.max(worstDelayS, delayS);
  }

  function tow(turn: Turn, targets: number[]) {
    for (const idx of targets) {
      if (idx === turn.stand || !standAvailable(turn, idx)) continue;
      if (!fleet.requestTow(turn.id!, { stand: graph.stands[idx]!.id }).ok) continue;
      turn.phase = 'towing';
      turn.stand = idx;
      return true;
    }
    return false;
  }

  function serviceStand(turn: Turn, timeS: number) {
    const { flight } = turn;
    if (turn.service === 'away' && timeS >= turn.returnS) {
      const first = turn.leftStand === undefined ? [] : [turn.leftStand];
      if (tow(turn, [...first, ...arrivalStands(turn)])) turn.service = 'back';
      else if (!flight.overnight) turn.service = 'done';
    } else if (turn.service === 'out' && turn.stand >= 0) {
      const remote = findStands(turn, ['remote']);
      turn.leftStand = turn.stand;
      if (
        flight.overnight &&
        flight.standKind !== 'remote' &&
        flight.departureS - timeS > returnLeadS * 2
      ) {
        if (tow(turn, [...remote, ...maintenanceStands(turn)])) {
          turn.service = 'away';
          turn.returnS = flight.departureS - returnLeadS;
        }
      } else if (flight.maintenance && flight.departureS - timeS > returnLeadS) {
        if (tow(turn, maintenanceStands(turn))) turn.service = 'away';
      } else if (
        (!flight.overnight && flight.departureS - timeS > returnLeadS * 2) ||
        flight.irregularTow
      ) {
        if (tow(turn, flight.irregularTow ? [...remote, ...arrivalStands(turn)] : remote))
          turn.service = 'done';
      }
    }
  }

  function step(timeS: number) {
    for (const event of fleet.drainEvents()) {
      const turn = byId.get(event.id);
      if (!turn) continue;
      const { flight } = turn;
      if (event.kind === 'landed') {
        turn.arrivedS = event.timeS;
        countMovement(event.timeS, flight.arrivalS);
      } else if (event.kind === 'off-block') {
        turn.offBlockS = event.timeS;
      } else if (event.kind === 'departed') {
        turn.departedS = event.timeS;
        turn.phase = 'done';
        active.delete(turn);
        byId.delete(event.id);
        countMovement(turn.offBlockS!, flight.departureS);
      } else if (event.kind === 'parked') {
        turn.phase = 'parked';
        turn.readyS = Math.max(
          flight.departureS,
          event.timeS + aircraftTurnaroundMinutes[flight.typeId]! * 60,
        );
      } else if (event.kind === 'returned') {
        turn.phase = 'parked';
        turn.stand = event.stand;
        turn.offBlockS = undefined;
        turn.returned = true;
        turn.service = 'done';
      } else if (event.kind === 'towed') {
        tows++;
        turn.phase = 'parked';
        if (turn.service === 'back') turn.service = 'done';
        if (turn.service === 'away' && !flight.overnight) turn.returnS = event.timeS + maintenanceS;
      }
    }
    if (timeS < nextUpdateS) return;
    nextUpdateS = Math.floor(timeS) + 1;
    updateRunways(timeS);
    while (next < turns.length && turns[next]!.dispatchS <= timeS) {
      const turn = turns[next++]!;
      if (turn.flight.arrivalS >= startS || turn.flight.departureS >= startS) active.add(turn);
    }

    // Request departures first. Ready-for-pushback starts after the turn is ready;
    // the fleet keeps the stand occupied until the preparation and departure clearance finish.
    const parked = [...active].filter(({ phase }) => phase === 'parked');
    parked.sort((a, b) => a.flight.departureS - b.flight.departureS);
    let queue: Map<string, number> | undefined;
    for (const turn of parked) {
      if (turn.service === 'away') {
        serviceStand(turn, timeS);
        continue;
      }
      if (timeS < turn.readyS) continue;
      let runwayEnd;
      if (turn.pad < 0) {
        if (!configuration) continue;
        if (configuration.departureEnds.length > 1) queue ??= departureQueue();
        runwayEnd = departureFor(turn.stand, turn.flight.typeId, configuration, queue);
        if (!runwayEnd) {
          // A fallback stand may serve the return taxi but have no route for the next departure.
          if (turn.returned) tow(turn, standsFor(turn.flight.typeId));
          continue;
        }
      }
      const result =
        turn.pad >= 0
          ? fleet.requestHelicopterDeparture(
              turn.id!,
              helicopterHeading(lastOpen?.departureEnds[0]),
            )
          : fleet.requestDeparture(turn.id!, runwayEnd!);
      if (result.ok) {
        turn.phase = 'departing';
        turn.returned = false;
        if (turn.pad >= 0) pads.delete(turn.pad);
        if (queue && runwayEnd) queue.set(runwayEnd, (queue.get(runwayEnd) ?? 0) + 1);
      }
    }
    for (const turn of active) {
      if (turn.phase !== 'scheduled' && turn.phase !== 'holding') continue;
      const carryIn = turn.flight.arrivalS < startS;
      if (requestArrival(turn, carryIn)) continue;
      if (!turn.wasHeld) {
        turn.wasHeld = true;
        held++;
      }
      turn.holdSinceS ??= timeS;
      if (timeS - turn.holdSinceS >= standHoldS) {
        turn.phase = 'diverted';
        turn.divertedS = timeS;
        active.delete(turn);
        diverted++;
      } else turn.phase = 'holding';
    }
    for (const turn of parked) {
      if (turn.phase === 'parked' && turn.service === 'out') serviceStand(turn, timeS);
    }
    holding = [...active].filter(({ phase }) => phase === 'holding').length;
    const occupied = graph.stands.reduce(
      (n, { idx }) => n + Number(fleet.standOccupant(idx) >= 0),
      0,
    );
    peakOccupied = Math.max(peakOccupied, occupied);
  }

  function movement(turn: Turn, timeS: number, arrival: boolean): Movement {
    const { flight, phase } = turn;
    const plannedS = arrival ? flight.arrivalS : flight.departureS;
    const actualS = arrival ? turn.arrivedS : turn.departedS;
    let state: FlightState = 'scheduled';
    if (arrival && phase === 'arriving') state = fleet.statusOf(turn.id!) ?? 'awaiting approach';
    else if (actualS !== undefined) state = arrival ? 'arrived' : 'departed';
    else if (plannedS < startS) state = 'before start';
    else if (phase === 'diverted') state = arrival ? 'diverted' : 'cancelled';
    else if (arrival && phase === 'holding') state = 'holding for stand';
    else if (arrival && plannedS <= timeS) state = 'awaiting clearance';
    else if (
      !arrival &&
      turn.id !== undefined &&
      (phase === 'parked' || phase === 'towing' || phase === 'departing')
    )
      state = fleet.statusOf(turn.id!) ?? 'scheduled';
    return {
      id: flight.id,
      timeS: plannedS,
      typeId: flight.typeId,
      registration: turn.id === undefined ? undefined : fleet.registrationOf(turn.id),
      stand: arrival ? turn.arrivalStand : standLabel(turn.stand, turn.pad),
      state,
      delayS:
        state === 'before start' || state === 'cancelled'
          ? null
          : Math.max(
              0,
              ((arrival ? actualS : turn.offBlockS) ?? turn.divertedS ?? timeS) - plannedS,
            ),
    };
  }

  // Populate the apron before the initial paused snapshot. New arrivals start on the first step.
  for (const turn of turns) {
    if (turn.flight.arrivalS >= startS || turn.flight.departureS < startS) continue;
    active.add(turn);
    requestArrival(turn, true);
  }

  return {
    step,
    /** Sets the wind; a change that takes the configuration past its limits reconfigures. */
    setWind(next: AirportWind) {
      if (!Number.isFinite(next.fromDeg) || !Number.isFinite(next.speedKt) || next.speedKt < 0)
        throw new Error('Wind needs a direction and a speed of zero or more');
      wind = { fromDeg: ((next.fromDeg % 360) + 360) % 360, speedKt: next.speedKt };
      windChanged = true;
    },
    wind: () => wind,
    metrics: () => ({
      scheduled,
      completed,
      holding,
      held,
      diverted,
      tows,
      peakOccupied,
      meanDelayS: completed ? totalDelayS / completed : 0,
      worstDelayS,
    }),
    board: (timeS: number): FlightBoard => ({
      scheduled,
      completed,
      arrivals: arrivals.map((turn) => movement(turn, timeS, true)),
      departures: departures.map((turn) => movement(turn, timeS, false)),
      stands: graph.stands.map(({ idx }) => ({
        occupiedBy: fleet.registrationOf(fleet.standOccupant(idx)),
        reservedFor: fleet.registrationOf(fleet.standReservation(idx)),
      })),
      runways: chooser
        ? {
            wind,
            state: fleet.runwaySnapshot(),
            lastChange: fleet.runwayTransitions().at(-1) ?? null,
          }
        : null,
    }),
  };
}

export type FlightOperationsMetrics = ReturnType<
  ReturnType<typeof createFlightOperations>['metrics']
>;
