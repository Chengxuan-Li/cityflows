import {
  generateFlightSchedule,
  largeAirportSchedule,
  londonCitySchedule,
  type FlightScheduleInput,
  type ScheduledFlight,
} from '../demand/flight-schedule';
import { aircraftCodes, aircraftTurnaroundMinutes, aircraftTypes } from '../schema/aircraft';
import type { StandKind } from '../schema/airport';
import type { AircraftFleet, AircraftState } from './aircraft';
import { chooseRunwayConfiguration } from './runway-configuration';

const dayS = 86_400;
const standHoldS = 1800;
const returnLeadS = 1200;
const maintenanceS = 300;
const longTurnS = 75 * 60;
const prevailingWind = { fromDeg: 240, speedKt: 8 };
const isHelicopter = (typeId: string) =>
  aircraftTypes.find(({ id }) => id === typeId)!.class === 'helicopter';

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
  departedS?: number;
  divertedS?: number;
  readyS: number;
  service: 'out' | 'away' | 'back' | 'done';
  returnS: number;
  holdSinceS?: number;
  wasHeld?: boolean;
  leftStand?: number;
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
) {
  const { graph } = fleet;
  const midnight = Math.floor(startS / dayS) * dayS;
  const ends = graph.runways.flatMap((runway) =>
    runway.ends.map((end) => ({ designator: end.designator, headingRad: end.heading })),
  );
  const configuration = ends.length
    ? chooseRunwayConfiguration({ ends }, startS - midnight, prevailingWind)
    : null;
  const arrivalEnd = configuration?.arrivalEnds[0] ?? ends[0]?.designator;
  const departureEnd = configuration?.departureEnds[0] ?? ends[0]?.designator;
  const heading = ends.find(({ designator }) => designator === arrivalEnd)?.headingRad ?? 0;
  const profile = graph.icao === 'EGLC' ? londonCitySchedule : largeAirportSchedule;
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

  const eligible = new Map<string, number[]>();
  function standsFor(typeId: string) {
    let stands = eligible.get(typeId);
    if (!stands) {
      stands =
        arrivalEnd && departureEnd
          ? graph.stands
              .map(({ idx, maxCode }) => ({
                idx,
                maxCode,
                cost: fleet.standTurnCost(idx, typeId, arrivalEnd, departureEnd),
              }))
              .filter(({ cost }) => Number.isFinite(cost))
              .sort((a, b) => a.maxCode - b.maxCode || a.cost - b.cost || a.idx - b.idx)
              .map(({ idx }) => idx)
          : [];
      eligible.set(typeId, stands);
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
    schedule = generateFlightSchedule(
      {
        ...profile,
        typeMix: mix,
        stands,
        runwayCount: graph.runways.length,
        helipadCount: graph.helipads.length,
        helicopterMovements: Math.min(12, graph.helipads.length * 6),
      },
      seed,
    );
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
    }))
    .sort((a, b) => a.flight.arrivalS - b.flight.arrivalS);
  const inDay = (timeS: number) => timeS >= midnight && timeS < midnight + dayS;
  const arrivals = turns.filter(({ flight }) => inDay(flight.arrivalS));
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
  // A fixed-wing clearance covers a whole ground route. Taxi routes may share a stretch of
  // runway or use the same apron lane in opposite directions. A climb clear of the runway
  // and a helicopter's separate pad operation may continue while the next clearance is used.
  let clearance: Turn | undefined;

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
    const { pos } = graph.stands[idx]!;
    const span = aircraftTypes.find(({ id }) => id === turn.flight.typeId)!.spanM;
    // A pushback swings the wingtip outside the lead-in. Keep that room between occupied
    // positions on tight aprons, including positions already reserved for another aircraft.
    return graph.stands.every((stand) => {
      if (stand.idx === turn.stand || fleet.standFree(stand.idx)) return true;
      const id = Math.max(fleet.standOccupant(stand.idx), fleet.standReservation(stand.idx));
      const other = fleet.typeOf(id)!;
      return Math.hypot(pos.x - stand.pos.x, pos.y - stand.pos.y) >= (span + other.spanM) / 2 + 10;
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
        : fleet.requestHelicopterArrival({ typeId: flight.typeId, helipad, headingRad: heading });
      if (!result.ok) return false;
      pads.add(pad);
      turn.pad = pad;
      turn.id = result.id;
    } else {
      const regular = arrivalStands(turn);
      const overnight = carryIn && flight.overnight && flight.departureS - startS > returnLeadS;
      const candidates = overnight
        ? [...findStands(turn, ['remote']), ...maintenanceStands(turn), ...regular]
        : regular;
      for (const idx of candidates) {
        if (!standAvailable(turn, idx)) continue;
        const stand = graph.stands[idx]!.id;
        const result = carryIn
          ? fleet.spawnParked({ typeId: flight.typeId, stand }, flight.arrivalS)
          : fleet.requestArrival({ typeId: flight.typeId, runwayEnd: arrivalEnd!, stand });
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
      clearance = turn;
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
      if (flight.overnight && flight.departureS - timeS > returnLeadS * 2) {
        if (tow(turn, [...remote, ...maintenanceStands(turn)])) {
          turn.service = 'away';
          turn.returnS = flight.departureS - returnLeadS;
        }
      } else if (flight.maintenance && flight.departureS - timeS > returnLeadS) {
        if (tow(turn, maintenanceStands(turn))) turn.service = 'away';
      } else if (flight.departureS - timeS > returnLeadS * 2 || flight.irregularTow) {
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
      } else if (event.kind === 'departed') {
        turn.departedS = event.timeS;
        turn.phase = 'done';
        active.delete(turn);
        byId.delete(event.id);
        countMovement(event.timeS, flight.departureS);
      } else if (event.kind === 'parked') {
        turn.phase = 'parked';
        turn.readyS = Math.max(
          flight.departureS,
          event.timeS + aircraftTurnaroundMinutes[flight.typeId]! * 60,
        );
      } else if (event.kind === 'towed') {
        tows++;
        turn.phase = 'parked';
        if (turn.service === 'back') turn.service = 'done';
        if (turn.service === 'away' && !flight.overnight) turn.returnS = event.timeS + maintenanceS;
      }
    }
    if (timeS < nextUpdateS) return;
    nextUpdateS = Math.floor(timeS) + 1;
    while (next < turns.length && turns[next]!.flight.arrivalS <= timeS) {
      const turn = turns[next++]!;
      if (turn.flight.arrivalS >= startS || turn.flight.departureS >= startS) active.add(turn);
    }

    if (
      clearance &&
      (clearance.phase === 'parked' ||
        clearance.phase === 'done' ||
        (clearance.phase === 'departing' && fleet.departureClear(clearance.id!)))
    )
      clearance = undefined;

    // Clear ready departures first to free stands. Service moves use spare ground capacity,
    // except that a due return tow is part of preparing its departure.
    const parked = [...active].filter(({ phase }) => phase === 'parked');
    parked.sort((a, b) => a.flight.departureS - b.flight.departureS);
    for (const turn of parked) {
      if (turn.pad < 0 && clearance) continue;
      if (turn.service === 'away') {
        serviceStand(turn, timeS);
        continue;
      }
      if (timeS < turn.readyS) continue;
      const result =
        turn.pad >= 0
          ? fleet.requestHelicopterDeparture(turn.id!, heading)
          : fleet.requestDeparture(turn.id!, departureEnd!);
      if (result.ok) {
        turn.phase = 'departing';
        if (turn.pad >= 0) pads.delete(turn.pad);
        else clearance = turn;
      }
    }
    for (const turn of active) {
      if (turn.phase !== 'scheduled' && turn.phase !== 'holding') continue;
      const carryIn = turn.flight.arrivalS < startS;
      const helicopter = turn.flight.standKind === 'helipad';
      const precedingTakeoff =
        clearance?.phase === 'departing' && fleet.takeoffUnderway(clearance.id!);
      // Allow a new aircraft to appear 10 km out once the preceding take-off roll has started.
      const canArrive = carryIn || helicopter || !clearance || precedingTakeoff;
      if (canArrive && requestArrival(turn, carryIn)) {
        if (!carryIn && !helicopter) clearance = turn;
        continue;
      }
      if (!canArrive && arrivalStands(turn).some((idx) => standAvailable(turn, idx))) {
        turn.phase = 'scheduled';
        turn.holdSinceS = undefined;
        continue;
      }
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
      if (clearance) break;
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
          : Math.max(0, (actualS ?? turn.divertedS ?? timeS) - plannedS),
    };
  }

  // Populate the apron before the initial paused snapshot. New arrivals start on the first step.
  while (next < turns.length && turns[next]!.flight.arrivalS < startS) {
    const turn = turns[next++]!;
    if (turn.flight.departureS < startS) continue;
    active.add(turn);
    requestArrival(turn, true);
  }

  return {
    step,
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
    }),
  };
}

export type FlightOperationsMetrics = ReturnType<
  ReturnType<typeof createFlightOperations>['metrics']
>;
