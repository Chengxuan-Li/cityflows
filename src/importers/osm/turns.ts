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

function turn(from: Road, to: Road) {
  const angle = turnAngle(from, to);
  if (
    (from.streetGroupId && from.streetGroupId === to.streetGroupId) ||
    Math.abs(angle) > (5 * Math.PI) / 6
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

export function addLaneTurns(
  node: Node,
  incident: JunctionRoads,
  side: DrivingSide,
  diagnostics: Diagnostic[],
): void {
  const bans = new Set(
    node.turnRules.filter(({ allowed }) => !allowed).map(({ from, to }) => `${from}>${to}`),
  );
  const shallow = (from: Road, to: Road) => Math.abs(turnAngle(from, to)) < Math.PI / 6;
  const merge =
    incident.outgoing.length === 1 &&
    incident.incoming.filter(({ road }) => shallow(road, incident.outgoing[0]!.road)).length >= 2;
  const diverge =
    incident.incoming.length === 1 &&
    incident.outgoing.filter(({ road }) => shallow(incident.incoming[0]!.road, road)).length >= 2;
  const alignFromRight = merge || diverge ? side === 'right' : side === 'left';
  for (const { road: from, turnLanes, wayId, cutEnd } of incident.incoming) {
    if (turnLanes === undefined || cutEnd) continue;
    // Arrows describe the next choice of direction, not intermediate way/tag boundaries.
    const continuations = incident.outgoing.filter(({ road }) => turn(from, road) !== 'reverse');
    if (continuations.length === 1 && turn(from, continuations[0]!.road) === 'through') continue;
    if (
      incident.outgoing.some(
        ({ road, wayId: nextWay }) => nextWay === wayId && turn(from, road) !== 'reverse',
      ) &&
      incident.outgoing.every(({ wayId: nextWay }) => nextWay === wayId)
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
      const basic = turn(from, to);
      if (basic === 'reverse') return basic;
      // OSM splits a curved named street into staggered junctions; its continuation is
      // still the through arrow even when the short section crosses at an oblique angle.
      if (from.name && from.name === to.name && Math.abs(turnAngle(from, to)) < Math.PI / 2)
        return 'through';
      const shallowFork =
        continuations.length > 1 && continuations.every(({ road }) => shallow(from, road));
      if (shallowFork && directions.some((lane) => lane.includes('left') || lane.includes('right')))
        return turnAngle(from, to) < 0 ? 'left' : 'right';
      return basic;
    };
    for (let i = 0; i < directions.length; i++) {
      if (
        directions[i]!.length &&
        !incident.outgoing.some(({ road }) => directions[i]!.includes(direction(road)))
      ) {
        directions[i] = [];
        from.provenance.inferred = [
          ...new Set([...from.provenance.inferred!, 'turnLanesDeferred']),
        ];
      }
    }
    for (const { road: to } of incident.outgoing) {
      // Lane rules have higher specificity in the compiler. A relation's ban must still win.
      if (bans.has(`${from.id}>${to.id}`)) continue;
      const basic = direction(to);
      const rampExit =
        basic === 'through' &&
        to.roadClass === 'ramp' &&
        from.roadClass !== 'ramp' &&
        incident.outgoing.some(
          ({ road }) => road.roadClass !== 'ramp' && turn(from, road) === 'through',
        );
      // A shallow exit is a diverge in the compiler but takes the driver's turn arrow.
      const kind = rampExit ? (turnAngle(from, to) < 0 ? 'left' : 'right') : basic;
      const allowedLanes = directions.flatMap((lane, i) =>
        lane.includes(kind) ||
        (lane.length === 0 &&
          ((kind === 'left' && i === 0) || (kind === 'right' && i === from.lanes.length - 1)))
          ? [i]
          : [],
      );
      for (const [fromLane, lane] of directions.entries()) {
        if (lane.length === 0) continue;
        const rule: TurnRule = {
          from: from.id,
          to: to.id,
          fromLane,
          allowed: lane.includes(kind),
          provenance: { source: 'osm', osmIds: [wayId] },
        };
        if (rule.allowed) {
          if (from.lanes.length === 1 && kind !== 'reverse') {
            node.turnRules.push(rule);
            continue;
          }
          // Keep simultaneous lane movements ordered, using the rightmost target lanes on right turns.
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
