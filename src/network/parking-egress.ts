import type { CompiledCity } from './types';
import { isLaneDrop } from './lane-drop';
import { vehicleClasses, type VehicleClass } from '../schema';

const cache = new WeakMap<CompiledCity, Map<string, ReturnType<typeof derive>>>();
const reachability = new WeakMap<CompiledCity, Map<string, Float64Array>>();

/** Derived once per compile/class: reach the circulation core legal from the origin's access zone. */
export function parkingEgress(
  city: CompiledCity,
  changeDistanceM: number,
  vehicleClass: VehicleClass = 'car',
  delivery = false,
) {
  let entries = cache.get(city);
  if (!entries) cache.set(city, (entries = new Map()));
  const key = `${vehicleClass}:${delivery}:${changeDistanceM}`;
  let result = entries.get(key);
  if (!result) entries.set(key, (result = derive(city, changeDistanceM, vehicleClass, delivery)));
  return result;
}

function derive(
  city: CompiledCity,
  changeDistanceM: number,
  vehicleClass: VehicleClass,
  delivery: boolean,
) {
  const kind = vehicleClasses.indexOf(vehicleClass);
  let shared = reachability.get(city);
  if (!shared) reachability.set(city, (shared = new Map()));
  const outgoing = city.lanes.map((): number[] => []);
  for (const movement of city.movements)
    if (!movement.neverGreen && !isLaneDrop(city, movement))
      outgoing[movement.fromLane]!.push(movement.toLane);
  const incoming = city.lanes.map((): number[] => []);
  for (let from = 0; from < outgoing.length; from++)
    for (const to of outgoing[from]!) incoming[to]!.push(from);
  const coreFor = (allowed: boolean[]) => {
    // Iterative Kosaraju: movements only. A lane needing a change is not itself a core seed.
    const seen = new Uint8Array(city.lanes.length),
      order: number[] = [];
    for (const lane of city.lanes) {
      if (!allowed[lane.idx] || seen[lane.idx]) continue;
      const stack = [lane.idx];
      while (stack.length) {
        const at = stack.pop()!;
        if (at < 0) {
          order.push(~at);
          continue;
        }
        if (seen[at]) continue;
        seen[at] = 1;
        stack.push(~at);
        for (const to of outgoing[at]!) if (allowed[to] && !seen[to]) stack.push(to);
      }
    }
    seen.fill(0);
    let core: number[] = [];
    let largest = 0;
    for (const at of order.reverse()) {
      if (seen[at]) continue;
      const component: number[] = [],
        stack = [at];
      seen[at] = 1;
      while (stack.length) {
        const to = stack.pop()!;
        component.push(to);
        for (const from of incoming[to]!)
          if (allowed[from] && !seen[from]) {
            seen[from] = 1;
            stack.push(from);
          }
      }
      if (component.length > largest) {
        largest = component.length;
        core = component;
      } else if (component.length === largest) core.push(...component);
    }
    return core;
  };

  const allowedFor = (zone: number) =>
    city.lanes.map((lane) => {
      if (!lane.allowed.includes(vehicleClass)) return false;
      const road = city.roads[lane.road]!,
        access = road.access[kind];
      return (
        access === 'yes' ||
        (access === 'delivery' && delivery) ||
        ((access === 'private' || access === 'destination') && road.zone[kind] === zone)
      );
    });
  const byZone = new Map<number, Float64Array>();
  function latest(zone: number) {
    let result = byZone.get(zone);
    if (result) return result;
    const allowed = allowedFor(zone);
    // Classes/zones with identical permissions have the same movement graph and thresholds.
    const key = `${changeDistanceM}:${allowed.map(Number).join('')}`;
    const cached = shared!.get(key);
    if (cached) {
      byZone.set(zone, cached);
      return cached;
    }
    const core = coreFor(allowed);
    result = new Float64Array(city.lanes.length).fill(-Infinity);
    const queue = core.slice();
    for (const lane of core) result[lane] = city.lanes[lane]!.lengthM;
    const extend = (from: number, station: number) => {
      if (station >= 0 && station > result![from]! && allowed[from]) {
        result![from] = station;
        queue.push(from);
      }
    };
    for (let head = 0; head < queue.length; head++) {
      const to = queue[head]!,
        lane = city.lanes[to]!;
      for (const from of incoming[to]!) extend(from, city.lanes[from]!.lengthM);
      for (const from of [lane.left, lane.right])
        if (from !== -1)
          extend(
            from,
            Math.min(result[to]!, lane.lengthM, city.lanes[from]!.lengthM) - changeDistanceM,
          );
    }
    byZone.set(zone, result);
    shared!.set(key, result);
    return result;
  }
  // The forward counterpart is used only when placing a new, bidirectional portal.
  const arrivals = new Map<number, Float64Array>();
  function earliestArrival(laneIndex: number) {
    const zone = city.roads[city.lanes[laneIndex]!.road]!.zone[kind]!;
    let first = arrivals.get(zone);
    if (!first) {
      const allowed = allowedFor(zone);
      first = new Float64Array(city.lanes.length).fill(Infinity);
      const queue = coreFor(allowed);
      for (const lane of queue) first[lane] = 0;
      const extend = (to: number, station: number) => {
        if (allowed[to] && station <= city.lanes[to]!.lengthM && station < first![to]!) {
          first![to] = station;
          queue.push(to);
        }
      };
      for (let head = 0; head < queue.length; head++) {
        const from = queue[head]!,
          lane = city.lanes[from]!;
        for (const to of outgoing[from]!) extend(to, 0);
        for (const to of [lane.left, lane.right])
          if (to !== -1 && first[from]! + changeDistanceM <= lane.lengthM)
            extend(to, first[from]! + changeDistanceM);
      }
      arrivals.set(zone, first);
    }
    return first[laneIndex]!;
  }
  const connectors = Uint8Array.from(city.connectors, (c) => {
    const road = city.roads[city.lanes[c.lane]!.road]!;
    return Number(latest(road.zone[kind]!)[c.lane]! + 1e-9 >= c.positionM);
  });
  const facilities = Uint8Array.from(city.parking, (f) =>
    Number(f.connectorsOut.some((c) => connectors[c])),
  );
  let spaces: Uint8Array | undefined;
  const parkingSpaces = () => {
    const lots = city.parking.map((f) =>
      f.kind === 'lot' ? city.lots!.find((l) => l.id === f.id)!.circulation! : undefined,
    );
    return Uint8Array.from(city.parkingSpaces ?? [], (s) => {
      const facility = city.parking[s.parking]!;
      if (facility.kind !== 'lot') return connectors[s.connector]!;
      const lot = lots[facility.idx]!;
      return Number(
        lot.entries.some(
          (e) =>
            facility.connectorsOut.includes(e.connector) &&
            connectors[e.connector] &&
            Number.isFinite(e.distances[lot.stallNodes[s.lotStall!]!]),
        ),
      );
    });
  };
  const latestDeparture = (lane: number) =>
    latest(city.roads[city.lanes[lane]!.road]!.zone[kind]!)[lane]!;
  return {
    connectors,
    facilities,
    get spaces() {
      return (spaces ??= parkingSpaces());
    },
    latestDeparture,
    earliestArrival,
  };
}
