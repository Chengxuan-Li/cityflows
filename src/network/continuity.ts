import {
  cumulativeLengths,
  headingAtDistance,
  pointAtDistance,
  polylineLength,
  trimPolyline,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { Node, Road } from '../schema';
import type { CLane, CMovement, CNode, CRoad } from './types';
import { roadWidth, taperLength, type ContinuationEnd, type RoadContinuity } from './lanes';

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

/** A road end at a node: `atEnd` when the road ends there (it enters the node). */
interface Arm {
  source: Road;
  atEnd: boolean;
}

/** On a road's own lane block, `a` metres from the node: the left edge (-1), the centre (0) or
 * the right edge (1) in travel direction, with the travel heading there. */
// Centerline lengths for the current `continuationLayout` call (importers edit centerlines in
// place between compiles, so nothing is kept across calls).
let centerlineLengths = new Map<readonly Vec2[], Float64Array>();

function blockPoint(arm: Arm, a: number, side: number) {
  const line = arm.source.centerline;
  let lengths = centerlineLengths.get(line);
  if (!lengths) centerlineLengths.set(line, (lengths = cumulativeLengths(line)));
  const total = lengths.at(-1)!;
  const s = Math.max(0, Math.min(total, arm.atEnd ? total - a : a));
  const p = pointAtDistance(line, lengths, s);
  const heading = headingAtDistance(line, lengths, s);
  const lateral = arm.source.lateralOffsetM + (side * roadWidth(arm.source)) / 2;
  return {
    point: { x: p.x - Math.sin(heading) * lateral, y: p.y + Math.cos(heading) * lateral },
    heading,
  };
}

/** TASK-080 (B36): distance from the node to where two neighbouring branches' own lane blocks
 * (`left` left of `right` in travel direction) stop overlapping. Up to there their lanes run
 * side by side. */
export function separation(left: Arm, right: Arm): number {
  const limit = Math.min(
    polylineLength(left.source.centerline),
    polylineLength(right.source.centerline),
  );
  let apart = 0;
  for (let a = 0; a <= limit; a += 0.5) {
    const l = blockPoint(left, a, 1),
      r = blockPoint(right, a, -1);
    const gap =
      -(r.point.x - l.point.x) * Math.sin(l.heading) +
      (r.point.y - l.point.y) * Math.cos(l.heading);
    if (gap < -0.05) apart = Math.min(limit, a + 0.5);
  }
  return apart;
}

/** A straight reference line along `heading` through `at`, in travel direction, starting there
 * (a road leaving the node) or ending there (a road entering it). */
function ray(at: Vec2, heading: number, atEnd: boolean, length: number): Vec2[] {
  const sign = atEnd ? -1 : 1;
  const far = {
    x: at.x + Math.cos(heading) * length * sign,
    y: at.y + Math.sin(heading) * length * sign,
  };
  return atEnd ? [far, at] : [at, far];
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
  centerlineLengths = new Map();
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
      const sharedWidth: number[] = [];
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
        const reused = matches.filter(([i]) => usedTrunk.has(i));
        if (reused.length > 1) {
          valid = false;
          break;
        }
        sharedWidth.push(reused.reduce((sum, [i]) => sum + trunkSource.lanes[i]!.widthM, 0));
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
            holdM: 0,
            taperM: 0,
            reference: [],
          },
        });
      }
      if (!valid) break;
      // TASK-080: neighbouring branches keep their side-by-side slices until their own lane
      // blocks part, then ease together over the group's shortest taper. A branch that shares a
      // trunk lane with its left neighbour first moves off it, one shared width to the right,
      // over the same taper: the shared lane splits in two.
      const taperM = Math.min(...branches.map((b) => taperLength(sources[b.idx]!)));
      let holdM = sharedWidth.some((w) => w > 0) ? taperM : 0;
      for (let i = 1; i < branches.length; i++)
        holdM = Math.max(
          holdM,
          separation(
            { source: sources[branches[i - 1]!.idx]!, atEnd: !split },
            { source: sources[branches[i]!.idx]!, atEnd: !split },
          ),
        );
      const reach = Math.max(...branches.map((b) => polylineLength(sources[b.idx]!.centerline)));
      let shift = 0;
      for (const [i, branch] of branches.entries()) {
        shift += sharedWidth[i]!;
        Object.assign(layout.get(branch.idx)![split ? 'start' : 'end']!, {
          holdM,
          taperM,
          splitM: shift,
          reference: ray(node.pos, heading, !split, reach + 50),
        });
      }
      layout.set(trunk.idx, {
        [split ? 'end' : 'start']: {
          heading,
          offsetM: 0,
          tapers: trunk.lanes.map((_, i) => i).filter((i) => !usedTrunk.has(i)),
          holdM: 0,
          taperM: taperLength(trunkSource),
          reference: ray(node.pos, heading, split, polylineLength(trunkSource.centerline) + 50),
        },
      });
    }
    if (!valid) continue;
    pairs.set(node.idx, selected);
    const unchanged =
      node.setbacks.every((s) => s === 0) &&
      [...layout.values()].every(
        (r) =>
          (!r.start || (r.start.offsetM === 0 && !r.start.splitM && !r.start.tapers.length)) &&
          (!r.end || (r.end.offsetM === 0 && !r.end.splitM && !r.end.tapers.length)),
      );
    if (!unchanged) for (const [idx, end] of layout) Object.assign(ends[idx]!, end);
  }
  fitContinuations(nodes, roads, sources, ends, pairs);
  for (const node of nodes)
    if (!pairs.has(node.idx)) sideBySide(node, nodes, roads, sources, ends, pairs, side);
  return { ends, pairs };
}

