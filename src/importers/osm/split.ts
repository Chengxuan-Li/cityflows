import { distance, polylineLength } from '../../geo/polyline';
import { allocateId, type City, type Road } from '../../schema';
import { vehicleClasses } from '../../schema';
import type { OsmWay } from './parse';
import { captureControls, relocateControls } from './controls';
import { finalCorridor } from './corridors';
import type { OsmRoad } from './roads';
import { roadHeading } from './turns';

/** `ImportOptions.junctionGroupMaxM`'s default (owner, TASK-131). */
export const DEFAULT_JUNCTION_GROUP_MAX_M = 30;
/** A short link joins two junctions when it is at most this many times as long as the widest
 * road block at its ends (owner, checkpoint 1: length against width, not length alone). */
export const JUNCTION_GROUP_RATIO = 1.5;
/** Two signalised median crossings of one carriageway pair form one junction (`n:247`,
 * `n:638`) when the carriageway links between them are at most this long (lead, checkpoint 1). */
export const JUNCTION_COMPLEX_M = 60;
/** Case-by-case overrides (owner, checkpoint 1), by OSM node id: pairs to keep apart. */
const KEEP_APART: [number, number, string][] = [];

export interface PendingGroup {
  nodes: string[];
  innerRoads: string[];
}

/**
 * TASK-131: the controls before grouping. Controls on non-junction nodes move to the nearest
 * junction as before, and the degree-2 artefacts they leave (a signal's stop position before its
 * junction) join their roads, so no group chains through a node that is then merged away
 * (owner, checkpoint 1). Returns the nodes that carry a signal and the original control nodes.
 */
export function prepareJunctions(
  city: City,
  roads: OsmRoad[],
  signals: string[],
): { signalIds: string[]; sources: Set<string> } {
  const captured = captureControls(
    city,
    roads.map(({ road }) => road),
    signals,
  );
  const signalIds = relocateControls(city, captured, new Map());
  mergeShortRoads(
    city,
    roads,
    new Set([
      ...signalIds,
      ...Object.values(city.nodes)
        .filter((n) => n.turnRules.length)
        .map((n) => n.id),
    ]),
    new Set(captured.sources.map(({ id }) => id)),
  );
  return { signalIds, sources: new Set(captured.sources.map(({ id }) => id)) };
}

/**
 * TASK-131: the junction groups, which replace TASK-049's merge: every node keeps its position,
 * the roads between members stay as inner roads and the members keep their turn rules. Three
 * kinds of link join two junctions (owner, checkpoint 1), in this order:
 * (a) a median crossing: a link of at most `maxM` between the two carriageways of one paired
 *     corridor (`Road.corridorId`, so corridors are assigned first);
 * (b) a junction complex: two signalised median-crossing groups joined by opposite one-way
 *     carriageway links of at most `JUNCTION_COMPLEX_M` with no junction between, so no traffic
 *     light stands between them (the span cap and the long-inner-road rule do not apply to
 *     these links; unsignalised pairs stay apart);
 * (c) any other link of at most `maxM` that is short against the roads it joins: at most
 *     `JUNCTION_GROUP_RATIO` times the widest road block at its ends.
 * The cluster rules stay for (a) and (c): no group across a stop or yield node, a motorway, a
 * bridge, a roundabout ring or an access change on the inner road; a group spans at most 60 m;
 * another road longer than `maxM` between members splits it. Restriction via nodes may join,
 * their restrictions staying at the member. A group needs an entry, an exit and three street
 * arms: a dead end or a stretch of one road is not a junction.
 */
