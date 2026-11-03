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
    if (!node) continue;
    const incident = roads.get(node.id)!;
    for (const from of incident.incoming.filter(({ wayId }) =>
      fromWays.some(({ ref }) => ref === wayId),
    )) {
      for (const to of incident.outgoing) {
        const listed =
          toWays.some(({ ref }) => ref === to.wayId) &&
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
    for (const { road: to } of incident.outgoing) {
      // Lane rules have higher specificity in the compiler. A relation's ban must still win.
      if (bans.has(`${from.id}>${to.id}`)) continue;
      const basic = turn(from, to);
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
          // Keep simultaneous lane movements ordered, using the rightmost target lanes on right turns.
          const start = kind === 'right' ? Math.max(0, to.lanes.length - allowedLanes.length) : 0;
          const aligned = alignFromRight
            ? to.lanes.length - from.lanes.length + fromLane
            : fromLane;
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
