import { distance, polylineLength } from '../../geo/polyline';
import { allocateId, type City, type Road } from '../../schema';
import { vehicleClasses } from '../../schema';
import type { OsmWay } from './parse';
import { captureControls, relocateControls } from './controls';
import type { OsmRoad } from './roads';
import { roadHeading } from './turns';

/** Roads that cross a dual carriageway between its two carriageways: their two ends each meet a
 * one-way road of one name (not their own), and those run within 30 degrees of opposite. */
function carriagewayLinks(roads: OsmRoad[]): Set<string> {
  const oneWay = new Map<string, Road[]>();
  for (const { road } of roads)
    if (road.streetGroupId === null && road.name)
      for (const id of [road.from, road.to]) oneWay.set(id, [...(oneWay.get(id) ?? []), road]);
  // Travel direction of `road` where it meets `node`.
  const heading = (road: Road, node: string) => roadHeading(road, road.to === node);
  const links = new Set<string>();
  for (const { road } of roads)
    for (const a of oneWay.get(road.from) ?? [])
      for (const b of oneWay.get(road.to) ?? [])
        if (
          a.name === b.name &&
          a.name !== road.name &&
          a !== road &&
          b !== road &&
          Math.cos(heading(a, road.from) - heading(b, road.to)) < -Math.cos(Math.PI / 6)
        )
          links.add(road.id);
  return links;
}

/** `ImportOptions.junctionGroupMaxM`'s default (owner, TASK-131). */
export const DEFAULT_JUNCTION_GROUP_MAX_M = 30;

export interface PendingGroup {
  nodes: string[];
  innerRoads: string[];
}

/**
 * TASK-131: the junction groups (nodes joined by roads of at most `maxM`), which replace the
 * merge of TASK-049's consolidation: every node keeps its position, the roads between members
 * stay as inner roads, and the members keep their turn rules, so the lane paths through a group
 * are those the merged node's rules allowed. The cluster rules stay: no group across a
 * controlled node, a motorway, a restriction via node, a bridge, a roundabout ring or an access
 * change on the inner road; a group spans at most 60 m; a road longer than `maxM` with both ends
 * in a candidate group splits it. Groups need an entry, an exit and three street arms: a dead
 * end or a stretch of one road is not a junction and forms none. Controls on non-junction nodes move to the nearest junction as before; the
 * returned signal ids are the nodes that carry a signal.
 */
