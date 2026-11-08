import { createRandom, type Random } from '../geo/random';
import type { CConnector, CompiledCity } from '../network';
import type { Scenario, SimParams, TripRequest } from '../schema';
import type { createAccounting } from './metrics';
import { COMPLETED, FAILED, QUEUED_ORIGIN, type Vehicles } from './vehicle';
import type { createParking } from './parking';

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
  parking: ReturnType<typeof createParking>,
) {
  let queues = compiled.connectors.map((): number[] => []);
  let head = new Uint32Array(queues.length);
  let ready = new Uint32Array(queues.length);
  // Lead (TASK-103 merge): when a connector's queue next needs a look, 0 while cars are ready
  // to leave. Parked stock queues one car per slot connector, so skipping idle queues keeps the
  // step from walking thousands of them; a skipped queue would have done nothing that step.
  let wake = new Float64Array(queues.length);
  let nextAdmission = new Float64Array(queues.length).fill(-Infinity);
  let inside = new Uint32Array(compiled.places.length);
  let admitted = new Uint32Array(compiled.places.length);
  let disconnected: number[] = [];
  const previousArrival = new Int32Array(trips.length).fill(-1);
  // TASK-077: the queue a trip was released from, whether its release freed a slot at its
  // origin place, and when a respawned trip rejoined its queue.
  let releasedFrom = new Int32Array(trips.length).fill(-1);
  const freedSlot = new Uint8Array(trips.length);
  const requeuedS = new Float64Array(trips.length).fill(-Infinity);
  let tracked = compiled.places.map((place) => place.kind === 'parking' || place.events.length > 0);
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
  const queuedSince = (id: number) => Math.max(scenario.startS, trips[id]!.departS, requeuedS[id]!);

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
    const out = pickConnector(
      compiled,
      parking.exits(id, place(trip.originPlaceId).connectorsOut),
      rng,
    );
    const destination = place(trip.destinationPlaceId);
    const own = compiled.parking
      .filter((f) => f.place === destination.idx)
      .flatMap((f) => f.connectorsIn);
    const into = pickConnector(
      compiled,
      destination.connectorsIn.length ? destination.connectorsIn : own,
      rng,
    );
    if (out === -1 || (into === -1 && !parking.required(id))) {
      accounting.fail(id, out === -1 ? 'no_origin_connector' : 'no_destination_connector');
      continue;
    }
    vehicles.destination[id] = into;
    vehicles.speedFactor[id] = Math.max(0.1, rng.normal(1, params.idm.desiredSpeedSd));
    vehicles.routeSeed[id] = Math.floor(rng.next() * 0x100000000);
    queues[out]!.push(id);
  }
  for (const queue of queues) queue.sort((a, b) => trips[a]!.departS - trips[b]!.departS || a - b);
  let origins = compiled.connectors.filter((c) => queues[c.idx]!.length);
  const canUse = (connector: CConnector, timeS: number) =>
    timeS + 1e-9 >= nextAdmission[connector.idx]!;
  const recordAdmission = (connector: CConnector, timeS: number) => {
    nextAdmission[connector.idx] = timeS + 60 / connector.throughputPerMin;
  };

  function spawn(
    timeS: number,
    hasGap: (connector: CConnector, id: number) => boolean,
    release: (id: number, connector: CConnector, timeS: number) => boolean,
  ) {
    disconnected = disconnected.filter((id) => {
      if (queuedSince(id) > timeS + 1e-9) return true;
      accounting.fail(id, 'no_origin_connector');
      return false;
    });
    for (const connector of origins) {
      const idx = connector.idx;
      if (wake[idx]! > timeS + 1e-9) continue;
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
            parking.ready(queue[candidate]!) &&
            (previous === -1 ||
              vehicles.state[previous] === COMPLETED ||
              vehicles.state[previous] === FAILED)
          )
            break;
          candidate++;
        }
        if (candidate === available) break;
        const candidateId = queue[candidate]!;
        const previous = previousArrival[candidateId]!;
        if (
          parking.stranded(candidateId) ||
          (previous !== -1 && vehicles.state[previous] === FAILED)
        ) {
          [queue[i], queue[candidate]] = [queue[candidate]!, queue[i]!];
          accounting.fail(queue[i++]!, 'stranded');
          continue;
        }
        if (parking.noOriginCar(candidateId)) {
          [queue[i], queue[candidate]] = [queue[candidate]!, queue[i]!];
          accounting.fail(queue[i++]!, 'no_parking');
          continue;
        }
        if (vehicles.destination[candidateId] === -1 && !parking.required(candidateId)) {
          [queue[i], queue[candidate]] = [queue[candidate]!, queue[i]!];
          accounting.fail(queue[i++]!, 'no_destination_connector');
          continue;
        }
        const place =
          compiled.places[compiled.index.place.get(trips[candidateId]!.originPlaceId)!]!;
        // A parked car must leave beyond its own arrival queue. Otherwise spawning at an
        // upstream "both" portal fills the only lane needed to free the next parking slot.
        const usable = (exit: CConnector) => {
          if (!canUse(exit, timeS) || !hasGap(exit, candidateId)) return false;
          if (place.capacity === null) return true;
          for (let car = vehicles.first(exit.lane); car !== -1; car = vehicles.next[car]!) {
            if (vehicles.position[car]! < exit.positionM) break;
            const destination = compiled.connectors[vehicles.destination[car]!];
            if (destination?.place === exit.place) return false;
          }
          return true;
        };
        let exits = parking.exits(candidateId, place.connectorsOut);
        if (exits.includes(connector.idx)) {
          exits =
            !parking.hasOriginFacility(candidateId) && place.capacity === null
              ? [connector.idx]
              : [connector.idx, ...exits.filter((idx) => idx !== connector.idx)];
        }
        if (!exits.length) {
          [queue[i], queue[candidate]] = [queue[candidate]!, queue[i]!];
          accounting.fail(queue[i++]!, 'no_origin_connector');
          continue;
        }
        const candidates = exits.map((idx) => compiled.connectors[idx]!).filter(usable);
        if (!candidates.length) break;
        [queue[i], queue[candidate]] = [queue[candidate]!, queue[i]!];
        const id = queue[i]!;
        const exit = candidates.find((exit) => release(id, exit, timeS));
        if (!exit) {
          if (candidates.length !== exits.length) break;
          i++;
          accounting.fail(
            id,
            parking.required(id) || parking.leavingSpace(id) ? 'no_parking' : 'no_route',
          );
          continue;
        }
        i++;
        vehicles.waiting[id] = vehicles.waiting[id]! + Math.max(0, timeS - queuedSince(id));
        parking.depart(id, timeS);
        recordAdmission(exit, timeS);
        releasedFrom[id] = idx;
        freedSlot[id] = 0;
        if (inside[place.idx]! && (!tracked[place.idx] || previous !== -1)) {
          inside[place.idx]!--;
          freedSlot[id] = 1;
        }
      }
      head[idx] = i;
      wake[idx] =
        i < available ? 0 : available < queue.length ? queuedSince(queue[available]!) : Infinity;
    }
  }

  function canArrive(connector: CConnector, timeS: number, id?: number) {
    if (parking.full(connector.idx, id) || (id !== undefined && !parking.admits(id, connector.idx)))
      return false;
    const place =
      id === undefined ? connector.place : compiled.index.place.get(trips[id]!.destinationPlaceId)!;
    const { capacity = null, events = [] } = compiled.places[place] ?? {};
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
      (capacity === null || inside[place]! < capacity) &&
      (events.length === 0 || admitted[place]! < allowance) &&
      canUse(connector, timeS)
    );
  }

  function arrive(connector: CConnector, timeS: number, id?: number) {
    if (!canArrive(connector, timeS, id)) return false;
    recordAdmission(connector, timeS);
    const place =
      id === undefined ? connector.place : compiled.index.place.get(trips[id]!.destinationPlaceId)!;
    if (place !== -1) {
      inside[place]!++;
      admitted[place]!++;
    }
    return true;
  }

  /**
   * TASK-077: a respawned trip rejoins the queue it was released from, ahead of trips with
   * later departure times, and its car is back inside its origin place.
   */
  function requeue(id: number, timeS: number) {
    const place = compiled.places[compiled.index.place.get(trips[id]!.originPlaceId)!]!;
    if (freedSlot[id]) inside[place.idx]!++;
    freedSlot[id] = 0;
    requeuedS[id] = timeS;
    const exits = parking.exits(id, place.connectorsOut);
    const out = exits.includes(releasedFrom[id]!) ? releasedFrom[id]! : exits[id % exits.length];
    if (out === undefined) {
      disconnected.push(id);
      return;
    }
    const queue = queues[out]!;
    const { departS } = trips[id]!;
    let i = head[out]!;
    while (
      i < ready[out]! &&
      (trips[queue[i]!]!.departS < departS ||
        (trips[queue[i]!]!.departS === departS && queue[i]! < id))
    )
      i++;
    queue.splice(i, 0, id);
    ready[out]!++;
    wake[out] = 0;
    if (queue.length === 1) origins = compiled.connectors.filter((c) => queues[c.idx]!.length);
  }

  function patch(next: CompiledCity) {
    const nextQueues = next.connectors.map((): number[] => []);
    const assign = (id: number, oldConnector?: CConnector) => {
      const place = next.places[next.index.place.get(trips[id]!.originPlaceId)!]!;
      const exits = parking.exits(id, place.connectorsOut);
      const mapped = oldConnector && next.index.connector.get(oldConnector.id);
      const out =
        mapped !== undefined && exits.includes(mapped) ? mapped : exits[id % exits.length];
      if (out === undefined) disconnected.push(id);
      else nextQueues[out]!.push(id);
    };
    const orphaned = disconnected;
    disconnected = [];
    for (const id of orphaned) assign(id);
    for (const connector of origins)
      for (const id of queues[connector.idx]!.slice(head[connector.idx])) assign(id, connector);
    for (const queue of nextQueues)
      queue.sort((a, b) => trips[a]!.departS - trips[b]!.departS || a - b);
    const budgets = new Float64Array(next.connectors.length).fill(-Infinity);
    for (const connector of next.connectors) {
      const old = compiled.index.connector.get(connector.id);
      if (old !== undefined) budgets[connector.idx] = nextAdmission[old]!;
    }
    const remapPlaces = (values: Uint32Array) =>
      Uint32Array.from(next.places, (place) => values[compiled.index.place.get(place.id)!] ?? 0);
    inside = remapPlaces(inside);
    admitted = remapPlaces(admitted);
    tracked = next.places.map((place) => place.kind === 'parking' || place.events.length > 0);
    queues = nextQueues;
    releasedFrom = releasedFrom.map((old) =>
      old === -1 ? -1 : (next.index.connector.get(compiled.connectors[old]!.id) ?? -1),
    );
    head = new Uint32Array(queues.length);
    ready = new Uint32Array(queues.length);
    wake = new Float64Array(queues.length);
    nextAdmission = budgets;
    origins = next.connectors.filter((c) => queues[c.idx]!.length);
    compiled = next;
  }

  return { spawn, canArrive, arrive, queuedSince, requeue, patch };
}
