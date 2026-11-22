import { createRandom, type Random } from '../geo/random';
import {
  aircraftCode,
  aircraftTurnaroundMinutes,
  aircraftTypes,
  codeAdmits,
  type AircraftCode,
} from '../schema/aircraft';
import { weightedChoice } from './selection';

const hourS = 3600;
const dayS = 24 * hourS;
const turnsPerStand = 4;
const movementsPerRunwayHour = 40;

type StandKind = 'contact' | 'remote' | 'cargo' | 'general_aviation' | 'maintenance';

interface TimeWindow {
  startS: number;
  endS: number;
}

interface WeightedWindow extends TimeWindow {
  weight: number;
}

interface ScheduleProfile {
  /** Fixed-wing arrivals plus departures. Omit for the turns-per-stand rule. */
  dailyMovements?: number;
  turnsPerStand?: number;
  /** 24 nonnegative weights; zero closes an hour to movements. */
  hourlyProfile: readonly number[];
  /** Half-open local-clock interval, optionally wrapping midnight. */
  curfew?: TimeWindow;
  typeMix: readonly { typeId: string; weight: number; standKind?: StandKind }[];
  overnightShare: number;
  maintenanceRate: number;
  irregularTowRate: number;
  helicopterMovements?: number;
}

export interface FlightScheduleInput extends ScheduleProfile {
  stands: readonly { kind: StandKind; code: AircraftCode; count: number }[];
  runwayCount: number;
  helipadCount?: number;
}

export interface ScheduledFlight {
  id: string;
  typeId: string;
  /** Seconds from midnight. A carry-in arrives before 0, a carry-out departs at or after 86400. */
  arrivalS: number;
  departureS: number;
  standKind: StandKind | 'helipad';
  standCode: AircraftCode | null;
  overnight: boolean;
  maintenance: boolean;
  irregularTow: boolean;
}

export const londonCitySchedule = {
  dailyMovements: 150,
  hourlyProfile: [0, 0, 0, 0, 0, 0, 4, 9, 10, 8, 4, 3, 3, 3, 3, 5, 9, 10, 8, 5, 4, 2, 0, 0],
  curfew: { startS: 22 * hourS, endS: 6 * hourS },
  typeMix: [
    { typeId: 'E190', weight: 45 },
    { typeId: 'E175', weight: 12 },
    { typeId: 'BCS3', weight: 12 },
    { typeId: 'AT76', weight: 8 },
    { typeId: 'DH8D', weight: 8 },
    { typeId: 'C25C', weight: 8 },
    { typeId: 'PC24', weight: 7 },
  ],
  overnightShare: 0.12,
  maintenanceRate: 0.02,
  irregularTowRate: 0.03,
} satisfies ScheduleProfile;

export const largeAirportSchedule = {
  hourlyProfile: [1, 1, 1, 1, 1, 3, 6, 9, 10, 8, 6, 5, 4, 5, 6, 7, 9, 10, 9, 7, 5, 4, 3, 2],
  typeMix: aircraftTypes.map(({ id, class: aircraftClass }) => ({
    typeId: id,
    weight: {
      double_decker: 2,
      widebody: 7,
      narrowbody: 15,
      regional_jet: 7,
      propeller: 3,
      private: 1,
      helicopter: 1,
    }[aircraftClass],
  })),
  overnightShare: 0.15,
  maintenanceRate: 0.02,
  irregularTowRate: 0.04,
  helicopterMovements: 12,
} satisfies ScheduleProfile;

function openHours({ hourlyProfile, curfew }: FlightScheduleInput) {
  let open: TimeWindow[] = [{ startS: 0, endS: dayS }];
  if (curfew && curfew.startS !== curfew.endS) {
    const { startS, endS } = curfew;
    open =
      startS < endS
        ? [
            { startS: 0, endS: startS },
            { startS: endS, endS: dayS },
          ]
        : [{ startS: endS, endS: startS }];
  }
  return hourlyProfile.flatMap((weight, hour) =>
    open.flatMap(({ startS, endS }) => {
      const start = Math.max(startS, hour * hourS);
      const end = Math.min(endS, (hour + 1) * hourS);
      return weight > 0 && start < end ? [{ startS: start, endS: end, weight }] : [];
    }),
  );
}

