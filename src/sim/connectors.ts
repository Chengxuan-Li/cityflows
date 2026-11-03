import { createRandom, type Random } from '../geo/random';
import type { CConnector, CompiledCity } from '../network';
import type { Scenario, SimParams, TripRequest } from '../schema';
import type { createAccounting } from './metrics';
import { QUEUED_ORIGIN, type Vehicles } from './vehicle';

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
  const random = createRandom(scenario.seed);
  const queuedSince = (id: number) => Math.max(scenario.startS, trips[id]!.departS);

  for (const [id, trip] of trips.entries()) {
    if (trip.mode !== 'car') {
      accounting.fail(id, 'unsupported_mode');
      continue;
    }
    if (trip.departS > scenario.endS) continue;
    const rng = random.derive(trip.id);
    const origin = compiled.places[compiled.index.place.get(trip.originPlaceId) ?? -1];
    const destination = compiled.places[compiled.index.place.get(trip.destinationPlaceId) ?? -1];
    const out = pickConnector(compiled, origin?.connectorsOut ?? [], rng);
    const into = pickConnector(compiled, destination?.connectorsIn ?? [], rng);
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
      while (i < available && canUse(connector, timeS) && hasGap(connector)) {
        const id = queue[i++]!;
        vehicles.waiting[id] = Math.max(0, timeS - queuedSince(id));
        if (release(id, connector, timeS)) {
          recordAdmission(connector, timeS);
          if (inside[connector.place]!) inside[connector.place]!--;
        }
      }
      head[idx] = i;
    }
  }

  function canArrive(connector: CConnector, timeS: number) {
    const capacity = compiled.places[connector.place]!.capacity;
    return (capacity === null || inside[connector.place]! < capacity) && canUse(connector, timeS);
  }

  function arrive(connector: CConnector, timeS: number) {
    if (!canArrive(connector, timeS)) return false;
    recordAdmission(connector, timeS);
    inside[connector.place]!++;
    return true;
  }

  return { spawn, canArrive, arrive, queuedSince };
}
