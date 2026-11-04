import { createRandom, type Random } from '../geo/random';
import type { CConnector, CompiledCity } from '../network';
import type { Scenario, SimParams, TripRequest } from '../schema';
import type { createAccounting } from './metrics';
import { COMPLETED, FAILED, QUEUED_ORIGIN, type Vehicles } from './vehicle';

function pickConnector(compiled: CompiledCity, choices: number[], random: Random): number {
  if (choices.length === 0) return -1;
  if (choices.length === 1) return choices[0]!;
  const total = choices.reduce((sum, idx) => sum + compiled.connectors[idx]!.throughputPerMin, 0);
  let weight = random.uniform(0, total);
  for (const idx of choices) {
    weight -= compiled.connectors[idx]!.throughputPerMin;
    if (weight < 0) return idx;
  }
  return choices.at(-1)!;
}

export function createConnectors(
  compiled: CompiledCity,
  trips: TripRequest[],
  scenario: Scenario,
  params: SimParams,
  vehicles: Vehicles,
  accounting: ReturnType<typeof createAccounting>,
) {
  const queues = compiled.connectors.map((): number[] => []);
  const head = new Uint32Array(queues.length);
  const ready = new Uint32Array(queues.length);
  const nextAdmission = new Float64Array(queues.length).fill(-Infinity);
  const inside = new Uint32Array(compiled.places.length);
  const admitted = new Uint32Array(compiled.places.length);
  const previousArrival = new Int32Array(trips.length).fill(-1);
  const tracked = compiled.places.map(
    (place) => place.kind === 'parking' || place.events.length > 0,
  );
  const arrivals = new Map<string, Map<string, number>>();
  // Pair visits once at load. A scheduled return must not free a slot before the car arrives.
  const chronological = trips
    .map((_, id) => id)
    .sort((a, b) => trips[a]!.departS - trips[b]!.departS || a - b);
  for (const id of chronological) {
    const trip = trips[id]!;
    if (trip.personId === null) continue;
    let visits = arrivals.get(trip.personId);
    if (!visits) arrivals.set(trip.personId, (visits = new Map()));
    const origin = compiled.index.place.get(trip.originPlaceId)!;
    if (tracked[origin]) {
      previousArrival[id] = visits.get(trip.originPlaceId) ?? -1;
      visits.delete(trip.originPlaceId);
    }
    if (tracked[compiled.index.place.get(trip.destinationPlaceId)!])
      visits.set(trip.destinationPlaceId, id);
  }
  const random = createRandom(scenario.seed);
  const queuedSince = (id: number) => Math.max(scenario.startS, trips[id]!.departS);

  for (const [id, trip] of trips.entries()) {
    if (trip.mode !== 'car') {
      accounting.fail(id, 'unsupported_mode');
      continue;
    }
    if (trip.departS > scenario.endS) continue;
    const rng = random.derive(trip.id);
    const place = (id: string) => {
      const idx = compiled.index.place.get(id);
      if (idx === undefined) throw new Error(`Trip ${trip.id} names unknown place ${id}`);
      return compiled.places[idx]!;
    };
    const out = pickConnector(compiled, place(trip.originPlaceId).connectorsOut, rng);
    const into = pickConnector(compiled, place(trip.destinationPlaceId).connectorsIn, rng);
    if (out === -1 || into === -1) {
      accounting.fail(id, out === -1 ? 'no_origin_connector' : 'no_destination_connector');
      continue;
    }
    vehicles.destination[id] = into;
    vehicles.speedFactor[id] = Math.max(0.1, rng.normal(1, params.idm.desiredSpeedSd));
    vehicles.routeSeed[id] = Math.floor(rng.next() * 0x100000000);
    queues[out]!.push(id);
  }
  for (const queue of queues) queue.sort((a, b) => trips[a]!.departS - trips[b]!.departS || a - b);
  const origins = compiled.connectors.filter((c) => queues[c.idx]!.length);
  const canUse = (connector: CConnector, timeS: number) =>
    timeS + 1e-9 >= nextAdmission[connector.idx]!;
  const recordAdmission = (connector: CConnector, timeS: number) => {
    nextAdmission[connector.idx] = timeS + 60 / connector.throughputPerMin;
  };

  function spawn(
    timeS: number,
    hasGap: (connector: CConnector) => boolean,
    release: (id: number, connector: CConnector, timeS: number) => boolean,
  ) {
    for (const connector of origins) {
      const idx = connector.idx;
      const queue = queues[idx]!;
      let available = ready[idx]!;
      while (available < queue.length && queuedSince(queue[available]!) <= timeS + 1e-9) {
        accounting.transition(queue[available++]!, QUEUED_ORIGIN);
      }
      ready[idx] = available;
      let i = head[idx]!;
      while (i < available) {
        // Cars still approaching a car park do not hold up already parked departures.
        let candidate = i;
        while (candidate < available) {
          const previous = previousArrival[queue[candidate]!]!;
          if (
            previous === -1 ||
            vehicles.state[previous] === COMPLETED ||
            vehicles.state[previous] === FAILED
          )
            break;
          candidate++;
        }
        if (candidate === available) break;
        const place = compiled.places[connector.place]!;
        // A parked car must leave beyond its own arrival queue. Otherwise spawning at an
        // upstream "both" portal fills the only lane needed to free the next parking slot.
        const usable = (exit: CConnector) => {
          if (!canUse(exit, timeS) || !hasGap(exit)) return false;
          if (place.capacity === null) return true;
          for (let car = vehicles.first(exit.lane); car !== -1; car = vehicles.next[car]!) {
            if (vehicles.position[car]! < exit.positionM) break;
            const destination = compiled.connectors[vehicles.destination[car]!];
            if (destination?.place === exit.place) return false;
          }
          return true;
        };
        const exit = usable(connector)
          ? connector
          : place.capacity === null
            ? undefined
            : place.connectorsOut.map((idx) => compiled.connectors[idx]!).find(usable);
        if (!exit) break;
        [queue[i], queue[candidate]] = [queue[candidate]!, queue[i]!];
        const id = queue[i++]!;
        const previous = previousArrival[id]!;
        if (previous !== -1 && vehicles.state[previous] === FAILED) {
          accounting.fail(id, 'stranded');
          continue;
        }
        vehicles.waiting[id] = Math.max(0, timeS - queuedSince(id));
        if (release(id, exit, timeS)) {
          recordAdmission(exit, timeS);
          if (inside[connector.place]! && (!tracked[connector.place] || previous !== -1))
            inside[connector.place]!--;
        }
      }
      head[idx] = i;
    }
  }

  function canArrive(connector: CConnector, timeS: number) {
    const { capacity, events } = compiled.places[connector.place]!;
    const allowance = events.reduce(
      (sum, event) =>
        sum +
        Math.floor(
          event.arrivals * Math.max(0, Math.min(1, (timeS - event.startS) / event.durationS)) +
            1e-9,
        ),
      0,
    );
    return (
      (capacity === null || inside[connector.place]! < capacity) &&
      (events.length === 0 || admitted[connector.place]! < allowance) &&
      canUse(connector, timeS)
    );
  }

  function arrive(connector: CConnector, timeS: number) {
    if (!canArrive(connector, timeS)) return false;
    recordAdmission(connector, timeS);
    inside[connector.place]!++;
    admitted[connector.place]!++;
    return true;
  }

  return { spawn, canArrive, arrive, queuedSince };
}