function regularArrivals(hours: WeightedWindow[], turnaroundS: number) {
  return hours.flatMap((arrival) =>
    hours.flatMap((departure) => {
      const startS = Math.max(arrival.startS, departure.startS - turnaroundS);
      const endS = Math.min(arrival.endS, departure.endS - turnaroundS);
      const weight = Math.sqrt(arrival.weight * departure.weight);
      return startS < endS ? [{ startS, endS, weight }] : [];
    }),
  );
}

function drawTime(hours: WeightedWindow[], random: Random) {
  const hour = weightedChoice(hours, (item) => (item.endS - item.startS) * item.weight, random);
  if (!hour) throw new Error('No operating hours for the requested flight movements');
  return random.uniform(hour.startS, hour.endS);
}

function overnightTimes(hours: WeightedWindow[], turnaroundS: number, random: Random) {
  const lastS = hours.at(-1)!.endS;
  const firstS = hours[0]!.startS;
  const departures = hours
    .map((hour) => ({ ...hour, endS: Math.min(hour.endS, firstS + 4 * hourS) }))
    .filter(({ startS, endS }) => startS < endS);
  const latestArrivalS = dayS + departures.at(-1)!.endS - turnaroundS;
  const arrivals = hours
    .map((hour) => ({
      ...hour,
      startS: Math.max(hour.startS, Math.min(lastS, latestArrivalS) - 4 * hourS),
      endS: Math.min(hour.endS, latestArrivalS),
    }))
    .filter(({ startS, endS }) => startS < endS);
  const arrivalS = drawTime(arrivals, random);
  const departureS = drawTime(
    departures
      .map((hour) => ({ ...hour, startS: Math.max(hour.startS, arrivalS + turnaroundS - dayS) }))
      .filter(({ startS, endS }) => startS < endS),
    random,
  );
  return { arrivalS, departureS: departureS + dayS };
}

type Flight = Omit<ScheduledFlight, 'id'>;
type Turn = Pick<Flight, 'typeId' | 'standKind' | 'standCode'> & {
  usableStandKinds: readonly StandKind[];
  weight: number;
  turnaroundS: number;
  canMaintain: boolean;
  canTow: boolean;
};

function eligibleTurns(input: FlightScheduleInput) {
  return input.typeMix.flatMap(({ typeId, weight, standKind }): Turn[] => {
    const type = aircraftTypes.find(({ id }) => id === typeId);
    const minutes = aircraftTurnaroundMinutes[typeId];
    if (!type || minutes === undefined) throw new Error(`Missing catalogue data for ${typeId}`);
    if (weight <= 0) return [];
    const turnaroundS = minutes * 60;
    const standCode = aircraftCode(type);
    if (standCode === null) {
      return [
        {
          typeId,
          weight,
          turnaroundS,
          standKind: 'helipad',
          standCode,
          usableStandKinds: [],
          canMaintain: false,
          canTow: false,
        },
      ];
    }
    const compatible = input.stands.filter(
      ({ count, code }) => count > 0 && codeAdmits(code, standCode),
    );
    const preferred: readonly StandKind[] = standKind
      ? [standKind]
      : type.class === 'private'
        ? ['general_aviation', 'remote', 'contact']
        : ['contact', 'remote'];
    const kind = preferred.find((candidate) => compatible.some(({ kind }) => kind === candidate));
    if (!kind) return [];
    return [
      {
        typeId,
        weight,
        turnaroundS,
        standKind: kind,
        standCode,
        usableStandKinds: preferred,
        canMaintain:
          kind !== 'maintenance' && compatible.some(({ kind }) => kind === 'maintenance'),
        canTow:
          compatible.reduce(
            (sum, stand) => sum + (stand.kind === 'maintenance' ? 0 : stand.count),
            0,
          ) > (kind === 'maintenance' ? 0 : 1),
      },
    ];
  });
}

