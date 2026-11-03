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

function defaultPair(
  turn: Turn,
  from: number,
  to: number,
  fromCount: number,
  toCount: number,
  side: DrivingSide,
): boolean {
  if (turn === 'left' || turn === 'right' || turn === 'uturn') {
    const first =
      (turn === 'left' && side === 'right') ||
      (turn === 'right' && side === 'left') ||
      (turn === 'uturn' && side === 'right');
    return first ? from === 0 && to === 0 : from === fromCount - 1 && to === toCount - 1;
  }

  // Count merge/diverge lanes inward from the curb.
  const fan = turn === 'merge' || turn === 'diverge';
  if (fan && side === 'right') {
    from = fromCount - 1 - from;
    to = toCount - 1 - to;
  }
  const extraLaneSource = turn === 'through' && side === 'left' ? 0 : fromCount - 1;
  return to === Math.min(from, toCount - 1) || (from === extraLaneSource && to >= fromCount);
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
  const highestRank = Math.max(
    0,
    ...incoming.map((road) => road.classRank),
    ...outgoing.map((road) => road.classRank),
  );
  const isMinor = (road: CRoad) =>
    (node.control === 'yield' || node.control === 'stop') &&
    (source.minorRoads.length ? source.minorRoads.includes(road.id) : road.classRank < highestRank);
  const approachAngle = (from: CRoad, to: CRoad) =>
    signedAngle(headings[from.idx]!.end, headings[to.idx]!.start);
  const smallAngle = (from: CRoad, to: CRoad) => Math.abs(approachAngle(from, to)) < Math.PI / 6;
  const merge =
    outgoing.length === 1 && incoming.filter((from) => smallAngle(from, outgoing[0]!)).length >= 2;
  const diverge =
    incoming.length === 1 && outgoing.filter((to) => smallAngle(incoming[0]!, to)).length >= 2;
  for (const from of incoming) {
    const majorRank = isMinor(from) ? 0 : from.classRank;
    for (const to of outgoing) {
      const angle = approachAngle(from, to);
      const sameStreet = to.streetGroupId !== null && to.streetGroupId === from.streetGroupId;
      const turn = classify(angle, merge, diverge, sameStreet);
      const rules = source.turnRules.filter((rule) => rule.from === from.id && rule.to === to.id);
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
          if (!a.allowed.some((vehicle) => b.allowed.includes(vehicle))) continue;

          const start = a.polyline.at(-1)!;
          const end = b.polyline[0]!;
          const startHeading = headingAtDistance(a.polyline, a.cumulative, a.lengthM);
          const endHeading = headingAtDistance(b.polyline, b.cumulative, 0);
          const chordHeading = Math.atan2(end.y - start.y, end.x - start.x);
          const straight =
            turn === 'through' &&
            Math.abs(signedAngle(startHeading, chordHeading)) < Math.PI / 36 &&
            Math.abs(signedAngle(chordHeading, endHeading)) < Math.PI / 36 &&
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
                {
                  x: end.x - control * Math.cos(endHeading),
                  y: end.y - control * Math.sin(endHeading),
                },
                end,
              );
          const cumulative = cumulativeLengths(polyline);
          const idx = movements.length;
          movements.push({
            idx,
            id: movementId(a.id, b.id),
            fromLane: fromIdx,
            toLane: toIdx,
            node: node.idx,
            turn,
            polyline,
            cumulative,
            lengthM: cumulative.at(-1)!,
            conflicts: [],
            priority: majorRank * 10 + turnRank[turn],
            neverGreen: false,
          });
          node.movements.push(idx);
          a.out.push(idx);
          b.in.push(idx);
        }
      }
    }
  }
}
