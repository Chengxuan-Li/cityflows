import { distance, polylineLength } from '../../geo/polyline';
import type { CompiledCity } from '../../network';
import { allocateId, type City, type Road } from '../../schema';
import type { OsmWay } from './parse';
import type { OsmRoad } from './roads';
import { roadHeading } from './turns';

// Collapse a compact cluster of junctions only along existing roads. The lane paths through
// the old cluster become explicit rules, so contraction cannot introduce a prohibited turn.
export function consolidateJunctions(
  city: City,
  roads: OsmRoad[],
  compiled: CompiledCity,
  signals: string[],
): string[] {
  const parent = new Map(Object.keys(city.nodes).map((id) => [id, id]));
  const members = new Map(Object.keys(city.nodes).map((id) => [id, [id]]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));
  const boundaries = new Set(
    Object.values(city.nodes)
      .filter((node) => {
        const incident = roads.filter(({ road }) => road.from === node.id || road.to === node.id);
        if (incident.some(({ road }) => road.roadClass === 'motorway')) return true;
        const neighbors = new Set(
          incident.map(({ road }) => (road.from === node.id ? road.to : road.from)),
        );
        if (neighbors.size !== 2) return false;
        return (
          new Set(
            incident.map((r) =>
              JSON.stringify(
                (JSON.parse(r.attributes) as string[][]).filter(([key]) =>
                  key!.startsWith('cycleway'),
                ),
              ),
            ),
          ).size > 1
        );
      })
      .map((node) => node.id),
  );
  const restrictedNodes = new Set(
    Object.values(city.nodes)
      .filter((n) => n.turnRules.some((r) => r.fromLane === undefined && !r.allowed))
      .map((n) => n.id),
  );
  for (const { road, attributes } of [...roads].sort(
    (a, b) => polylineLength(a.road.centerline) - polylineLength(b.road.centerline),
  )) {
    if (boundaries.has(road.from) || boundaries.has(road.to)) continue;
    if (
      (JSON.parse(attributes) as string[][]).some(
        ([key, value]) => key === 'bridge' && value !== 'no',
      )
    )
      continue;
    if (
      restrictedNodes.has(road.from) ||
      restrictedNodes.has(road.to) ||
      road.roadClass === 'motorway'
    )
      continue;
    if (polylineLength(road.centerline) >= 30) continue;
    const a = root(road.from),
      b = root(road.to);
    if (a === b) continue;
    const union = [...members.get(a)!, ...members.get(b)!];
    if (union.some((x) => union.some((y) => distance(city.nodes[x]!.pos, city.nodes[y]!.pos) > 60)))
      continue;
    if (
      roads.some(
        ({ road }) =>
          union.includes(road.from) &&
          union.includes(road.to) &&
          polylineLength(road.centerline) >= 30,
      )
    )
      continue;
    parent.set(b, a);
    members.set(a, union);
    members.delete(b);
  }
  const representatives = new Map<string, string>();
  for (const group of members.values()) {
    if (group.length === 1) continue;
    const nodes = new Set(group);
    const inside = new Set(
      roads
        .filter(({ road }) => nodes.has(road.from) && nodes.has(road.to))
        .map(({ road }) => road.id),
    );
    const incoming = roads.filter(({ road }) => nodes.has(road.to) && !inside.has(road.id));
    const outgoing = roads.filter(({ road }) => nodes.has(road.from) && !inside.has(road.id));
    if (!incoming.length || !outgoing.length) continue;
    const clipped = roads.find((r) => inside.has(r.road.id) && (r.cutStart || r.cutEnd));
    const id = clipped ? (clipped.cutStart ? clipped.road.from : clipped.road.to) : group[0]!;
    const node = city.nodes[id]!;
    const positions = group.map((id) => city.nodes[id]!.pos);
    if (!clipped)
      node.pos = {
        x: group.reduce((sum, id) => sum + city.nodes[id]!.pos.x, 0) / group.length,
        y: group.reduce((sum, id) => sum + city.nodes[id]!.pos.y, 0) / group.length,
      };
    const radius = Math.max(...positions.map((pos) => distance(pos, node.pos))) + 5;
    node.provenance = {
      source: 'osm',
      osmIds: [...new Set(group.flatMap((id) => city.nodes[id]!.provenance.osmIds!))].sort(
        (a, b) => a - b,
      ),
      inferred: [
        ...new Set([
          ...node.provenance.inferred!,
          ...roads
            .filter(({ road }) => inside.has(road.id))
            .flatMap(({ road }) => road.provenance.inferred!),
          'junctionConsolidation',
        ]),
      ],
    };
    node.turnRules = [];
    for (const { road: from } of incoming) {
      const visited = new Set<number>();
      const queue = [...compiled.roads[compiled.index.road.get(from.id)!]!.lanes];
      for (const lane of queue) {
        for (const index of compiled.lanes[lane]!.out) {
          const toLane = compiled.movements[index]!.toLane;
          if (visited.has(toLane)) continue;
          visited.add(toLane);
          if (inside.has(compiled.roads[compiled.lanes[toLane]!.road]!.id)) queue.push(toLane);
        }
      }
      for (const { road: to } of outgoing) {
        node.turnRules.push({
          from: from.id,
          to: to.id,
          allowed: compiled.roads[compiled.index.road.get(to.id)!]!.lanes.some((l) =>
            visited.has(l),
          ),
          provenance: { source: 'osm', inferred: ['junctionConsolidation'] },
        });
      }
    }
    for (const { road } of roads.filter(({ road }) => inside.has(road.id)))
      delete city.roads[road.id];
    for (const road of incoming) {
      road.road.to = id;
      while (
        road.road.centerline.length > 2 &&
        distance(road.road.centerline.at(-2)!, node.pos) < radius
      )
        road.road.centerline.splice(road.road.centerline.length - 2, 1);
      road.road.centerline[road.road.centerline.length - 1] = node.pos;
      if (clipped) road.cutEnd = true;
    }
    for (const road of outgoing) {
      road.road.from = id;
      while (
        road.road.centerline.length > 2 &&
        distance(road.road.centerline[1]!, node.pos) < radius
      )
        road.road.centerline.splice(1, 1);
      road.road.centerline[0] = node.pos;
      if (clipped) road.cutStart = true;
    }
    for (const old of group) {
      representatives.set(old, id);
      if (old !== id) delete city.nodes[old];
    }
  }
  roads.splice(0, roads.length, ...roads.filter(({ road }) => city.roads[road.id]));
  return [...new Set(signals.map((id) => representatives.get(id) ?? id))];
}

