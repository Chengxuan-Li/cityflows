import { distance, nearestOnPolyline } from '../geo/polyline';
import { createRandom } from '../geo/random';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { serviceDwellS, trainPoseAt, type TrainKind } from '../network/trains';
import { PLATFORM_DETOUR, type TransitNetwork } from '../routing/transit';
import type { SimParams } from '../schema';

/** TASK-174: places per vehicle at full population (`personsPerResident` 1), scaled like demand. A
 * 36 m four-section tram about 210 (Munich's Avenio), a 135 m two-unit S-Bahn 2 x 544 (ET 423). */
export const TRANSIT_CAPACITY: Record<Exclude<TrainKind, 'mainline'>, number> = {
  tram: 210,
  sbahn: 1088,
};
/** A rider who has waited this long gives up and walks on from the stop. */
export const MAX_WAIT_S = 30 * 60;
/** Public ids of riders on platforms in the walker snapshot start above the walkers'. */
export const TRANSIT_RIDER_ID = 2 ** 30;

/** A run of a route the simulation is running: its departure index, cycle and age. */
export interface TransitService {
  departure: number;
  cycle: number;
  ageS: number;
}

export interface TransitRiderInput {
  personId: string;
  tripId: string;
  /** Where the rider steps off the walk network onto the platform. */
  from: Vec2;
  stop: number;
  /** Routes that reach `toStop` from `stop`; the rider boards the first with room. */
  routes: readonly number[];
  toStop: number;
  /** Where the rider walks to off the platform at `toStop`. */
  exit: Vec2;
  timeS: number;
  onBoard: (timeS: number, vehicle: string) => void;
  onAlight: (timeS: number) => void;
  onGiveUp: (timeS: number) => void;
}

type Phase = 'platform' | 'waiting' | 'boarding' | 'aboard' | 'alighting' | 'done';
interface Rider {
  personId: string;
  tripId: string;
  /** TASK-128's station riders: seated in the S-Bahn, outside the mode choice. */
  background: boolean;
  phase: Phase;
  stop: number;
  routes: readonly number[];
  toStop: number;
  exit: Vec2;
  spot: Vec2;
  from: Vec2;
  to: Vec2;
  startS: number;
  endS: number;
  waitSinceS: number;
  vehicle: string | null;
  input: TransitRiderInput | null;
}
interface Vehicle {
  key: string;
  id: string;
  line: number;
  departure: number;
  cycle: number;
  ageS: number;
  aboard: number[];
  /** Background riders who come in on this run, by the visit where they alight. */
  seated: boolean;
}

export interface TransitMetrics {
  /** Per line: boardings and alightings of persons in the mode choice and of TASK-128's riders,
   * and the most riders aboard at once. */
  lines: {
    route: number;
    name: string;
    kind: 'tram' | 'sbahn';
    capacity: number;
    boardings: number;
    alightings: number;
    riderBoardings: number;
    riderAlightings: number;
    peakLoad: number;
  }[];
  stops: { id: string; name: string; boardings: number; alightings: number }[];
  waits: { count: number; meanS: number; maxS: number };
  /** Riders left on the platform because a vehicle they could take was full. */
  deniedBoardings: number;
  /** Riders who waited `MAX_WAIT_S` and walked on. */
  gaveUp: number;
  waiting: number;
  aboard: number;
}

export interface TransitSnapshot {
  /** Riders on platforms, drawn like walkers: walking on or off the platform, or waiting. */
  count: number;
  id: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  state: Uint8Array;
  layer: Int8Array;
  /** Vehicles in service with riders' person ids, keyed by their train pose id. */
  vehicles: { id: string; capacity: number; riders: string[] }[];
}

/** The runs the timetable puts in service at `timeS` (where no crossing controller holds any). */
export function scheduledServices(network: TransitNetwork, timeS: number): TransitService[] {
  const { table } = network;
  const result: TransitService[] = [];
  for (const line of network.lines) {
    const route = table.routes[line.route]!;
    table.departures.forEach((departure, index) => {
      if (departure.route !== line.route) return;
      const newest = Math.floor((timeS - departure.timeS) / table.periodS);
      for (let k = newest; k >= newest - Math.ceil(route.durationS / table.periodS); k--) {
        const ageS = timeS - departure.timeS - k * table.periodS;
        if (ageS >= 0 && ageS < route.durationS) result.push({ departure: index, cycle: k, ageS });
      }
    });
  }
  return result;
}

