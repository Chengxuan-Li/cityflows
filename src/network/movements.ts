import { cumulativeLengths, distance, headingAtDistance, sampleBezier } from '../geo/polyline';
import { movementId, type DrivingSide, type Node, type TurnRule } from '../schema';
import type { CLane, CMovement, CNode, CRoad, Turn } from './types';

function signedAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function classify(angle: number, merge: boolean, diverge: boolean, sameStreet: boolean): Turn {
  if (sameStreet || Math.abs(angle) > (5 * Math.PI) / 6) return 'uturn';
  if (Math.abs(angle) < Math.PI / 6) return merge ? 'merge' : diverge ? 'diverge' : 'through';
  return angle > 0 ? 'right' : 'left';
}

// Architecture 5.2 step 3. Lane 0 is the leftmost lane under both driving sides; the side only
// decides which end of the lane block is the curb and which the median.
function defaultPair(
  turn: Turn,
  from: number,
  to: number,
  fromCount: number,
  toCount: number,
  side: DrivingSide,
): boolean {
  if (fromCount === 1 && turn !== 'uturn') return true;
  const fromCurb = side === 'right' ? fromCount - 1 - from : from;
  const toCurb = side === 'right' ? toCount - 1 - to : to;
  switch (turn) {
    case 'left':
      return from === 0 && to === 0;
    case 'right':
      return from === fromCount - 1 && to === toCount - 1;
    case 'uturn':
      return side === 'right'
        ? from === 0 && to === 0
        : from === fromCount - 1 && to === toCount - 1;
    case 'merge':
    case 'diverge':
      return fromCurb === toCurb;
    case 'through': {
      const fromMedian = fromCount - 1 - fromCurb;
      const toMedian = toCount - 1 - toCurb;
      return (
        toMedian === Math.min(fromMedian, toCount - 1) || (fromCurb === 0 && toMedian >= fromCount)
      );
    }
  }
}

function bestRule(rules: TurnRule[], from: number, to: number): TurnRule | undefined {
  let best: TurnRule | undefined;
  let specificity = -1;
  for (const rule of rules) {
    if (
      (rule.fromLane !== undefined && rule.fromLane !== from) ||
      (rule.toLane !== undefined && rule.toLane !== to)
    )
      continue;
    const score = Number(rule.fromLane !== undefined) + Number(rule.toLane !== undefined);
    if (score >= specificity) {
      best = rule;
      specificity = score;
    }
  }
  return best;
}

const turnRank: Record<Turn, number> = {
  through: 2,
  right: 2,
  left: 1,
  merge: 1,
  diverge: 1,
  uturn: 0,
};