// A surface-street feeder must reach the opposing carriageway across a narrow median.
// Match named, opposing one-way streets on the same layer; never connect a bridge by proximity.
export function joinDividedFeeders(
  city: City,
  roads: OsmRoad[],
  protectedNodes: Set<string>,
): void {
  for (const node of Object.values(city.nodes)) {
    if (protectedNodes.has(node.id)) continue;
    const incident = roads.filter(({ road }) => road.from === node.id || road.to === node.id);
    const main = incident.find(
      ({ road }) =>
        road.streetGroupId === null &&
        road.name &&
        ['primary', 'secondary', 'tertiary'].includes(road.roadClass),
    );
    if (!main) continue;
    const feeder = incident.find(
      ({ road, layer }) =>
        layer === main.layer &&
        road.name !== main.road.name &&
        road.lanes.length === 1 &&
        road.roadClass !== 'ramp',
    );
    if (!feeder) continue;
    const heading = roadHeading(main.road, main.road.to === node.id);
    const candidates = roads
      .flatMap((other) => {
        const { road } = other;
        if (
          other.layer !== main.layer ||
          road.name !== main.road.name ||
          road.roadClass !== main.road.roadClass ||
          road.streetGroupId !== null ||
          road.from === node.id ||
          road.to === node.id
        )
          return [];
        return road.centerline.slice(1).flatMap((b, i) => {
          const a = road.centerline[i]!;
          const dx = b.x - a.x,
            dy = b.y - a.y;
          if (Math.cos(Math.atan2(dy, dx) - heading) > -0.9) return [];
          const t = Math.max(
            0,
            Math.min(1, ((node.pos.x - a.x) * dx + (node.pos.y - a.y) * dy) / (dx * dx + dy * dy)),
          );
          const pos = { x: a.x + t * dx, y: a.y + t * dy };
          const gap = distance(pos, node.pos);
          const width = ((main.road.lanes.length + road.lanes.length) * 3.5) / 2 + 12;
          return gap >= 3 && gap <= Math.min(30, width) ? [{ other, pos, i, gap }] : [];
        });
      })
      .sort((a, b) => a.gap - b.gap);
    const best = candidates[0];
    if (!best) continue;
    const { other, pos, i } = best;
    // An existing crossing inside the median already gives the feeder its second connection.
    if (
      incident.some(
        ({ road }) =>
          road.id !== main.road.id &&
          [other.road.from, other.road.to].includes(road.from === node.id ? road.to : road.from),
      )
    )
      continue;
    let target = [other.road.from, other.road.to].find(
      (id) => distance(city.nodes[id]!.pos, pos) < 3,
    );
    if (!target) {
      target = allocateId(city, 'n');
      city.nodes[target] = {
        ...node,
        id: target,
        pos,
        control: 'uncontrolled',
        signal: null,
        turnRules: [],
        minorRoads: [],
        provenance: {
          source: 'osm',
          osmIds: [...other.road.provenance.osmIds!],
          inferred: ['medianJunction'],
        },
      };
      const tail: OsmRoad = {
        ...other,
        cutStart: false,
        road: {
          ...other.road,
          id: allocateId(city, 'r'),
          from: target,
          centerline: [pos, ...other.road.centerline.slice(i + 1)],
        },
      };
      other.road.to = target;
      other.road.centerline = [...other.road.centerline.slice(0, i + 1), pos];
      other.cutEnd = false;
      city.roads[tail.road.id] = tail.road;
      roads.push(tail);
    }
    const group = `osm:median/${node.id}/${target}`;
    for (const [from, to] of [
      [node.id, target],
      [target, node.id],
    ]) {
      const road: Road = {
        ...feeder.road,
        id: allocateId(city, 'r'),
        from: from!,
        to: to!,
        centerline: [city.nodes[from!]!.pos, city.nodes[to!]!.pos],
        streetGroupId: group,
        lateralOffsetM: city.drivingSide === 'right' ? 1.5 : -1.5,
        provenance: {
          source: 'osm',
          osmIds: [...feeder.road.provenance.osmIds!],
          inferred: ['medianCrossing'],
        },
      };
      city.roads[road.id] = road;
      roads.push({ ...feeder, road, cutStart: false, cutEnd: false, turnLanes: undefined });
    }
  }
}

