import { vehicleClasses } from '../schema';
import { isLaneDrop } from './lane-drop';
import { reachableLanes } from './lane-reach';
import type { CompiledCity, CPlace } from './types';
import { zoneReach } from './zones';

const CLOSED = -2;
const cache = new WeakMap<CompiledCity, ReturnType<typeof derive>>();

/**
 * TASK-155: whether a car trip between two places, at least one of them a gateway, can be
 * served at all. A gateway's component is what its departure lanes reach (or what reaches its
 * arrival lanes), following movements and adjacent-lane changes along legal car lanes: public
 * roads and the trip end's own private/destination zone, entering another zone only to end in
 * it or in a zone on its chain (TASK-294), as the router allows. Lane changes are made as the
 * router makes them (TASK-351), but stations are ignored, so this only rules out trips no route can
 * serve, such as those from a motorway piece the crop cut off.
 * A non-gateway end counts its own connectors and every facility it could park at, where a car
 * arriving there may park and leave again. TASK-283: a trip leaving the person's home is judged by
 * their own car, which stands in a facility the home owns, not by every facility the home could
 * use: a public car park in a pocket behind destination streets made every home look served by
 * the pocket's gateway, and those trips failed `no_route` (TASK-270). The car may stand in any
 * facility the home owns, so each needs a route (Cambridge's block of 1,696 residents owns a
 * garage of 4 that reaches its north-east and one of 1,692 that does not).
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
    // TASK-294: an open road in a pocket carries the pocket's zone.
    if (access === 'yes') return road.zone[car]!;
    return access === 'private' || access === 'destination' ? road.zone[car]! : CLOSED;
  });
  const zones = zoneReach(city, car);
  // Zones on one chain from the outside: a trip ending in one may use the other (TASK-294).
  const nested = (a: number, b: number) =>
    a === b || zones[a]!.includes(b) || zones[b]!.includes(a);
  const forward = city.lanes.map((): number[] => []);
  const link = (from: number, to: number) => forward[from]!.push(to);
  const moves = city.lanes.map((): number[] => []);
  for (const movement of city.movements)
    if (!movement.neverGreen && !isLaneDrop(city, movement)) {
      link(movement.fromLane, movement.toLane);
      moves[movement.fromLane]!.push(movement.toLane);
    }
  // TASK-351: trips are judged with lane changes as the router makes them (`reachableLanes`, as
  // TASK-286's gateways): Zurich's terminal loop on Flughafenstrasse reaches the rest of the
  // landside only by changes on roads too short for them, and its cars failed `no_route`.
  const routed = city.lanes.map((): number[] => []),
    routedBack = city.lanes.map((): number[] => []);
  const open = city.lanes.map((lane) => zone[lane.idx] !== CLOSED);
  for (const lane of city.lanes) {
    for (const side of [lane.left, lane.right]) if (side !== -1) link(lane.idx, side);
    const endM = Math.max(0, city.roads[lane.road]!.lengthM - 10);
    for (const { lane: from } of reachableLanes(city, open, lane.idx, endM, 30))
      for (const to of [from, ...moves[from]!]) {
        routed[lane.idx]!.push(to);
        routedBack[to]!.push(lane.idx);
      }
  }

  function reach(seeds: number[], edges: number[][]) {
    const reached = new Uint8Array(city.lanes.length);
    const own = new Set(seeds.flatMap((lane) => zones[zone[lane]!] ?? [zone[lane]!]));
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
        if (!reached[next] && zone[next]! >= 0 && nested(zone[next]!, zone[at]!)) {
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
  // TASK-283: where a resident's car stands at home: in any facility the home owns with an exit
  // (the engine stocks its cars there), else at its own connectors.
  const homeStands = city.places.map((place) => {
    const own = city.parking.filter((f) => f.place === place.idx && f.connectorsOut.length);
    return own.length ? own.map((f) => lanes(f.connectorsOut)) : [lanes(place.connectorsOut)];
  });
  const departures = new Map<number, Uint8Array>(),
    arrivals = new Map<number, Uint8Array>(),
    onward = new Map<string, Uint8Array>(),
    fromFacility = new Map<number, Uint8Array>();
  const memo = (map: Map<number, Uint8Array>, place: number, make: () => Uint8Array) => {
    let result = map.get(place);
    if (!result) map.set(place, (result = make()));
    return result;
  };
  return {
    /** Place indices. `fromHome`: the trip leaves the person's home, where their own car
     * stands. */
    served(from: number, to: number, fromHome = false) {
      if (gateway(city.places[from]!)) {
        const reached = memo(departures, from, () => reach(exits[from]!, routed));
        return entries[to]!.some((lane) => reached[lane]);
      }
      // TASK-351: when the public network splits inside the map (Zurich: Kloten and the airport
      // landside meet only on airport roads), a car between two places may find no road at all,
      // which the engine fails as `no_route`: it must reach the destination or any facility it
      // could park at, as `reachesParking` judges it there.
      if (!gateway(city.places[to]!)) {
        const reaches = (lanes: number[], key: string) => {
          let reached = onward.get(key);
          if (!reached) onward.set(key, (reached = reach(lanes, routed)));
          return entries[to]!.some((lane) => reached[lane]);
        };
        if (fromHome) return homeStands[from]!.every((stand, i) => reaches(stand, `${from}:${i}`));
        return reaches(exits[from]!, `${from}`);
      }
      const reached = memo(arrivals, to, () => reach(entries[to]!, routedBack));
      if (fromHome) return homeStands[from]!.every((stand) => stand.some((lane) => reached[lane]));
      return exits[from]!.some((lane) => reached[lane]);
    },
    /** TASK-351: whether a car leaving `facility` can reach the place or a facility it could
     * park at (where the public network splits, a street space near home may not). */
    leaves(facility: number, place: number) {
      let reached = fromFacility.get(facility);
      if (!reached)
        fromFacility.set(
          facility,
          (reached = reach(lanes(city.parking[facility]!.connectorsOut), forward)),
        );
      return entries[place]!.some((lane) => reached[lane]);
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
