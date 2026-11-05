import type { Node, Road } from '../schema';
import type { CLane, CMovement, CNode, CRoad } from './types';
import { roadWidth, type RoadContinuity } from './lanes';

export type ContinuationPairs = Map<string, Set<string>>;
export const roadPair = (from: CRoad, to: CRoad) => `${from.id}>${to.id}`;

function laneOffset(road: Road, lane: number): number {
  return (
    road.lateralOffsetM -
    roadWidth(road) / 2 +
    road.lanes.slice(0, lane).reduce((sum, l) => sum + l.widthM, 0) +
    road.lanes[lane]!.widthM / 2
  );
}

/** Movement topology determines eligibility; road geometry orders physical branch slices. */
export function continuationLayout(
  nodes: CNode[],
  roads: CRoad[],
  lanes: CLane[],
  movements: CMovement[],
  sources: Road[],
  headings: { start: number; end: number }[],
  side: 'left' | 'right',
  sourceNodes: Node[],
) {
  const ends: RoadContinuity[] = roads.map(() => ({}));
  const pairs = new Map<number, ContinuationPairs>();
  for (const node of nodes) {
    const legal = node.movements.map((i) => movements[i]!);
    if (
      node.control !== 'uncontrolled' ||
      !legal.length ||
      legal.some((m) => !['through', 'merge', 'diverge'].includes(m.turn))
    )
      continue;
    const incident = roads.filter((r) => r.from === node.idx || r.to === node.idx);
    const remaining = new Set(incident.map((r) => r.idx));
    const components: CRoad[][] = [];
    while (remaining.size) {
      const group = new Set([remaining.values().next().value!]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const m of legal) {
          const a = lanes[m.fromLane]!.road,
            b = lanes[m.toLane]!.road;
          if (group.has(a) === group.has(b)) continue;
          group.add(a);
          group.add(b);
          changed = true;
        }
      }
      components.push([...group].map((i) => roads[i]!));
      for (const i of group) remaining.delete(i);
    }
    const layout = new Map<number, RoadContinuity>();
    const selected: ContinuationPairs = new Map();
    let valid = true;
    let axis: number | undefined;
    for (const group of components) {
      const incoming = group.filter((r) => r.to === node.idx);
      const outgoing = group.filter((r) => r.from === node.idx);
      if (!incoming.length || !outgoing.length || (incoming.length > 1 && outgoing.length > 1)) {
        valid = false;
        break;
      }
      const split =
        incoming.length === 1 &&
        (outgoing.length > 1 || incoming[0]!.lanes.length >= outgoing[0]!.lanes.length);
      const trunk = (split ? incoming : outgoing)[0]!;
      const trunkHeading = headings[trunk.idx]![split ? 'end' : 'start'];
      axis ??= trunkHeading;
      const heading = axis + (Math.cos(trunkHeading - axis) < 0 ? Math.PI : 0);
      if (
        group.some(
          (r) =>
            Math.abs(Math.cos(headings[r.idx]![r.to === node.idx ? 'end' : 'start'] - axis!)) <
            Math.cos(Math.PI / 6) - 1e-9,
        )
      ) {
        valid = false;
        break;
      }
      const branches = [...(split ? outgoing : incoming)].sort((a, b) => {
        const angle = (r: CRoad) =>
          (split ? 1 : -1) * Math.sin(headings[r.idx]![split ? 'start' : 'end'] - heading);
        return angle(a) - angle(b) || a.idx - b.idx;
      });
      const balanced = branches.reduce((sum, r) => sum + r.lanes.length, 0) === trunk.lanes.length;
      // A merge that must absorb lanes (an on-ramp joining without a lane of its own) keeps its
      // junction: a zero-length merge movement would put the merging car straight into the
      // target lane, with no stretch for gap acceptance (T07's bounded mainline braking).
      if (!split && branches.length > 1 && !balanced) {
        valid = false;
        break;
      }
      const usedTrunk = new Set<number>();
      let cursor = 0;
      const trunkSource = sources[trunk.idx]!;
      for (const [position, branch] of branches.entries()) {
        const from = split ? trunk : branch,
          to = split ? branch : trunk;
        const source = sources[branch.idx]!;
        const explicit = legal.filter(
          (m) => lanes[m.fromLane]!.road === from.idx && lanes[m.toLane]!.road === to.idx,
        );
        const count = Math.min(
          branch.lanes.length,
          Math.max(0, trunk.lanes.length - cursor - (branches.length - position - 1)),
        );
        const matches: [number, number][] = [];
        // Explicit lane rules are already reflected by the generated movements. A unique
        // translation of that whole block takes precedence over geometric default slices.
        const translations = new Set(
          explicit.map((m) => {
            const a = lanes[split ? m.fromLane : m.toLane]!.lane;
            const b = lanes[split ? m.toLane : m.fromLane]!.lane;
            return a - b;
          }),
        );
        const distinctTrunk = new Set(explicit.map((m) => (split ? m.fromLane : m.toLane)));
        const distinctBranch = new Set(explicit.map((m) => (split ? m.toLane : m.fromLane)));
        const exact =
          translations.size === 1 &&
          distinctTrunk.size === explicit.length &&
          distinctBranch.size === explicit.length &&
          explicit.length > 0 &&
          explicit.every((m) => !usedTrunk.has(lanes[split ? m.fromLane : m.toLane]!.lane));
        const rules = sourceNodes[node.idx]!.turnRules.filter(
          (r) => r.from === from.id && r.to === to.id,
        );
        const constrained = rules.some((r) => r.fromLane !== undefined || r.toLane !== undefined);
        if (constrained && !exact) {
          valid = false;
          break;
        }
        if (!balanced && branches.length > 1 && !constrained) {
          const shared = Math.min(branch.lanes.length, trunk.lanes.length);
          for (let i = 0; i < shared; i++)
            matches.push([
              position === 0 ? i : trunk.lanes.length - shared + i,
              position === 0 ? i : branch.lanes.length - shared + i,
            ]);
        } else if (exact && (branches.length === 1 || constrained)) {
          for (const m of explicit)
            matches.push([
              lanes[split ? m.fromLane : m.toLane]!.lane,
              lanes[split ? m.toLane : m.fromLane]!.lane,
            ]);
        } else {
          const start =
            branches.length === 1 && side === 'left' ? trunk.lanes.length - count : cursor;
          const branchStart = side === 'left' ? branch.lanes.length - count : 0;
          for (let i = 0; i < count; i++) matches.push([start + i, branchStart + i]);
        }
        matches.sort((a, b) => a[0] - b[0]);
        if (!matches.length || (balanced && branches.length > 1 && matches[0]![0] < cursor)) {
          valid = false;
          break;
        }
        // Two whole overlapping lane blocks have crossing movements, not a lane seam.
        if (matches.filter(([i]) => usedTrunk.has(i)).length > 1) {
          valid = false;
          break;
        }
        const [firstTrunk, firstBranch] = matches[0]!;
        const offsetM = laneOffset(trunkSource, firstTrunk) - laneOffset(source, firstBranch);
        if (
          matches.some(
            ([a, b]) =>
              Math.abs(laneOffset(trunkSource, a) - laneOffset(source, b) - offsetM) > 0.01,
          )
        ) {
          valid = false;
          break;
        }
        const usedBranch = new Set(matches.map(([, b]) => b));
        for (const [a] of matches) usedTrunk.add(a);
        cursor = matches.at(-1)![0] + 1;
        if (balanced)
          selected.set(
            roadPair(from, to),
            new Set(matches.map(([a, b]) => (split ? `${a}:${b}` : `${b}:${a}`))),
          );
        layout.set(branch.idx, {
          [split ? 'start' : 'end']: {
            heading,
            offsetM,
            tapers: branch.lanes.map((_, i) => i).filter((i) => !usedBranch.has(i)),
          },
        });
      }
      layout.set(trunk.idx, {
        [split ? 'end' : 'start']: {
          heading,
          offsetM: 0,
          tapers: trunk.lanes.map((_, i) => i).filter((i) => !usedTrunk.has(i)),
        },
      });
    }
    if (!valid) continue;
    pairs.set(node.idx, selected);
    const unchanged =
      node.setbacks.every((s) => s === 0) &&
      [...layout.values()].every(
        (r) =>
          (!r.start || (r.start.offsetM === 0 && !r.start.tapers.length)) &&
          (!r.end || (r.end.offsetM === 0 && !r.end.tapers.length)),
      );
    if (!unchanged) for (const [idx, end] of layout) Object.assign(ends[idx]!, end);
  }
  return { ends, pairs };
}