function cutAt(node: CNode, roads: CRoad[], road: CRoad): number {
  const incident = roads.filter((r) => r.from === node.idx || r.to === node.idx);
  return node.setbacks[incident.indexOf(road)]!;
}

/** A continuation's transitions fit their road; with transitions at both ends each gets half. */
function fitContinuations(
  nodes: CNode[],
  roads: CRoad[],
  sources: Road[],
  ends: RoadContinuity[],
  pairs: Map<number, ContinuationPairs>,
) {
  for (const road of roads) {
    const transition = ends[road.idx]!;
    if (!transition.start && !transition.end) continue;
    const length = polylineLength(sources[road.idx]!.centerline);
    // As compile trims the road: setbacks scaled to leave 5 m, none at a continuation node.
    const setbacks = [cutAt(nodes[road.from]!, roads, road), cutAt(nodes[road.to]!, roads, road)];
    const trim = setbacks[0]! + setbacks[1]!;
    const scale = trim === 0 ? 1 : Math.min(1, Math.max(0, length - 5) / trim);
    const total =
      length -
      [road.from, road.to].reduce(
        (sum, n, i) => sum + (pairs.has(n) ? 0 : setbacks[i]! * scale),
        0,
      );
    const room = transition.start && transition.end ? total / 2 : total;
    for (const end of [transition.start, transition.end]) {
      if (!end) continue;
      end.taperM = Math.max(0.5, Math.min(end.taperM, room));
      end.holdM = Math.min(end.holdM, room - end.taperM);
    }
  }
}

/** A branch and the roads that continue it through plain through nodes (same lanes, no
 * junction, no transition of their own), outward from the node, up to 400 m. */
interface Chain {
  roads: CRoad[];
  /** Distance from the node to each road's node-side end, along the chain. */
  starts: number[];
  length: number;
  /** The chain ends at a junction, where a side-by-side block may simply arrive. */
  junction: boolean;
}

function chainPoint(chain: Chain, sources: Road[], split: boolean, a: number, side: number) {
  const at = Math.max(0, Math.min(chain.length, a));
  let k = chain.starts.length - 1;
  while (k > 0 && chain.starts[k]! > at) k--;
  const arm = { source: sources[chain.roads[k]!.idx]!, atEnd: !split };
  return blockPoint(arm, at - chain.starts[k]!, side);
}

