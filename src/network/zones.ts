import { vehicleClasses } from '../schema';
import type { CompiledCity, CRoad } from './types';

// TASK-294: "Anlieger frei" pockets. A pocket is a component of a class's open roads (access
// `yes`, a lane the class may use) other than the largest, the outside, that a car reaches only
// through access zones; it becomes a zone of its own. Zones and pockets are ranked by how many
// zones a car passes on its way in from the outside (a pocket's open roads count none). A zone
// or pocket reaches itself and what the zones and pockets it touches on such fewest-zones ways
// in reach. A trip may use every zone its origin's and destination's zones reach. A zone the
// outside touches reaches only itself: through traffic stays out, a lot on a public street still
// grants only its own aisles, and a city without pockets compiles as before. A gateway's open
// road stands for the roads beyond the map: it joins no pocket and links nothing, so a trip to
// or from a gateway in a pocket gets no zone from it (Lübeck's Wallstraße).

const CLOSED = -2;

function restricted(road: CRoad, kind: number) {
  return road.access[kind] === 'destination' || road.access[kind] === 'private';
}

/** Open roads for a class, but for those carrying a gateway's connector. */
function openRoads(city: CompiledCity, kind: number) {
  const vehicleClass = vehicleClasses[kind]!;
  const result = Uint8Array.from(
    city.roads,
    (road) =>
      +(
        road.access[kind] === 'yes' &&
        road.lanes.some((lane) => city.lanes[lane]!.allowed.includes(vehicleClass))
      ),
  );
  for (const connector of city.connectors)
    if (city.places[connector.place]?.kind === 'gateway')
      result[city.lanes[connector.lane]!.road] = 0;
  return result;
}

/** Group links through shared nodes: `links[g + 1]` for group `g` (-1 the outside). */
function linkGroups(city: CompiledCity, count: number, group: (road: CRoad) => number) {
  const atNode = city.nodes.map(() => new Set<number>());
  for (const road of city.roads) {
    const g = group(road);
    if (g === CLOSED) continue;
    atNode[road.from]!.add(g);
    atNode[road.to]!.add(g);
  }
  const links = Array.from({ length: count + 1 }, () => new Set<number>());
  for (const groups of atNode)
    for (const a of groups) for (const b of groups) if (a !== b) links[a + 1]!.add(b);
  return links;
}

/** Zones a car passes from the outside to each group (0: unreached); `cost(g)` 1 for a zone,
 * 0 for a pocket. Ties are found in ascending group order. */
function depths(links: Set<number>[], count: number, cost: (g: number) => number) {
  const depth = new Int32Array(count);
  const queue = [...links[0]!].sort((a, b) => a - b);
  for (const g of queue) depth[g] = cost(g);
  for (let head = 0; head < queue.length; head++)
    for (const next of [...links[queue[head]! + 1]!].sort((a, b) => a - b)) {
      if (next < 0) continue;
      const d = depth[queue[head]!]! + cost(next);
      if (!depth[next] || d < depth[next]!) {
        depth[next] = d;
        queue.push(next);
      }
    }
  return depth;
}

/** Compile step, before parking: pockets the outside reaches become zones, numbered after the
 * zones of restricted roads in road order. */
export function assignPocketZones(city: CompiledCity) {
  for (let kind = 0; kind < vehicleClasses.length; kind++) {
    const zones = 1 + Math.max(-1, ...city.roads.map((road) => road.zone[kind]!));
    const part = new Int32Array(city.roads.length).fill(-1);
    const sizes: number[] = [];
    const open = openRoads(city, kind);
    const atNode = city.nodes.map((): CRoad[] => []);
    for (const road of city.roads)
      if (open[road.idx]) for (const node of [road.from, road.to]) atNode[node]!.push(road);
    for (const road of city.roads) {
      if (part[road.idx] !== -1 || !open[road.idx]) continue;
      const pending = [road];
      part[road.idx] = sizes.length;
      for (let i = 0; i < pending.length; i++)
        for (const node of [pending[i]!.from, pending[i]!.to])
          for (const next of atNode[node]!)
            if (part[next.idx] === -1) {
              part[next.idx] = sizes.length;
              pending.push(next);
            }
      sizes.push(pending.length);
    }
    const outside = sizes.indexOf(Math.max(...sizes));
    const group = (road: CRoad) =>
      restricted(road, kind)
        ? road.zone[kind]!
        : part[road.idx] === -1
          ? CLOSED
          : part[road.idx] === outside
            ? -1
            : zones + part[road.idx]!;
    const count = zones + sizes.length;
    const depth = depths(linkGroups(city, count, group), count, (g) => (g < zones ? 1 : 0));
    const id = new Int32Array(sizes.length).fill(-1);
    let next = zones;
    for (let p = 0; p < sizes.length; p++) if (depth[zones + p]) id[p] = next++;
    for (const road of city.roads) {
      const g = group(road);
      if (g >= zones) road.zone[kind] = id[g - zones]!;
    }
  }
}

const cache = new WeakMap<CompiledCity, { version: number; reach: number[][][] }>();

/** Per class and zone, the zones (itself included, ascending) a trip starting or ending in that
 * zone may use. Every open road outside a pocket counts as the outside here. */
export function zoneReach(city: CompiledCity, kind: number): number[][] {
  let entry = cache.get(city);
  if (entry?.version !== city.version) {
    entry = { version: city.version, reach: [] };
    cache.set(city, entry);
  }
  return (entry.reach[kind] ??= derive(city, kind));
}

function derive(city: CompiledCity, kind: number) {
  const count = 1 + Math.max(-1, ...city.roads.map((road) => road.zone[kind]!));
  const pocket = new Uint8Array(count);
  for (const road of city.roads)
    if (road.zone[kind]! >= 0 && !restricted(road, kind)) pocket[road.zone[kind]!] = 1;
  const open = openRoads(city, kind);
  const links = linkGroups(city, count, (road) =>
    restricted(road, kind) || road.zone[kind]! >= 0
      ? road.zone[kind]!
      : open[road.idx]
        ? -1
        : CLOSED,
  );
  const cost = (g: number) => 1 - pocket[g]!;
  const depth = depths(links, count, cost);
  const reach = Array.from({ length: count }, (_, z) => [z]);
  const order = [...depth.keys()]
    .filter((g) => depth[g])
    .sort((a, b) => depth[a]! - depth[b]! || cost(b) - cost(a) || a - b);
  for (const g of order) {
    const own = new Set([g]);
    for (const prior of links[g + 1]!)
      if (prior >= 0 && depth[prior] && depth[prior]! + cost(g) === depth[g])
        for (const z of reach[prior]!) own.add(z);
    reach[g] = [...own].sort((a, b) => a - b);
  }
  return reach;
}