export function generateMovements(
  node: CNode,
  source: Node,
  incoming: CRoad[],
  outgoing: CRoad[],
  headings: { start: number; end: number }[],
  lanes: CLane[],
  side: DrivingSide,
  movements: CMovement[],
): void {
  const highestRank = Math.max(0, ...incoming.map((road) => road.classRank));
  const isMinor = (road: CRoad) =>
    (node.control === 'yield' || node.control === 'stop') &&
    (source.minorRoads.length ? source.minorRoads.includes(road.id) : road.classRank < highestRank);
  const approachAngle = (from: CRoad, to: CRoad) =>
    signedAngle(headings[from.idx]!.end, headings[to.idx]!.start);
  const smallAngle = (from: CRoad, to: CRoad) => Math.abs(approachAngle(from, to)) < Math.PI / 6;
  const isUturn = (from: CRoad, to: CRoad) =>
    (from.streetGroupId !== null && from.streetGroupId === to.streetGroupId) ||
    Math.abs(approachAngle(from, to)) > (5 * Math.PI) / 6;
  const merge = (from: CRoad, to: CRoad) =>
    outgoing.filter((road) => !isUturn(from, road)).length === 1 &&
    incoming.filter((road) => smallAngle(road, to)).length >= 2;
  const diverge = (from: CRoad, to: CRoad) =>
    incoming.filter((road) => !isUturn(road, to)).length === 1 &&
    outgoing.filter((road) => smallAngle(from, road)).length >= 2;
  const shareClass = (a: CLane, b: CLane) =>
    a.allowed.some((vehicle) => b.allowed.includes(vehicle));

  const add = (a: CLane, b: CLane, turn: Turn, priority: number) => {
    const start = a.polyline.at(-1)!;
    const end = b.polyline[0]!;
    const startHeading = headingAtDistance(a.polyline, a.cumulative, a.lengthM);
    const endHeading = headingAtDistance(b.polyline, b.cumulative, 0);
    const straight =
      turn === 'through' &&
      Math.abs(
        (end.x - start.x) * Math.sin(startHeading) - (end.y - start.y) * Math.cos(startHeading),
      ) <= 0.5 &&
      Math.abs(signedAngle(startHeading, endHeading)) < Math.PI / 36;
    const control = distance(start, end) * 0.4;
    const polyline = straight
      ? [start, end]
      : sampleBezier(
          start,
          {
            x: start.x + control * Math.cos(startHeading),
            y: start.y + control * Math.sin(startHeading),
          },
          { x: end.x - control * Math.cos(endHeading), y: end.y - control * Math.sin(endHeading) },
          end,
        );
    const cumulative = cumulativeLengths(polyline);
    const idx = movements.length;
    movements.push({
      idx,
      id: movementId(a.id, b.id),
      fromLane: a.idx,
      toLane: b.idx,
      node: node.idx,
      turn,
      polyline,
      cumulative,
      lengthM: cumulative.at(-1)!,
      conflicts: [],
      conflictZones: [],
      priority,
      neverGreen: false,
    });
    node.movements.push(idx);
    a.out.push(idx);
    b.in.push(idx);
  };

  for (const from of incoming) {
    const majorRank = isMinor(from) ? 0 : from.classRank;
    const targets = outgoing.map((to) => ({
      to,
      turn: classify(
        approachAngle(from, to),
        merge(from, to),
        diverge(from, to),
        to.streetGroupId !== null && to.streetGroupId === from.streetGroupId,
      ),
      rules: source.turnRules.filter((rule) => rule.from === from.id && rule.to === to.id),
    }));
    for (const { to, turn, rules } of targets) {
      for (const fromIdx of from.lanes) {
        const a = lanes[fromIdx]!;
        for (const toIdx of to.lanes) {
          const b = lanes[toIdx]!;
          const rule = bestRule(rules, a.lane, b.lane);
          if (rule?.allowed === false || (turn === 'uturn' && !rule?.allowed)) continue;
          const explicitLane = rule?.fromLane !== undefined || rule?.toLane !== undefined;
          if (
            !explicitLane &&
            !defaultPair(turn, a.lane, b.lane, from.lanes.length, to.lanes.length, side)
          )
            continue;
          if (!shareClass(a, b)) continue;
          add(a, b, turn, majorRank * 10 + turnRank[turn]);
        }
      }
    }

    // Fallback (5.2 step 3): a lane left without any movement inherits its nearest served
    // lane's turns, so a two-lane road facing a single exit gets a dual turn.
    const served = from.lanes.filter((idx) =>
      lanes[idx]!.out.some((idx) => movements[idx]!.turn !== 'uturn'),
    );
    if (served.length === 0) continue;
    for (const fromIdx of from.lanes) {
      const a = lanes[fromIdx]!;
      if (a.out.length > 0) continue;
      const nearest =
        lanes[
          served.reduce((best, idx) =>
            Math.abs(lanes[idx]!.lane - a.lane) < Math.abs(lanes[best]!.lane - a.lane) ? idx : best,
          )
        ]!;
      for (const template of nearest.out.map((idx) => movements[idx]!)) {
        if (template.turn === 'uturn') continue;
        const target = targets.find(({ to }) => to.idx === lanes[template.toLane]!.road)!;
        const shifted = Math.min(
          target.to.lanes.length - 1,
          Math.max(0, lanes[template.toLane]!.lane + a.lane - nearest.lane),
        );
        const b = lanes[target.to.lanes[shifted]!]!;
        if (bestRule(target.rules, a.lane, b.lane)?.allowed === false || !shareClass(a, b))
          continue;
        if (!a.out.some((idx) => movements[idx]!.toLane === b.idx))
          add(a, b, template.turn, template.priority);
      }
    }
  }
}
