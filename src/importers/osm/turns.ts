import type { Diagnostic } from '../../network';
import type { DrivingSide, Node, Road, TurnRule } from '../../schema';
import type { OsmData } from './parse';
import type { OsmRoad } from './roads';

export function roadHeading(road: Road, end: boolean): number {
  const points = road.centerline;
  const a = points[end ? points.length - 2 : 0]!;
  const b = points[end ? points.length - 1 : 1]!;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function turnAngle(from: Road, to: Road): number {
  const difference = roadHeading(to, false) - roadHeading(from, true);
  return Math.atan2(Math.sin(difference), Math.cos(difference));
}

function turn(from: Road, to: Road, angle = turnAngle(from, to)) {
  if (
    (from.streetGroupId && from.streetGroupId === to.streetGroupId) ||
    Math.abs(angle) > (5 * Math.PI) / 6 ||
    // TASK-131: the two one-way carriageways of a street where they meet at a node (Marsstraße at
    // n:366), which the merge made one coincident pair.
    (from.name !== null &&
      from.name === to.name &&
      from.streetGroupId === null &&
      to.streetGroupId === null &&
      Math.abs(angle) > Math.PI / 2)
  )
    return 'reverse';
  if (Math.abs(angle) < Math.PI / 6) return 'through';
  return angle > 0 ? 'right' : 'left';
}

export interface JunctionRoads {
  incoming: OsmRoad[];
  outgoing: OsmRoad[];
}

export function addLocalTurnarounds(node: Node, incident: JunctionRoads): void {
  if (node.turnRules.length || incident.incoming.length !== 1 || incident.outgoing.length !== 1)
    return;
  const from = incident.incoming[0]!,
    to = incident.outgoing[0]!;
  if (!['residential', 'service'].includes(from.road.roadClass)) return;
  if (!from.road.streetGroupId || from.road.streetGroupId !== to.road.streetGroupId) return;
  node.turnRules.push({
    from: from.road.id,
    to: to.road.id,
    allowed: true,
    provenance: {
      source: 'osm',
      inferred: [from.cutEnd || to.cutStart ? 'boundaryTurnaround' : 'localTurnaround'],
    },
  });
}

export function addRestrictions(
  relations: OsmData['relation'],
  nodes: Map<string, Node>,
  roads: Map<string, JunctionRoads>,
  diagnostics: Diagnostic[],
): void {
  for (const { id, member, tag } of relations) {
    if (tag.type !== 'restriction') continue;
    const restriction = tag.restriction;
    const via = member.filter(({ role }) => role === 'via');
    const fromWays = member.filter(({ role, type }) => role === 'from' && type === 'way');
    const toWays = member.filter(({ role, type }) => role === 'to' && type === 'way');
    const only = restriction?.startsWith('only_');
    const uturn = restriction?.endsWith('_u_turn');
    if (
      (!only && !restriction?.startsWith('no_')) ||
      via.length !== 1 ||
      via[0]!.type !== 'node' ||
      !fromWays.length ||
      !toWays.length ||
      tag.except !== undefined ||
      tag['restriction:conditional'] !== undefined
    ) {
      diagnostics.push({
        severity: 'warning',
        code: 'osm_unsupported_tag',
        refs: [`relation/${id}`],
        message: `Unsupported restriction on OSM relation ${id}; expected an unconditional from/via-node/to rule`,
      });
      continue;
    }
    const node = nodes.get(String(via[0]!.ref));
    const incident = node && roads.get(node.id)!;
    const approaches = incident
      ? incident.incoming.filter(({ road }) =>
          fromWays.some(({ ref }) => road.provenance.osmIds?.includes(ref)),
        )
      : [];
    if (!node || !incident || !approaches.length) {
      diagnostics.push({
        severity: 'warning',
        code: 'osm_unsupported_tag',
        refs: [`relation/${id}`],
        message: node
          ? `Restriction on OSM relation ${id} ignored: its from way does not enter the via node`
          : `Restriction on OSM relation ${id} ignored: its via node is outside the imported roads`,
      });
      continue;
    }
    for (const from of approaches) {
      for (const to of incident.outgoing) {
        const listed =
          toWays.some(({ ref }) => to.road.provenance.osmIds?.includes(ref)) &&
          (from.wayId !== to.wayId || (turn(from.road, to.road) === 'reverse') === uturn);
        if (only && listed && uturn) {
          // The compiler needs an explicit allow for a U-turn. Keep any prohibitions last.
          node.turnRules.unshift({
            from: from.road.id,
            to: to.road.id,
            allowed: true,
            provenance: { source: 'osm', osmIds: [id] },
          });
        } else if (only ? !listed : listed) {
          node.turnRules.push({
            from: from.road.id,
            to: to.road.id,
            allowed: false,
            provenance: { source: 'osm', osmIds: [id] },
          });
        }
      }
    }
  }
}

const indication: Record<string, string> = {
  left: 'left',
  slight_left: 'left',
  sharp_left: 'left',
  right: 'right',
  slight_right: 'right',
  sharp_right: 'right',
  through: 'through',
  merge_to_left: 'through',
  merge_to_right: 'through',
  reverse: 'reverse',
};

/**
 * TASK-131: at a junction group's member, `group` gives the group's exits along each road
 * (`groupExits`) and the angles of the node the merge used to make (`groupAngle`). An entry's
 * arrows are classified against those exits, and the lanes they allow enter the inner road.
 */
export function addLaneTurns(
  node: Node,
  incident: JunctionRoads,
  side: DrivingSide,
  diagnostics: Diagnostic[],
  group?: {
    entry: (road: Road) => boolean;
    exitsVia: (road: Road) => Road[];
    angle: (from: Road, to: Road) => number;
  },
): void {
  const bans = new Set(
    node.turnRules.filter(({ allowed }) => !allowed).map(({ from, to }) => `${from}>${to}`),
  );
  for (const { road: from, turnLanes, wayId, cutEnd } of incident.incoming) {
    if (turnLanes === undefined || cutEnd) continue;
    const entry = group !== undefined && group.entry(from);
    const angleOf = (a: Road, b: Road) => (entry ? group!.angle(a, b) : turnAngle(a, b));
    const turnOf = (a: Road, b: Road) => turn(a, b, angleOf(a, b));
    const shallow = (a: Road, b: Road) => Math.abs(angleOf(a, b)) < Math.PI / 6;
    const targets = incident.outgoing.flatMap(({ road }) =>
      (entry ? group.exitsVia(road) : [road]).map((exit) => ({ first: road, exit })),
    );
    const exits = targets.map(({ exit }) => exit);
    const merge =
      exits.length === 1 &&
      incident.incoming.filter(({ road }) => shallow(road, exits[0]!)).length >= 2;
    const diverge =
      incident.incoming.length === 1 && exits.filter((road) => shallow(from, road)).length >= 2;
    const alignFromRight = merge || diverge ? side === 'right' : side === 'left';
    // Arrows describe the next choice of direction, not intermediate way/tag boundaries.
    const continuations = exits.filter((road) => turnOf(from, road) !== 'reverse');
    if (continuations.length === 1 && turnOf(from, continuations[0]!) === 'through') continue;
    const sameWay = (road: Road) => road.provenance.osmIds?.[0] === wayId;
    if (
      exits.some((road) => sameWay(road) && turnOf(from, road) !== 'reverse') &&
      exits.every(sameWay)
    )
      continue;
    const markings = turnLanes
      .split('|')
      .map((lane) => lane.split(';').map((value) => value.trim()));
    if (
      markings.length !== from.lanes.length ||
      markings.some((lane) =>
        lane.some((value) => value !== '' && value !== 'none' && !Object.hasOwn(indication, value)),
      )
    ) {
      diagnostics.push({
        severity: 'warning',
        code: 'osm_unsupported_tag',
        refs: [from.id],
        message: `Invalid turn:lanes markings on OSM way ${wayId}: ${turnLanes}`,
      });
      continue;
    }
    const directions = markings.map((lane) =>
      lane.map((value) => indication[value]).filter(Boolean),
    );
    const direction = (to: Road) => {
      const basic = turnOf(from, to);
      if (basic === 'reverse') return basic;
      // OSM splits a curved named street into staggered junctions; its continuation is
      // still the through arrow even when the short section crosses at an oblique angle.
      if (from.name && from.name === to.name && Math.abs(angleOf(from, to)) < Math.PI / 2)
        return 'through';
      const shallowFork =
        continuations.length > 1 && continuations.every((road) => shallow(from, road));
      if (shallowFork && directions.some((lane) => lane.includes('left') || lane.includes('right')))
        return angleOf(from, to) < 0 ? 'left' : 'right';
      return basic;
    };
    for (let i = 0; i < directions.length; i++) {
      if (
        directions[i]!.length &&
        !exits.some((road) => directions[i]!.includes(direction(road)))
      ) {
        directions[i] = [];
        from.provenance.inferred = [
          ...new Set([...from.provenance.inferred!, 'turnLanesDeferred']),
        ];
      }
    }
    const kindOf = (to: Road) => {
      const basic = direction(to);
      const rampExit =
        basic === 'through' &&
        to.roadClass === 'ramp' &&
        from.roadClass !== 'ramp' &&
        exits.some((road) => road.roadClass !== 'ramp' && turnOf(from, road) === 'through');
      // A shallow exit is a diverge in the compiler but takes the driver's turn arrow.
      return rampExit ? (angleOf(from, to) < 0 ? 'left' : 'right') : basic;
    };
    for (const { road: to } of incident.outgoing) {
      // Lane rules have higher specificity in the compiler. A relation's ban must still win.
      if (bans.has(`${from.id}>${to.id}`)) continue;
      const kinds = new Set<string>(
        targets.filter(({ first }) => first === to).map(({ exit }) => kindOf(exit)),
      );
      const kind = kinds.size === 1 ? [...kinds][0]! : undefined;
      const allowedLanes = directions.flatMap((lane, i) =>
        lane.some((value) => kinds.has(value!)) ||
        (lane.length === 0 &&
          ((kinds.has('left') && i === 0) || (kinds.has('right') && i === from.lanes.length - 1)))
          ? [i]
          : [],
      );
      for (const [fromLane, lane] of directions.entries()) {
        if (lane.length === 0) continue;
        const rule: TurnRule = {
          from: from.id,
          to: to.id,
          fromLane,
          allowed: lane.some((value) => kinds.has(value!)),
          provenance: { source: 'osm', osmIds: [wayId] },
        };
        if (rule.allowed) {
          if (from.lanes.length === 1 && kind !== 'reverse') {
            node.turnRules.push(rule);
            continue;
          }
          // Keep simultaneous lane movements ordered, using the rightmost target lanes on right
          // turns. An inner road toward several exits takes its lanes in order, from the left.
          const start = kind === 'right' ? Math.max(0, to.lanes.length - allowedLanes.length) : 0;
          const throughLanes = directions.flatMap((marks, index) =>
            marks.length === 0 || marks.includes('through') ? [index] : [],
          );
          const throughIndex = throughLanes.indexOf(fromLane);
          const aligned = alignFromRight
            ? to.lanes.length - throughLanes.length + throughIndex
            : throughIndex;
          const target = kind === 'through' ? aligned : start + allowedLanes.indexOf(fromLane);
          const toLane = Math.max(0, Math.min(to.lanes.length - 1, target));
          for (let i = 0; i < to.lanes.length; i++) {
            node.turnRules.push({ ...rule, toLane: i, allowed: i === toLane });
          }
        } else node.turnRules.push(rule);
      }
    }
  }
}
