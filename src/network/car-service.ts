import { vehicleClasses } from '../schema';
import { isLaneDrop } from './lane-drop';
import type { CompiledCity, CPlace } from './types';

const CLOSED = -2;
const cache = new WeakMap<CompiledCity, ReturnType<typeof derive>>();

/**
 * TASK-155: whether a car trip between two places, at least one of them a gateway, can be
 * served at all. A gateway's component is what its departure lanes reach (or what reaches its
 * arrival lanes), following movements and adjacent-lane changes along legal car lanes: public
 * roads and the trip end's own private/destination zone, entering another zone only to end in
 * it, as the router allows. Lane-change distances and stations are ignored, so this only rules
 * out trips no route can serve, such as those from a motorway piece the crop cut off. A
 * non-gateway end counts its own connectors and every facility it could park at.
 */
export function carService(city: CompiledCity) {
  let service = cache.get(city);
  if (!service) cache.set(city, (service = derive(city)));
  return service;
}

function derive(city: CompiledCity) {
  const car = vehicleClasses.indexOf('car');
  const zone = Int32Array.from(city.lanes, (lane) => {
    const road = city.roads[lane.road]!,
      access = road.access[car];
    if (!lane.allowed.includes('car')) return CLOSED;
    if (access === 'yes') return -1;
    return access === 'private' || access === 'destination' ? road.zone[car]! : CLOSED;
  });
  const forward = city.lanes.map((): number[] => []);
  const backward = city.lanes.map((): number[] => []);
  const link = (from: number, to: number) => {
    forward[from]!.push(to);
    backward[to]!.push(from);
  };
  for (const movement of city.movements)
    if (!movement.neverGreen && !isLaneDrop(city, movement))
      link(movement.fromLane, movement.toLane);
  for (const lane of city.lanes)
    for (const side of [lane.left, lane.right]) if (side !== -1) link(lane.idx, side);

  function reach(seeds: number[], edges: number[][]) {
    const reached = new Uint8Array(city.lanes.length);
    const own = new Set(seeds.map((lane) => zone[lane]!));
    const queue: number[] = [];
    for (const lane of seeds)
      if (zone[lane] !== CLOSED && !reached[lane]) {
        reached[lane] = 1;
        queue.push(lane);
      }
    for (let head = 0; head < queue.length; head++)
      for (const next of edges[queue[head]!]!)
        if (!reached[next] && (zone[next] === -1 || own.has(zone[next]!))) {
          reached[next] = 1;
          queue.push(next);
        }
    const zoned: number[] = [];
    for (const at of queue)
      for (const next of edges[at]!)
        if (!reached[next] && zone[next]! >= 0) {
          reached[next] = 1;
          zoned.push(next);
        }
    for (let head = 0; head < zoned.length; head++) {
      const at = zoned[head]!;
      for (const next of edges[at]!)
        if (!reached[next] && zone[next] === zone[at]) {
          reached[next] = 1;
          zoned.push(next);
        }
    }
    return reached;
  }

  const gateway = (place: CPlace) => place.kind === 'gateway';
  const lanes = (connectors: number[]) => connectors.map((idx) => city.connectors[idx]!.lane);
  // Every facility the place's cars could use, as `sim/parking` admits them (own, public, or an
  // unowned lot), without its distance limit: a superset never rules out a servable trip.
  const facilities = city.places.map((place) =>
    city.parking.filter((f) => {
      const owner = city.places[f.place];
      return (
        f.place === place.idx ||
        f.access === 'public' ||
        (f.kind === 'lot' &&
          owner?.kind === 'parking' &&
          !owner.events.length &&
          (f.access !== 'customers' || place.kind !== 'residential'))
      );
    }),
  );
  const entries = city.places.map((place) =>
    lanes([
      ...place.connectorsIn,
      ...(gateway(place) ? [] : facilities[place.idx]!.flatMap((f) => f.connectorsIn)),
    ]),
  );
  const exits = city.places.map((place) =>
    lanes([
      ...place.connectorsOut,
      ...(gateway(place) ? [] : facilities[place.idx]!.flatMap((f) => f.connectorsOut)),
    ]),
  );
  const departures = new Map<number, Uint8Array>(),
    arrivals = new Map<number, Uint8Array>();
  const memo = (map: Map<number, Uint8Array>, place: number, make: () => Uint8Array) => {
    let result = map.get(place);
    if (!result) map.set(place, (result = make()));
    return result;
  };
  return {
    /** Place indices; a pair without a gateway is not judged. */
    served(from: number, to: number) {
      if (gateway(city.places[from]!)) {
        const reached = memo(departures, from, () => reach(exits[from]!, forward));
        return entries[to]!.some((lane) => reached[lane]);
      }
      if (!gateway(city.places[to]!)) return true;
      const reached = memo(arrivals, to, () => reach(entries[to]!, backward));
      return exits[from]!.some((lane) => reached[lane]);
    },
    /** Whether a car on any of `lanes` can reach a facility the place's cars could park at. */
    reachesParking(lanes: number[], place: number) {
      const reached = reach(lanes, forward);
      return facilities[place]!.some((f) =>
        f.connectorsIn.some((c) => reached[city.connectors[c]!.lane]),
      );
    },
  };
}