export function formJunctionGroups(
  city: City,
  roads: OsmRoad[],
  maxM: number,
  sources: Set<string>,
  signals: Set<string>,
): PendingGroup[] {
  const parent = new Map(Object.keys(city.nodes).map((id) => [id, id]));
  const members = new Map(Object.keys(city.nodes).map((id) => [id, [id]]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));
  const length = new Map(roads.map(({ road }) => [road.id, polylineLength(road.centerline)]));
  const incident = new Map<string, OsmRoad[]>();
  for (const source of roads)
    for (const id of [source.road.from, source.road.to])
      incident.set(id, [...(incident.get(id) ?? []), source]);
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
        const here = incident.get(node.id) ?? [];
        if (here.some(({ road }) => road.roadClass === 'motorway')) return true;
        const neighbors = new Set(
          here.map(({ road }) => (road.from === node.id ? road.to : road.from)),
        );
        if (neighbors.size !== 2) return false;
        if (sources.has(node.id) && new Set(here.map((r) => r.attributes)).size > 1) return true;
        return (
          new Set(
            here.map((r) =>
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
  const eligible = ({ road, attributes }: OsmRoad) =>
    !boundaries.has(road.from) &&
    !boundaries.has(road.to) &&
    road.roadClass !== 'motorway' &&
    // Bridges keep their own junctions; roundabout rings are short arcs by design (TASK-049).
    !(JSON.parse(attributes) as string[][]).some(
      ([key, value]) =>
        (key === 'bridge' && value !== 'no') || (key === 'junction' && value === 'roundabout'),
    );
  const corridor = (road: Road) => {
    const id = finalCorridor(road);
    return id?.startsWith('corridor:') ? id.replace(/\/\d+$/, '') : null;
  };
  const corridorsAt = (node: string, except: Road) =>
    new Set(
      (incident.get(node) ?? [])
        .filter(({ road }) => road !== except && road.streetGroupId === null)
        .map(({ road }) => corridor(road))
        .filter((c) => c !== null),
    );
  // Between the two carriageways of one paired corridor.
  const crossing = ({ road }: OsmRoad) => {
    if (length.get(road.id)! > maxM) return false;
    const at = corridorsAt(road.from, road);
    return [...corridorsAt(road.to, road)].some((c) => at.has(c) && c !== corridor(road));
  };
  // The widest road block (all directed roads of one street end) at `node`, but the link's.
  const width = (node: string, link: Road) => {
    const arms = new Map<string, number>();
    for (const { road } of incident.get(node) ?? []) {
      const other = road.from === node ? road.to : road.from;
      if (other === (link.from === node ? link.to : link.from)) continue;
      const key = road.streetGroupId === null ? road.id : `${road.streetGroupId}:${other}`;
      arms.set(key, (arms.get(key) ?? 0) + road.lanes.reduce((w, lane) => w + lane.widthM, 0));
    }
    return Math.max(0, ...arms.values());
  };
  const short = ({ road }: OsmRoad) =>
    length.get(road.id)! <= maxM &&
    length.get(road.id)! <=
      JUNCTION_GROUP_RATIO * Math.max(width(road.from, road), width(road.to, road));
  const osm = (id: string) => city.nodes[id]!.provenance.osmIds![0]!;
  const apart = ({ road }: OsmRoad) =>
    KEEP_APART.some(
      ([a, b]) =>
        (osm(road.from) === a && osm(road.to) === b) ||
        (osm(road.from) === b && osm(road.to) === a),
    );
  const complexLinks = new Set<string>();
  const unite = ({ road }: OsmRoad, capped: boolean) => {
    const a = root(road.from),
      b = root(road.to);
    if (a === b) return;
    const union = [...members.get(a)!, ...members.get(b)!];
    if (
      capped &&
      union.some((x) => union.some((y) => distance(city.nodes[x]!.pos, city.nodes[y]!.pos) > 60))
    )
      return;
    const set = new Set(union);
    const outside = new Set(
      roads
        .filter(({ road }) => set.has(road.from) !== set.has(road.to))
        .map(({ road }) => permissions(road)),
    );
    if (
      roads.some(
        ({ road: other }) =>
          set.has(other.from) &&
          set.has(other.to) &&
          ((capped && !complexLinks.has(other.id) && length.get(other.id)! > maxM) ||
            (vehicleClasses.some(
              (kind) =>
                (other.access?.[kind] ?? other.access?.all ?? 'yes') !== 'yes' ||
                other.lanes.some((lane) => !lane.allowed.includes(kind)),
            ) &&
              [...outside].some((permission) => permission !== permissions(other)))),
      )
    )
      return;
    parent.set(b, a);
    members.set(a, union);
    members.delete(b);
  };
  const byLength = (list: OsmRoad[]) =>
    [...list].sort((x, y) => length.get(x.road.id)! - length.get(y.road.id)!);
  const candidates = roads.filter((r) => eligible(r) && !apart(r));
  // (a) Median crossings.
  const crossings = byLength(candidates.filter(crossing));
  for (const link of crossings) unite(link, true);
  const crossingRoots = () => new Set(crossings.map(({ road }) => root(road.from)));
  // (b) Two crossing groups joined by opposite one-way carriageway links.
  const signalised = (root: string) => members.get(root)!.some((id) => signals.has(id));
  const groupsOfCrossings = new Set([...crossingRoots()].filter(signalised));
  for (const link of byLength(candidates)) {
    const { road } = link;
    if (road.streetGroupId !== null || length.get(road.id)! > JUNCTION_COMPLEX_M) continue;
    const a = root(road.from),
      b = root(road.to);
    if (a === b || !groupsOfCrossings.has(a) || !groupsOfCrossings.has(b)) continue;
    const back = candidates.find(
      ({ road: other }) =>
        other.streetGroupId === null &&
        other.name === road.name &&
        length.get(other.id)! <= JUNCTION_COMPLEX_M &&
        root(other.from) === b &&
        root(other.to) === a,
    );
    if (!back) continue;
    complexLinks.add(road.id);
    complexLinks.add(back.road.id);
    unite(link, false);
  }
  // (c) Other links short against the roads they join.
  for (const link of byLength(candidates.filter((r) => !crossing(r) && short(r))))
    unite(link, true);
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
  return [...members.values()].filter(junction).map((nodes) => {
    const set = new Set(nodes);
    return {
      nodes: [...nodes].sort(),
      innerRoads: roads
        .filter(({ road }) => set.has(road.from) && set.has(road.to))
        .map(({ road }) => road.id)
        .sort(),
    };
  });
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