export function formJunctionGroups(
  city: City,
  roads: OsmRoad[],
  signals: string[],
  maxM: number,
  order: 'shortest' | 'pairs-first' | 'merge-first' = 'shortest',
  viaNodes = false,
): { signalIds: string[]; groups: PendingGroup[] } {
  const capturedControls = captureControls(
    city,
    roads.map(({ road }) => road),
    signals,
  );
  // Controls removed from non-junction nodes leave degree-2 artefacts (a signal's stop position
  // before its junction): merged as before, with the members kept until the groups are known.
  const relocateAndMerge = () => {
    const ids = relocateControls(city, capturedControls, new Map());
    mergeShortRoads(
      city,
      roads,
      new Set([
        ...ids,
        ...Object.values(city.nodes)
          .filter((n) => n.turnRules.length)
          .map((n) => n.id),
      ]),
      new Set(capturedControls.sources.map(({ id }) => id)),
    );
    return ids;
  };
  // 'merge-first' (proposal, owner to decide): the artefacts join before the grouping, so no
  // group chains through a node that is then merged away.
  const merged = order === 'merge-first' ? relocateAndMerge() : undefined;
  const parent = new Map(Object.keys(city.nodes).map((id) => [id, id]));
  const members = new Map(Object.keys(city.nodes).map((id) => [id, [id]]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));
  const permissions = (road: Road) =>
    JSON.stringify(
      vehicleClasses.map((kind) => [
        road.access?.[kind] ?? road.access?.all ?? 'yes',
        road.lanes.some((lane) => !lane.allowed.includes(kind))
          ? road.lanes.map((lane) => lane.allowed.includes(kind))
          : null,
      ]),
    );
  const boundaries = new Set(
    Object.values(city.nodes)
      .filter((node) => {
        if (node.control !== 'uncontrolled') return true;
        const incident = roads.filter(({ road }) => road.from === node.id || road.to === node.id);
        if (incident.some(({ road }) => road.roadClass === 'motorway')) return true;
        const neighbors = new Set(
          incident.map(({ road }) => (road.from === node.id ? road.to : road.from)),
        );
        if (neighbors.size !== 2) return false;
        if (
          capturedControls.sources.some((s) => s.id === node.id) &&
          new Set(incident.map((r) => r.attributes)).size > 1
        )
          return true;
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
      .filter((n) => n.turnRules.some((r) => r.provenance.osmIds?.length))
      .map((n) => n.id),
  );
  // 'pairs-first' (proposal, owner to decide): a cross road's link between the two carriageways
  // of one street unites before any other link, so the span cap cannot leave the pair apart.
  const pairs = order === 'pairs-first' ? carriagewayLinks(roads) : new Set<string>();
  for (const { road, attributes } of [...roads].sort(
    (a, b) =>
      Number(pairs.has(b.road.id)) - Number(pairs.has(a.road.id)) ||
      polylineLength(a.road.centerline) - polylineLength(b.road.centerline),
  )) {
    if (boundaries.has(road.from) || boundaries.has(road.to)) continue;
    // Bridges keep their own junctions; roundabout rings are short arcs by design (TASK-049).
    if (
      (JSON.parse(attributes) as string[][]).some(
        ([key, value]) =>
          (key === 'bridge' && value !== 'no') || (key === 'junction' && value === 'roundabout'),
      )
    )
      continue;
    // `viaNodes` (proposal, owner to decide): a restriction's via node may join a group, its
    // restriction staying at that member, as it would not survive a merge.
    if (
      (!viaNodes && (restrictedNodes.has(road.from) || restrictedNodes.has(road.to))) ||
      road.roadClass === 'motorway'
    )
      continue;
    if (polylineLength(road.centerline) > maxM) continue;
    const a = root(road.from),
      b = root(road.to);
    if (a === b) continue;
    const union = [...members.get(a)!, ...members.get(b)!];
    if (union.some((x) => union.some((y) => distance(city.nodes[x]!.pos, city.nodes[y]!.pos) > 60)))
      continue;
    const outside = new Set(
      roads
        .filter(({ road }) => union.includes(road.from) !== union.includes(road.to))
        .map(({ road }) => permissions(road)),
    );
    if (
      roads.some(
        ({ road }) =>
          union.includes(road.from) &&
          union.includes(road.to) &&
          (polylineLength(road.centerline) > maxM ||
            (vehicleClasses.some(
              (kind) =>
                (road.access?.[kind] ?? road.access?.all ?? 'yes') !== 'yes' ||
                road.lanes.some((lane) => !lane.allowed.includes(kind)),
            ) &&
              [...outside].some((permission) => permission !== permissions(road)))),
      )
    )
      continue;
    parent.set(b, a);
    members.set(a, union);
    members.delete(b);
  }
  const junction = (group: string[]) => {
    if (group.length === 1) return false;
    const nodes = new Set(group);
    const arms = roads.filter(({ road }) => nodes.has(road.from) !== nodes.has(road.to));
    if (
      !arms.some(({ road }) => nodes.has(road.to)) ||
      !arms.some(({ road }) => nodes.has(road.from))
    )
      return false;
    // Three street arms at least: the arms of one street within 35 degrees are one.
    const streets: { street: string; heading: number }[] = [];
    for (const { road, wayId } of arms) {
      const start = nodes.has(road.from);
      const street = road.name ?? `way/${wayId}`;
      const heading = roadHeading(road, !start) + (start ? 0 : Math.PI);
      if (
        !streets.some(
          (s) =>
            s.street === street &&
            Math.abs(Math.atan2(Math.sin(s.heading - heading), Math.cos(s.heading - heading))) <
              (35 * Math.PI) / 180,
        )
      )
        streets.push({ street, heading });
    }
    return streets.length >= 3;
  };
  const candidates = [...members.values()].filter(junction);
  const signalIds = merged ?? relocateAndMerge();
  // A member merged away joins two links into one road, which may now be longer than `maxM`:
  // the members it does not join stay together only through shorter roads.
  const survivors = candidates.flatMap((group) => {
    const nodes = group.filter((id) => city.nodes[id]);
    const link = new Map(nodes.map((id) => [id, id]));
    const find = (id: string): string => (link.get(id) === id ? id : find(link.get(id)!));
    for (const { road } of roads)
      if (link.has(road.from) && link.has(road.to) && polylineLength(road.centerline) <= maxM)
        link.set(find(road.from), find(road.to));
    const parts = new Map<string, string[]>();
    for (const id of nodes) parts.set(find(id), [...(parts.get(find(id)) ?? []), id]);
    return [...parts.values()].filter(junction);
  });
  const groups = survivors.map((nodes) => {
    const set = new Set(nodes);
    return {
      nodes: [...nodes].sort(),
      innerRoads: roads
        .filter(({ road }) => set.has(road.from) && set.has(road.to))
        .map(({ road }) => road.id)
        .sort(),
    };
  });
  return { signalIds, groups };
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
export function mergeShortRoads(
  city: City,
  roads: OsmRoad[],
  protectedNodes: Set<string>,
  removedControls = new Set<string>(),
): void {
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
      if (
        !removedControls.has(node.id) &&
        ![...incoming, ...outgoing].some(({ road }) => polylineLength(road.centerline) < 30)
      )
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
        for (const endpoint of [city.nodes[a.road.from]!, city.nodes[a.road.to]!]) {
          for (const rule of endpoint.turnRules) {
            if (rule.from === b.road.id) rule.from = a.road.id;
            if (rule.to === b.road.id) rule.to = a.road.id;
          }
          endpoint.minorRoads = endpoint.minorRoads.map((id) =>
            id === b.road.id ? a.road.id : id,
          );
        }
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