const lerp = (a: Vec2, b: Vec2, f: number) => ({
  x: a.x + (b.x - a.x) * f,
  y: a.y + (b.y - a.y) * f,
});

/**
 * TASK-174: riders on platforms and in vehicles. The vehicles are the runs the simulation runs
 * (`services`, the crossing controller's clocks or the timetable). A rider walks from the walk
 * network to a spot on the platform and waits; a standing run of one of the rider's routes with room
 * takes them (a full one leaves them for the next); they walk to its nearest door and are aboard.
 * When the run arrives at their stop they get off at a door along it and walk off the platform.
 */
export function createTransit(
  city: CompiledCity,
  network: TransitNetwork,
  params: SimParams,
  scenarioSeed: number,
  personsPerResident: number,
  services: (timeS: number) => TransitService[],
) {
  const rail = city.rail!;
  const { table, stops, lines } = network;
  const lineOf = new Map(lines.map((line, l) => [line.route, l]));
  const capacityOf = (line: number) =>
    Math.max(1, Math.round(TRANSIT_CAPACITY[lines[line]!.kind] * personsPerResident));
  const speed = params.walkSpeedMps;
  const riders: Rider[] = [];
  /** Riders on platforms (walking on, waiting, boarding, walking off); those who came during a
   * step join at its end. */
  const active: number[] = [];
  const arrived: number[] = [];
  const denied = new Set<string>();
  const waiting: number[][] = stops.map(() => []);
  const vehicles = new Map<string, Vehicle>();
  /** TASK-128 riders by the stop and second their train arrives, for seating them on board. */
  const expected = new Map<string, { personId: string; walkS: number }[]>();
  const random = createRandom(scenarioSeed).derive('transit');
  const counts = {
    lines: lines.map(() => ({ boardings: 0, alightings: 0, rider: [0, 0], peak: 0 })),
    stops: stops.map(() => ({ boardings: 0, alightings: 0 })),
    waits: [] as number[],
    denied: 0,
    gaveUp: 0,
  };
  let choiceRiders = 0;

  /** A spot on the platform, drawn per person and stop: platforms are small convex shapes. */
  function spotOn(stop: number, personId: string) {
    const draw = random.derive(personId).derive(stop);
    const { shape, centre } = stops[stop]!;
    if (shape.length === 1) return shape[0]!;
    const corner = shape[Math.floor(draw.next() * shape.length)]!;
    return lerp(centre, corner, 0.7 * draw.next());
  }
  function body(vehicle: Vehicle) {
    const pose = trainPoseAt(rail, table, vehicle.departure, vehicle.cycle, vehicle.ageS);
    return pose ? pose.cars.flatMap((car) => [car.rear, car.front]) : [];
  }
  function add(rider: Rider) {
    riders.push(rider);
    if (rider.phase !== 'aboard') arrived.push(riders.length - 1);
    return riders.length - 1;
  }
  function walkOnto(index: number, timeS: number) {
    const rider = riders[index]!;
    rider.phase = 'platform';
    rider.to = rider.spot;
    rider.startS = timeS;
    rider.endS = timeS + (distance(rider.from, rider.spot) * PLATFORM_DETOUR) / speed;
  }
  function alight(vehicle: Vehicle, index: number, timeS: number) {
    const rider = riders[index]!;
    const line = vehicle.line;
    const door = body(vehicle);
    const draw = random.derive(rider.personId).derive('door');
    rider.phase = 'alighting';
    rider.from = door.length
      ? door[Math.floor(draw.next() * door.length)]!
      : stops[rider.toStop]!.centre;
    // Off the door onto the platform, then to where the rider leaves it.
    rider.spot = spotOn(rider.toStop, rider.personId);
    rider.to = rider.exit;
    rider.startS = timeS;
    if (!rider.background || rider.endS <= timeS)
      rider.endS =
        timeS +
        ((distance(rider.from, rider.spot) + distance(rider.spot, rider.exit)) * PLATFORM_DETOUR) /
          speed;
    rider.vehicle = null;
    arrived.push(index);
    counts.stops[rider.toStop]!.alightings++;
    if (rider.background) counts.lines[line]!.rider[1]!++;
    else counts.lines[line]!.alightings++;
  }

  return {
    get choiceRiders() {
      return choiceRiders;
    },
    capacity: (route: number) => capacityOf(lineOf.get(route)!),
    /** A rider of the mode choice arrives where the walk network meets the platform. */
    wait(input: TransitRiderInput) {
      choiceRiders++;
      const index = add({
        personId: input.personId,
        tripId: input.tripId,
        background: false,
        phase: 'platform',
        stop: input.stop,
        routes: input.routes,
        toStop: input.toStop,
        exit: input.exit,
        spot: spotOn(input.stop, input.personId),
        from: input.from,
        to: input.from,
        startS: input.timeS,
        endS: input.timeS,
        waitSinceS: input.timeS,
        vehicle: null,
        input,
      });
      walkOnto(index, input.timeS);
    },
    /** A TASK-128 rider arrives on the S-Bahn run that stops at `platform` at `arrivalS` and walks
     * off the platform to the entrance, leaving it at `walkS` (their walk's departure). */
    expect(personId: string, platform: string, arrivalS: number, walkS: number) {
      const key = `${platform}@${Math.round(arrivalS)}`;
      const list = expected.get(key);
      if (list) list.push({ personId, walkS });
      else expected.set(key, [{ personId, walkS }]);
    },
    /** A TASK-128 rider back at the station walks onto a platform and leaves on the next S-Bahn
     * with room there. */
    leave(personId: string, stop: number, from: Vec2, timeS: number) {
      const routes = lines.filter((l) => l.visits.some((v) => v.stop === stop)).map((l) => l.route);
      const index = add({
        personId,
        tripId: `${personId}:back`,
        background: true,
        phase: 'platform',
        stop,
        routes,
        toStop: -1,
        exit: from,
        spot: spotOn(stop, personId),
        from,
        to: from,
        startS: timeS,
        endS: timeS,
        waitSinceS: timeS,
        vehicle: null,
        input: null,
      });
      walkOnto(index, timeS);
    },
    step(timeS: number) {
      active.push(...arrived);
      arrived.length = 0;
      const seen = new Set<string>();
      for (const service of services(timeS)) {
        const departure = table.departures[service.departure]!;
        const l = lineOf.get(departure.route);
        if (l === undefined) continue;
        const line = lines[l]!;
        const key = `${service.departure}:${service.cycle}`;
        seen.add(key);
        let vehicle = vehicles.get(key);
        const lastAge = vehicle?.ageS ?? service.ageS;
        if (!vehicle) {
          vehicle = {
            key,
            id: `${table.routes[departure.route]!.id}/${departure.requestedS}/${service.cycle}`,
            line: l,
            departure: service.departure,
            cycle: service.cycle,
            ageS: service.ageS,
            aboard: [],
            seated: false,
          };
          vehicles.set(key, vehicle);
        }
        vehicle.ageS = service.ageS;
        const startS = departure.timeS + service.cycle * table.periodS;
        if (!vehicle.seated) {
          vehicle.seated = true;
          for (const visit of line.visits) {
            if (visit.arrivalS <= service.ageS) continue;
            const stop = stops[visit.stop]!;
            const arriving = expected.get(`${stop.id}@${Math.round(startS + visit.arrivalS)}`);
            for (const { personId, walkS } of arriving ?? []) {
              // They leave by the entrance nearest the platform's middle.
              const exit = stop.access.reduce((a, b) =>
                distance(a.point, stop.centre) <= distance(b.point, stop.centre) ? a : b,
              ).point;
              const index = add({
                personId,
                tripId: `${personId}:out`,
                background: true,
                phase: 'aboard',
                stop: visit.stop,
                routes: [line.route],
                toStop: visit.stop,
                exit,
                spot: exit,
                from: exit,
                to: exit,
                startS: timeS,
                endS: walkS,
                waitSinceS: timeS,
                vehicle: key,
                input: null,
              });
              vehicle.aboard.push(index);
            }
          }
        }
        const dwellS = serviceDwellS(line.kind);
        for (const visit of line.visits) {
          if (lastAge < visit.arrivalS && visit.arrivalS <= service.ageS) {
            const staying: number[] = [];
            for (const index of vehicle.aboard)
              if (riders[index]!.toStop === visit.stop) alight(vehicle, index, timeS);
              else staying.push(index);
            vehicle.aboard = staying;
          }
          if (service.ageS < visit.arrivalS || service.ageS >= visit.arrivalS + dwellS) continue;
          const queue = waiting[visit.stop]!;
          if (!queue.length) continue;
          const capacity = capacityOf(l);
          const remaining: number[] = [];
          let door: Vec2[] | null = null;
          for (const index of queue) {
            const rider = riders[index]!;
            if (rider.phase !== 'waiting' || !rider.routes.includes(line.route)) {
              remaining.push(index);
              continue;
            }
            if (vehicle.aboard.length >= capacity) {
              if (!denied.has(`${key}:${index}`)) {
                denied.add(`${key}:${index}`);
                counts.denied++;
              }
              remaining.push(index);
              continue;
            }
            door ??= body(vehicle);
            const target = door.length ? nearestOnPolyline(door, rider.spot).point : rider.spot;
            const departS = timeS + (visit.arrivalS + dwellS - service.ageS);
            rider.phase = 'boarding';
            rider.from = rider.spot;
            rider.to = target;
            rider.startS = timeS;
            rider.endS = Math.min(
              departS - params.dtS,
              timeS + (distance(rider.spot, target) * PLATFORM_DETOUR) / speed,
            );
            rider.vehicle = key;
            vehicle.aboard.push(index);
            counts.waits.push(timeS - rider.waitSinceS);
            counts.stops[rider.stop]!.boardings++;
            if (rider.background) counts.lines[l]!.rider[0]!++;
            else counts.lines[l]!.boardings++;
          }
          waiting[visit.stop] = remaining;
        }
        const peak = counts.lines[l]!;
        peak.peak = Math.max(peak.peak, vehicle.aboard.length);
      }
      // Runs that left the city: TASK-128's riders on board are done; anyone else gets off at the
      // last stop the run called at (a run never ends before its last stop, but a live edit may
      // rebuild the controller's clocks).
      for (const [key, vehicle] of vehicles) {
        if (seen.has(key)) continue;
        for (const index of vehicle.aboard) {
          const rider = riders[index]!;
          if (rider.background) rider.phase = 'done';
          else {
            rider.toStop = lines[vehicle.line]!.visits.at(-1)!.stop;
            alight(vehicle, index, timeS);
          }
        }
        vehicles.delete(key);
      }
      // Riders on platforms: arrive at their spot, finish boarding or walking off, or give up.
      let kept = 0;
      for (const index of active) {
        const rider = riders[index]!;
        if (rider.phase === 'waiting') {
          if (!rider.background && timeS - rider.waitSinceS >= MAX_WAIT_S) {
            rider.phase = 'done';
            waiting[rider.stop] = waiting[rider.stop]!.filter((i) => i !== index);
            counts.gaveUp++;
            rider.input!.onGiveUp(timeS);
          }
        } else if (timeS >= rider.endS) {
          if (rider.phase === 'platform') {
            rider.phase = 'waiting';
            rider.waitSinceS = timeS;
            waiting[rider.stop]!.push(index);
          } else if (rider.phase === 'boarding') {
            rider.phase = 'aboard';
            rider.input?.onBoard(timeS, vehicles.get(rider.vehicle!)?.id ?? rider.vehicle!);
          } else if (rider.phase === 'alighting') {
            rider.phase = 'done';
            rider.input?.onAlight(timeS);
          }
        }
        if (rider.phase !== 'done' && rider.phase !== 'aboard') active[kept++] = index;
      }
      active.length = kept;
      active.push(...arrived);
      arrived.length = 0;
    },
    snapshot(timeS: number): TransitSnapshot {
      const visible = [...active, ...arrived];
      const n = visible.length;
      const snapshot: TransitSnapshot = {
        count: n,
        id: new Uint32Array(n),
        x: new Float32Array(n),
        y: new Float32Array(n),
        heading: new Float32Array(n),
        state: new Uint8Array(n),
        layer: new Int8Array(n),
        vehicles: [...vehicles.values()].map((v) => ({
          id: v.id,
          capacity: capacityOf(v.line),
          riders: v.aboard.map((i) => riders[i]!.personId),
        })),
      };
      visible.forEach((index, i) => {
        const rider = riders[index]!;
        const moving = rider.phase !== 'waiting';
        const f =
          rider.endS > rider.startS
            ? Math.min(1, Math.max(0, (timeS - rider.startS) / (rider.endS - rider.startS)))
            : 1;
        // Getting off walks door, spot on the platform, exit; the others walk straight.
        const path =
          rider.phase === 'alighting' ? [rider.from, rider.spot, rider.to] : [rider.from, rider.to];
        const legs = path.slice(1).map((p, k) => distance(path[k]!, p));
        let along = f * legs.reduce((a, b) => a + b, 0),
          k = 0;
        while (k < legs.length - 1 && along > legs[k]!) along -= legs[k++]!;
        const a = path[k]!,
          b = path[k + 1]!;
        const at = moving ? lerp(a, b, legs[k]! ? Math.min(1, along / legs[k]!) : 1) : rider.spot;
        snapshot.id[i] = TRANSIT_RIDER_ID + index;
        snapshot.x[i] = at.x;
        snapshot.y[i] = at.y;
        snapshot.heading[i] = moving ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
        // The walkers' states: 1 walking, 2 waiting.
        snapshot.state[i] = moving ? 1 : 2;
        snapshot.layer[i] = stops[rider.phase === 'alighting' ? rider.toStop : rider.stop]!.layer;
      });
      return snapshot;
    },
    /** A rider on a platform by its public id: who, which trip and what they do. */
    inspect(id: number) {
      const rider = riders[id - TRANSIT_RIDER_ID];
      if (!rider) return null;
      return {
        personId: rider.personId,
        tripId: rider.tripId,
        phase: rider.phase,
        stop: stops[rider.phase === 'alighting' ? rider.toStop : rider.stop]!.id,
        sinceS: rider.phase === 'waiting' ? rider.waitSinceS : rider.startS,
      };
    },
    metrics(): TransitMetrics {
      const waits = counts.waits;
      return {
        lines: lines.map((line, l) => ({
          route: line.route,
          name: line.name,
          kind: line.kind,
          capacity: capacityOf(l),
          boardings: counts.lines[l]!.boardings,
          alightings: counts.lines[l]!.alightings,
          riderBoardings: counts.lines[l]!.rider[0]!,
          riderAlightings: counts.lines[l]!.rider[1]!,
          peakLoad: counts.lines[l]!.peak,
        })),
        stops: stops.map((stop, s) => ({ id: stop.id, name: stop.name, ...counts.stops[s]! })),
        waits: {
          count: waits.length,
          meanS: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0,
          maxS: waits.length ? Math.max(...waits) : 0,
        },
        deniedBoardings: counts.denied,
        gaveUp: counts.gaveUp,
        waiting: [...active, ...arrived].filter((i) => riders[i]!.phase !== 'alighting').length,
        aboard: [...vehicles.values()].reduce((n, v) => n + v.aboard.length, 0),
      };
    },
    /** Riders' phases and vehicles' loads, for the state hash once a choice rider has come. */
    hash(word: (hash: number, value: number) => number, hash: number) {
      if (!choiceRiders) return hash;
      for (const rider of riders)
        hash = word(
          hash,
          ['platform', 'waiting', 'boarding', 'aboard', 'alighting', 'done'].indexOf(rider.phase),
        );
      for (const key of [...vehicles.keys()].sort())
        hash = word(hash, vehicles.get(key)!.aboard.length);
      return hash;
    },
  };
}

export type Transit = ReturnType<typeof createTransit>;