/** TASK-080 (B36): a split or merge outside the continuation rule (a branch more than 30 degrees
 * off the trunk axis, an absorbing merge, lane rules that cross) keeps its junction, setbacks and
 * movements, but where its branches' own lane blocks would overlap past the cuts their lanes run
 * side by side instead: one block along the branches' mean line, through the roads that continue
 * the branches, up to where the branches part; then each eases onto its own offsets over the
 * group's taper. The block keeps the trunk's median-side edge, so extra lanes stand out on the
 * curb side (an absorbed lane, a lane added at an exit). */
function sideBySide(
  node: CNode,
  nodes: CNode[],
  roads: CRoad[],
  sources: Road[],
  ends: RoadContinuity[],
  pairs: Map<number, ContinuationPairs>,
  side: 'left' | 'right',
) {
  if (node.control !== 'uncontrolled') return;
  const incoming = roads.filter((r) => r.to === node.idx && r.from !== node.idx);
  const outgoing = roads.filter((r) => r.from === node.idx && r.to !== node.idx);
  const split = incoming.length === 1 && outgoing.length > 1;
  if (!split && !(outgoing.length === 1 && incoming.length > 1)) return;
  const trunk = (split ? incoming : outgoing)[0]!;
  const branches = split ? outgoing : incoming;
  if (branches.some((road) => ends[road.idx]![split ? 'start' : 'end'])) return;
  const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const directions = branches.map(
    (road) => blockPoint({ source: sources[road.idx]!, atEnd: !split }, 0, 0).heading,
  );
  const mean = Math.atan2(
    directions.reduce((sum, h) => sum + Math.sin(h), 0),
    directions.reduce((sum, h) => sum + Math.cos(h), 0),
  );
  const trunkArm = { source: sources[trunk.idx]!, atEnd: split };
  if (
    directions.some((h) => angle(h, mean) > Math.PI / 6) ||
    angle(blockPoint(trunkArm, 0, 0).heading, mean) > Math.PI / 4
  )
    return;

  const lengthOf = (road: CRoad) => polylineLength(sources[road.idx]!.centerline);
  const chains: Chain[] = branches.map((branch) => {
    const chain: Chain = {
      roads: [branch],
      starts: [0],
      length: lengthOf(branch),
      junction: false,
    };
    for (;;) {
      const last = chain.roads.at(-1)!;
      const far = nodes[split ? last.to : last.from]!;
      const incident = roads.filter((r) => r.from === far.idx || r.to === far.idx);
      chain.junction = !pairs.has(far.idx) && cutAt(far, roads, last) > 0;
      const farEnd = ends[last.idx]![split ? 'end' : 'start'];
      if (farEnd) {
        // A transition of its own at the far end (a continuation): both share the road.
        const half = lengthOf(last) / 2;
        farEnd.taperM = Math.min(farEnd.taperM, half);
        farEnd.holdM = Math.min(farEnd.holdM, half - farEnd.taperM);
        chain.length = chain.starts.at(-1)! + half;
        chain.junction = false;
        return chain;
      }
      const next = incident.find((r) => r !== last);
      if (
        chain.length >= 400 ||
        incident.length !== 2 ||
        far.setbacks.some((s) => s > 0) ||
        !next ||
        (split ? next.from : next.to) !== far.idx ||
        ends[next.idx]![split ? 'start' : 'end'] ||
        roadWidth(sources[next.idx]!) !== roadWidth(sources[last.idx]!) ||
        sources[next.idx]!.lateralOffsetM !== sources[last.idx]!.lateralOffsetM
      )
        return chain;
      chain.roads.push(next);
      chain.starts.push(chain.length);
      chain.length += lengthOf(next);
    }
  });
  const point = (i: number, a: number, edge: number) =>
    chainPoint(chains[i]!, sources, split, a, edge);
  // Left to right across the mean heading, a little way out from the node.
  const shortest = Math.min(...chains.map((c) => c.length));
  const probe = Math.min(10, shortest / 2);
  const across = (p: Vec2) => -p.x * Math.sin(mean) + p.y * Math.cos(mean);
  const order = chains
    .map((_, i) => i)
    .sort(
      (a, b) =>
        across(point(a, probe, 0).point) - across(point(b, probe, 0).point) ||
        branches[a]!.idx - branches[b]!.idx,
    );
  let apart = 0;
  for (let k = 1; k < order.length; k++) {
    const left = order[k - 1]!,
      right = order[k]!;
    for (let a = 0; a <= Math.min(chains[left]!.length, chains[right]!.length); a += 0.5) {
      const l = point(left, a, 1),
        r = point(right, a, -1);
      const gap =
        -(r.point.x - l.point.x) * Math.sin(l.heading) +
        (r.point.y - l.point.y) * Math.cos(l.heading);
      if (gap < -0.05) apart = Math.max(apart, a + 0.5);
    }
  }
  const cuts = branches.map((road) => cutAt(node, roads, road));
  if (apart <= Math.max(...cuts) + 0.5) return;
  // The group eases together: one taper, the shortest by speed, ending where every chain still
  // has room (a chain that reaches a junction may arrive there side by side).
  const room = Math.min(...chains.map((c) => (c.junction ? Infinity : c.length)));
  const taperM = Math.min(
    room - Math.max(...cuts),
    ...chains.flatMap((c) =>
      c.roads.map((r) => Math.max(15, Math.min(40, 0.4 * sources[r.idx]!.speedLimitMps * 3.6))),
    ),
  );
  if (taperM < 1) return;
  apart = Math.min(apart, room - taperM);

  // The mean line of the branches' own block centres from the node outward, continued straight
  // beyond the shortest chain.
  const outward: Vec2[] = [];
  for (let a = 0; ; a = Math.min(shortest, a + 1)) {
    const points = chains.map((_, i) => point(i, a, 0).point);
    outward.push({
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    });
    if (a === shortest) break;
  }
  const tip = outward.at(-1)!,
    before = outward.at(-2)!;
  const direction = Math.atan2(tip.y - before.y, tip.x - before.x);
  const beyond = Math.max(...chains.map((c) => c.length)) - shortest + 50;
  outward.push({
    x: tip.x + Math.cos(direction) * beyond,
    y: tip.y + Math.sin(direction) * beyond,
  });
  const travel = split ? outward : [...outward].reverse();
  const travelLengths = cumulativeLengths(travel);
  const lineLength = travelLengths.at(-1)!;
  const heading = headingAtDistance(travel, travelLengths, split ? 0 : lineLength);
  const trunkCentre = blockPoint(trunkArm, 0, 0).point;
  const centre =
    -(trunkCentre.x - outward[0]!.x) * Math.sin(heading) +
    (trunkCentre.y - outward[0]!.y) * Math.cos(heading);
  const widths = chains.map((c) => roadWidth(sources[c.roads[0]!.idx]!));
  const total = widths.reduce((sum, w) => sum + w, 0);
  const trunkWidth = roadWidth(sources[trunk.idx]!);
  let edge = side === 'right' ? centre - trunkWidth / 2 : centre + trunkWidth / 2 - total;
  for (const i of order) {
    const chain = chains[i]!;
    for (const [k, road] of chain.roads.entries()) {
      const near = chain.starts[k]! + (k === 0 ? cuts[i]! : 0);
      if (apart + taperM <= near) break;
      const source = sources[road.idx]!;
      const end: ContinuationEnd = {
        heading: headingAtDistance(travel, travelLengths, split ? near : lineLength - near),
        offsetM: edge - (source.lateralOffsetM - widths[i]! / 2),
        tapers: [],
        holdM: apart - near,
        taperM,
        reference: split ? trimPolyline(travel, near, 0) : trimPolyline(travel, 0, near),
      };
      ends[road.idx]![split ? 'start' : 'end'] = end;
      // The block reaches this road's far end: that end only marks it (no window of its own).
      if (apart + taperM > chain.starts[k]! + lengthOf(road) - 0.5)
        ends[road.idx]![split ? 'end' : 'start'] = { ...end, holdM: 0, taperM: 0 };
    }
    edge += widths[i]!;
  }
}