function scheduleTurns(
  count: number,
  overnightShare: number,
  turns: Turn[],
  hours: WeightedWindow[],
  input: FlightScheduleInput,
  random: Random,
): Flight[] {
  if (!count) return [];
  if (!hours.length || !turns.length)
    throw new Error('No operating hours or compatible aircraft for the requested flight movements');
  const pairs = Math.floor(count / 2);
  const overnightPairs = Math.round(pairs * overnightShare);
  const regular = turns
    .map((turn) => ({ ...turn, arrivals: regularArrivals(hours, turn.turnaroundS) }))
    .filter(({ arrivals }) => arrivals.length > 0);
  const flights: Flight[] = [];
  const flags = ({ canMaintain, canTow }: Turn) => ({
    maintenance: canMaintain && random.next() < input.maintenanceRate,
    irregularTow: canTow && random.next() < input.irregularTowRate,
  });

  for (let i = 0; i < pairs - overnightPairs; i++) {
    const turn = weightedChoice(regular, ({ weight }) => weight, random);
    if (!turn) throw new Error('The operating hours cannot fit a scheduled turnaround');
    const { typeId, standKind, standCode, turnaroundS, arrivals } = turn;
    const arrivalS = drawTime(arrivals, random);
    flights.push({
      typeId,
      standKind,
      standCode,
      arrivalS,
      departureS: arrivalS + turnaroundS,
      overnight: false,
      ...flags(turn),
    });
  }
  for (let i = 0; i < overnightPairs + (count % 2); i++) {
    const turn = weightedChoice(turns, ({ weight }) => weight, random)!;
    const { typeId, standKind, standCode, turnaroundS } = turn;
    const { arrivalS, departureS } = overnightTimes(hours, turnaroundS, random);
    const flight = {
      typeId,
      standKind,
      standCode,
      arrivalS,
      departureS,
      overnight: true,
      ...flags(turn),
    };
    flights.push({ ...flight, arrivalS: arrivalS - dayS, departureS: departureS - dayS });
    if (i < overnightPairs) flights.push(flight);
  }
  return flights;
}

/** A single seeded day's flights, including the turns that cross either day boundary. */
export function generateFlightSchedule(
  input: FlightScheduleInput,
  seed: number,
): ScheduledFlight[] {
  const hours = openHours(input);
  const turns = eligibleTurns(input);
  const stands = input.stands
    .filter(({ code, kind }) =>
      turns.some(
        ({ standCode, usableStandKinds }) =>
          standCode !== null && codeAdmits(code, standCode) && usableStandKinds.includes(kind),
      ),
    )
    .reduce((sum, stand) => sum + stand.count, 0);
  const runwayCapacity =
    (input.runwayCount *
      movementsPerRunwayHour *
      hours.reduce((sum, { startS, endS }) => sum + endS - startS, 0)) /
    hourS;
  const runwayMovements =
    input.runwayCount && stands
      ? (input.dailyMovements ??
        2 *
          Math.floor(Math.min(stands * (input.turnsPerStand ?? turnsPerStand), runwayCapacity / 2)))
      : 0;
  const random = createRandom(seed);
  const flights = [
    ...scheduleTurns(
      runwayMovements,
      input.overnightShare,
      turns.filter(({ standCode }) => standCode !== null),
      hours,
      input,
      random,
    ),
    ...scheduleTurns(
      input.helipadCount ? (input.helicopterMovements ?? 0) : 0,
      0,
      turns.filter(({ standCode }) => standCode === null),
      hours,
      input,
      random.derive('helicopter'),
    ),
  ];
  return flights
    .sort((a, b) => a.arrivalS - b.arrivalS || a.departureS - b.departureS)
    .map((flight, index) => ({ id: `flight:${index + 1}`, ...flight }));
}