function equalAttributes(a: Road, b: Road): boolean {
  return (
    a.roadClass === b.roadClass &&
    a.name === b.name &&
    a.speedLimitMps === b.speedLimitMps &&
    a.lateralOffsetM === b.lateralOffsetM &&
    JSON.stringify(a.lanes) === JSON.stringify(b.lanes) &&
    (a.streetGroupId === null) === (b.streetGroupId === null)
  );
}

// Remove segmentation artifacts, retaining the original geometry and the downstream arrows.
// Controls and restriction via nodes remain explicit junctions.
export function mergeShortRoads(city: City, roads: OsmRoad[], protectedNodes: Set<string>): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of Object.values(city.nodes)) {
      if (node.control !== 'uncontrolled' || protectedNodes.has(node.id)) continue;
      const incoming = roads.filter(({ road }) => road.to === node.id);
      const outgoing = roads.filter(({ road }) => road.from === node.id);
      const neighbors = new Set([
        ...incoming.map(({ road }) => road.from),
        ...outgoing.map(({ road }) => road.to),
      ]);
      if (neighbors.size !== 2 || incoming.length !== outgoing.length || incoming.length === 0)
        continue;
      if (![...incoming, ...outgoing].some(({ road }) => polylineLength(road.centerline) < 30))
        continue;
      const pairs = incoming.map((a) => ({
        a,
        matches: outgoing.filter(
          (b) =>
            a.road.from !== b.road.to &&
            a.attributes === b.attributes &&
            equalAttributes(a.road, b.road),
        ),
      }));
      if (pairs.some(({ matches }) => matches.length !== 1)) continue;
      for (const { a, matches } of pairs) {
        const b = matches[0]!;
        const group =
          a.road.streetGroupId === null
            ? null
            : [a.road.streetGroupId, b.road.streetGroupId].sort().join('+');
        a.road.to = b.road.to;
        a.road.centerline.push(...b.road.centerline.slice(1));
        a.road.provenance = {
          source: 'osm',
          osmIds: [...new Set([...a.road.provenance.osmIds!, ...b.road.provenance.osmIds!])].sort(
            (a, b) => a - b,
          ),
          inferred: [...new Set([...a.road.provenance.inferred!, ...b.road.provenance.inferred!])],
        };
        a.road.streetGroupId = group;
        a.cutEnd = b.cutEnd;
        a.turnLanes = b.turnLanes;
        a.wayId = b.wayId;
        delete city.roads[b.road.id];
        roads.splice(roads.indexOf(b), 1);
      }
      delete city.nodes[node.id];
      changed = true;
    }
  }
}

export function junctions(ways: OsmWay[], controlled: number[]): Set<number> {
  const junctions = new Set(controlled);
  const seen = new Set<number>();
  for (const { nd } of ways) {
    junctions.add(nd[0]!);
    junctions.add(nd.at(-1)!);
    for (const id of nd) {
      if (seen.has(id)) junctions.add(id);
      seen.add(id);
    }
  }
  return junctions;
}

export function splitWay(ids: number[], junctions: Set<number>): number[][] {
  const parts: number[][] = [];
  let start = 0;
  for (let end = 1; end < ids.length; end++) {
    if (!junctions.has(ids[end]!)) continue;
    if (ids[start] === ids[end]) {
      // Canonical roads cannot be self-loops. Preserve the loop as two connected roads.
      const middle = start + Math.floor((end - start) / 2);
      if (middle > start) parts.push(ids.slice(start, middle + 1), ids.slice(middle, end + 1));
    } else {
      parts.push(ids.slice(start, end + 1));
    }
    start = end;
  }
  return parts;
}
