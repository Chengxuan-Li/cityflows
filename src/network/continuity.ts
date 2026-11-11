import {
  cumulativeLengths,
  headingAtDistance,
  pointAtDistance,
  polylineLength,
  trimPolyline,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { Node, Road } from '../schema';
import type { Reference } from './corridor';
import { SETBACK_CAP_M, type ThroughPair } from './junctions';
import type { CLane, CMovement, CNode, CRoad } from './types';
import {
  CONVERGING,
  MEDIAN_VOID_M,
  roadWidth,
  sameStreet,
  SHIFT_STEP_M,
  shiftAt,
  smoothstep,
  taperLength,
  type ContinuationEnd,
  type RoadContinuity,
} from './lanes';

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

/** TASK-071: a split's or merge's branches ordered left to right across `heading`, the axis in
 * the group's travel direction. */
export function orderBranches(
  branches: CRoad[],
  headings: { start: number; end: number }[],
  heading: number,
  split: boolean,
): CRoad[] {
  const angle = (r: CRoad) =>
    (split ? 1 : -1) * Math.sin(headings[r.idx]![split ? 'start' : 'end'] - heading);
  return [...branches].sort((a, b) => angle(a) - angle(b) || a.idx - b.idx);
}

/** TASK-071's default slice: the [trunk lane, branch lane] pairs that line up for the branch at
 * `position` (left to right), `cursor` being the first trunk lane right of the slices before
 * it. Balanced branches take consecutive slices; when the lane counts differ the first branch
 * keeps the trunk's left lanes and the others its right lanes, without crossing. */
export function defaultSlice(
  trunkLanes: number,
  branchLanes: number[],
  position: number,
  cursor: number,
  side: 'left' | 'right',
): [number, number][] {
  const lanes = branchLanes[position]!;
  const balanced = branchLanes.reduce((sum, n) => sum + n, 0) === trunkLanes;
  if (!balanced && branchLanes.length > 1) {
    const [a, b] = branchLanes.map((n) => Math.min(n, trunkLanes)) as [number, number];
    // TASK-131: two branches sharing more than one trunk lane would cross (Munich r:846 at n:478,
    // two lanes into two two-lane branches): the trunk's lanes divide between them in proportion,
    // left to right, and each trunk lane feeds the branch lanes beside it.
    if (branchLanes.length === 2 && a + b > trunkLanes + 1) {
      const left = Math.min(
        trunkLanes - 1,
        Math.max(
          1,
          Math.round((trunkLanes * branchLanes[0]!) / (branchLanes[0]! + branchLanes[1]!)),
        ),
      );
      const [first, count] = position === 0 ? [0, left] : [left, trunkLanes - left];
      return Array.from({ length: lanes }, (_, i) => [first + Math.floor((i * count) / lanes), i]);
    }
    const shared = Math.min(lanes, trunkLanes);
    return Array.from({ length: shared }, (_, i) =>
      position === 0 ? [i, i] : [trunkLanes - shared + i, lanes - shared + i],
    );
  }
  const count = Math.min(
    lanes,
    Math.max(0, trunkLanes - cursor - (branchLanes.length - position - 1)),
  );
  const start = branchLanes.length === 1 && side === 'left' ? trunkLanes - count : cursor;
  const branchStart = side === 'left' ? lanes - count : 0;
  return Array.from({ length: count }, (_, i) => [start + i, branchStart + i]);
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
      const branches = orderBranches(split ? outgoing : incoming, headings, heading, split);
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
        if (exact && (branches.length === 1 || constrained)) {
          for (const m of explicit)
            matches.push([
              lanes[split ? m.fromLane : m.toLane]!.lane,
              lanes[split ? m.toLane : m.fromLane]!.lane,
            ]);
        } else {
          matches.push(
            ...defaultSlice(
              trunk.lanes.length,
              branches.map((r) => r.lanes.length),
              position,
              cursor,
              side,
            ),
          );
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
        // A direction of a two-way street never moves (architecture 5): where a carriageway
        // continues into one at a node of its own (TASK-131 keeps Benzstrasse's splits n:867 and
        // n:902 apart), lining the lanes up would lay it over its other direction; the node stays
        // a junction.
        if (source.streetGroupId !== null && Math.abs(offsetM) > 0.01) {
          valid = false;
          break;
        }
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

// ---------------------------------------------------------------------------------------------
// Converging carriageways (TASK-089).

/** Gap between the lane blocks of converging carriageways set side by side: the importer's
 * median of a separated pair (TASK-084). */
const MEDIAN_M = 0.5;
/** Carriageways of a street arm another converging pair of the node sets side by side join it
 * within this angle. */
const ARM_CONVERGING = Math.cos(Math.PI / 3);
/** Carriageways whose blocks part within this distance beyond their cuts need no shift: the
 * junction polygon holds them. */
const OVERLAP_PROBE_M = 1;
/** Length of a signal's crossing beyond the cut (the zebra runs 0.25 to 2.75 m), with a margin. */
const CROSSING_M = 3;
/** Farther from the node than this the blocks are not compared. */
const CONVERGE_REACH_M = 200;
/** Blocks whose gap falls short of the median by no more than this have parted (TASK-099). */
const TOUCH_M = 0.05;
const ALONG = Math.cos(Math.PI / 6);
/** Another road end within this angle on the side a block would move to is in its way. */
const NEIGHBOUR = Math.cos(Math.PI / 3);

/** A point of a reference `d` from its node end, with the outward unit direction there (away
 * from the node) and that direction's right-hand normal. */
function outwardFrame(ref: Reference, incoming: boolean, d: number) {
  const total = ref.lengths.at(-1)!;
  const s = Math.max(0, Math.min(total, incoming ? total - d : d));
  const p = pointAtDistance(ref.points, ref.lengths, s);
  const a = pointAtDistance(ref.points, ref.lengths, Math.max(0, s - 0.5));
  const b = pointAtDistance(ref.points, ref.lengths, Math.min(total, s + 0.5));
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const sign = incoming ? -1 : 1;
  const t = { x: ((b.x - a.x) / length) * sign, y: ((b.y - a.y) / length) * sign };
  return { p, t, n: { x: -t.y, y: t.x } };
}

/** Running mean over the `window` behind each sample (toward the node), the first value held
 * before the start. Of a profile that never increases it never increases, lies at or above it
 * and keeps its first value at the node with zero slope. */
function trailingMean(values: number[], window: number): number[] {
  const n = Math.max(1, Math.round(window / SHIFT_STEP_M));
  const prefix = [0];
  for (const v of values) prefix.push(prefix.at(-1)! + v);
  return values.map((_, i) => {
    const lo = i - n;
    const before = lo < 0 ? -lo * values[0]! : 0;
    return (before + prefix[i + 1]! - prefix[Math.max(0, lo) + 1]!) / n;
  });
}

/** Mean over a window centred on each sample, `half` either side and shrinking to nothing at
 * either end: exact on a linear stretch, at or above a convex corner, and never increasing where
 * the values never increase. */
function centredMean(values: number[], half: number): number[] {
  const n = Math.max(1, Math.round(half / SHIFT_STEP_M));
  const prefix = [0];
  for (const v of values) prefix.push(prefix.at(-1)! + v);
  return values.map((_, i) => {
    const h = Math.min(n, i, values.length - 1 - i);
    return (prefix[i + h + 1]! - prefix[i - h]!) / (2 * h + 1);
  });
}

/** `value` held to `hold` from the node, then eased to zero over `taper` by two trailing means
 * (zero slope at both ends of the ease). */
function holdRamp(value: number, hold: number, taper: number): number[] {
  const step = Array.from({ length: Math.ceil((hold + taper) / SHIFT_STEP_M) + 2 }, (_, i) =>
    i * SHIFT_STEP_M <= hold ? value : 0,
  );
  return trailingMean(trailingMean(step, taper / 2), taper / 2);
}

/** How far from a node a converging shift holds still before it eases away: the junction mouth,
 * the setback cap and a signal's crossing beyond it (the same at every node, so that the geometry
 * does not change with the node's control). */
const MOUTH_M = SETBACK_CAP_M + CROSSING_M;

/** A profile trimmed after its last non-zero value, which is followed by one zero. */
function trimmed(profile: number[]): Float64Array {
  let last = profile.length - 1;
  while (last >= 0 && Math.abs(profile[last]!) < 1e-6) last--;
  return Float64Array.from([...profile.slice(0, last + 1), 0]);
}

interface ConvergingEnd {
  road: CRoad;
  incoming: boolean;
  /** Outward unit direction, the chord to the reference 10 m out (at most half the road). */
  d: Vec2;
}

/**
 * Converging carriageways (TASK-089, architecture 5.1; the owner's rule: split converging nodes
 * geometrically, keep the network). At a junction (a node with a road end more than 30 degrees
 * off the street's ends and their opposites), an incoming and an outgoing one-way end of one
 * street (`sameStreet`) within 45 degrees of each other (60 where another such pair meets at the
 * node, the arms of a crossing), the outgoing one not crossed over to the other side of the
 * incoming one, whose own lane blocks still overlap a metre beyond the farther of their cuts as
 * cut without shifts, converge there; not a carriageway of a divided pair (already side by side
 * with its own pair), nor one whose block would move toward another road end within 60 degrees
 * of it (a ramp or fork beside it). A street's converging ends at the node form one group, its
 * incoming ends and its outgoing ends each moving as one block. Each side gets its own end: its
 * median-side edge half the 0.5 m median from the node point at the node, held over the junction
 * mouth (`MOUTH_M`) and eased away from the node over the group's shortest TASK-080 taper (beyond
 * the mouth no more than the pair's own shortfall, so the median opens no lens); where
 * the blocks still overlap farther out, the remaining shortfall of the gap between the facing
 * edges is eased above (`easeAbove`) and shared by the sides in proportion to half their width
 * plus half the median, as `separateDual` shares its push. A shift runs on along the roads an end
 * continues straight through two-road nodes, out to half the road where the road converges at its
 * far node too, else as far as its far node leaves room, and stops where the pair parts or
 * crosses. A road continuing a shifted end straight across the node (TASK-083's through pairs)
 * that is not shifted itself takes the shift that lines its median-side edge up with the shifted
 * end's at the node, eased over its own taper (a jog within half the median is left to the
 * through movement). B43: a divided pair whose median is narrower than 1 m 40 m out keeps that
 * median at the node. Returns each road's shifts (`CRoad.startShift`, `CRoad.endShift`) to the
 * right of travel and the groups (for `convergingFlows`).
 */
export function convergingShifts(
  nodes: CNode[],
  incident: CRoad[][],
  sources: Road[],
  references: Reference[],
  through: ThroughPair[][],
  setbacks: number[][],
  side: 'left' | 'right',
  sourceNodes: Node[],
  found?: ConvergingGroup[],
  groupMembers: ReadonlySet<number> = new Set(),
): { shifts: { start: Float64Array; end: Float64Array }[]; groups: ConvergingGroup[] } {
  const sigma = side === 'right' ? 1 : -1;
  const key = (road: number, incoming: boolean) => `${road}:${incoming ? 'end' : 'start'}`;
  const length = (road: number) => references[road]!.lengths.at(-1)!;
  // The roads an end runs on straight through nodes of two roads, outward from its node, with
  // the distance from the node to each road's near end; it stops at an end converging at its own
  // node, a junction or a dead end.
  const byIdx = new Map(incident.flat().map((r) => [r.idx, r]));
  const farNode = (road: number, incoming: boolean) =>
    incoming ? byIdx.get(road)!.from : byIdx.get(road)!.to;
  const chains = new Map<string, { roads: number[]; offsets: number[]; length: number }>();
  const chainOf = (road: number, incoming: boolean) => {
    const k = key(road, incoming);
    let chain = chains.get(k);
    if (chain) return chain;
    chain = { roads: [road], offsets: [0], length: length(road) };
    for (let last = road; chain.length < CONVERGE_REACH_M;) {
      if (grouped.has(key(last, !incoming))) break;
      const far = farNode(last, incoming);
      const around = incident[far]!.filter((r) => r.from !== r.to);
      const next = around.find((r) => r.idx !== last);
      if (around.length !== 2 || !next || (incoming ? next.to : next.from) !== far) break;
      // Straight on (a through or continuation node, which carries the shift across).
      const out = (r: number, inc: boolean) => outwardFrame(references[r]!, inc, 0).t;
      const [ta, tb] = [out(last, !incoming), out(next.idx, incoming)];
      if (grouped.has(key(next.idx, incoming)) || ta.x * tb.x + ta.y * tb.y > -ALONG) break;
      chain.roads.push(next.idx);
      chain.offsets.push(chain.length);
      chain.length += length(next.idx);
      last = next.idx;
    }
    chains.set(k, chain);
    return chain;
  };
  const chainFrame = (road: number, incoming: boolean, d: number) => {
    const chain = chainOf(road, incoming);
    let k = chain.offsets.length - 1;
    while (k > 0 && chain.offsets[k]! > d) k--;
    const idx = chain.roads[k]!;
    const source = sources[idx]!;
    const ownHalf = roadWidth(source) / 2;
    let halfWidth = ownHalf;
    // The narrow side of a lane-count joint follows the wider median edge, then eases
    // onto its own block over the same taper used by the continuation layout.
    for (const next of [k - 1, k + 1]) {
      if (next < 0 || next >= chain.roads.length) continue;
      const half = roadWidth(sources[chain.roads[next]!]!) / 2;
      const joint = chain.offsets[Math.max(k, next)]!;
      halfWidth = Math.max(
        halfWidth,
        ownHalf + (half - ownHalf) * (1 - smoothstep(Math.abs(d - joint) / taperLength(source))),
      );
    }
    return {
      ...outwardFrame(references[idx]!, incoming, d - chain.offsets[k]!),
      source,
      halfWidth,
    };
  };
  // The shortfall of the gap between an incoming end's block and an outgoing end's `d` from the
  // node (along their chains once groups are known), and the distance between their centres,
  // both across the incoming end toward the side the outgoing one belongs on.
  let chained = false;
  const measure = (a: ConvergingEnd, b: ConvergingEnd, d: number) => {
    const fa = chained
      ? chainFrame(a.road.idx, true, d)
      : {
          ...outwardFrame(references[a.road.idx]!, true, d),
          source: sources[a.road.idx]!,
          halfWidth: roadWidth(sources[a.road.idx]!) / 2,
        };
    const fb = chained
      ? chainFrame(b.road.idx, false, d)
      : {
          ...outwardFrame(references[b.road.idx]!, false, d),
          source: sources[b.road.idx]!,
          halfWidth: roadWidth(sources[b.road.idx]!) / 2,
        };
    const sa = fa.source,
      sb = fb.source;
    const centres =
      sigma * ((fb.p.x - fa.p.x) * fa.n.x + (fb.p.y - fa.p.y) * fa.n.y) +
      sigma * (sa.lateralOffsetM + sb.lateralOffsetM);
    return { shortfall: MEDIAN_M - centres + fa.halfWidth + fb.halfWidth, centres };
  };
  const groups: { node: CNode; ins: ConvergingEnd[]; outs: ConvergingEnd[] }[] = [];
  const grouped = new Set<string>();
  const endOf = (road: CRoad, node: CNode): ConvergingEnd => {
    const incoming = road.to === node.idx;
    const near = outwardFrame(references[road.idx]!, incoming, 0).p;
    const far = outwardFrame(references[road.idx]!, incoming, Math.min(10, length(road.idx) / 2)).p;
    const chord = Math.hypot(far.x - near.x, far.y - near.y) || 1;
    return { road, incoming, d: { x: (far.x - near.x) / chord, y: (far.y - near.y) / chord } };
  };
  for (const g of found ?? []) {
    const node = nodes[g.node]!;
    const ins = g.ins.map((r) => endOf(byIdx.get(r)!, node));
    const outs = g.outs.map((r) => endOf(byIdx.get(r)!, node));
    groups.push({ node, ins, outs });
    for (const e of [...ins, ...outs]) grouped.add(key(e.road.idx, e.incoming));
  }
  for (const node of found ? [] : nodes) {
    const ends = incident[node.idx]!.filter((r) => r.from !== r.to).map((road): ConvergingEnd => {
      const incoming = road.to === node.idx;
      const near = outwardFrame(references[road.idx]!, incoming, 0).p;
      const far = outwardFrame(
        references[road.idx]!,
        incoming,
        Math.min(10, length(road.idx) / 2),
      ).p;
      const chord = Math.hypot(far.x - near.x, far.y - near.y) || 1;
      return {
        road,
        incoming,
        d: { x: (far.x - near.x) / chord, y: (far.y - near.y) / chord },
      };
    });
    // Pairs converging without overlapping beyond their cuts: set side by side too where another
    // pair of the node is (the street's carriageways meet the junction side by side on every arm,
    // owner's n:104 sketch).
    const quiet: [number, number][] = [];
    const joined: [number, number][] = [];
    for (const [i, a] of ends.entries())
      for (const [j, b] of ends.entries()) {
        if (!a.incoming || b.incoming || a.road === b.road) continue;
        if (!sameStreet(sources[a.road.idx]!, sources[b.road.idx]!)) continue;
        if (a.d.x * b.d.x + a.d.y * b.d.y < ARM_CONVERGING) continue;
        const probe = Math.min(20, length(a.road.idx) / 2, length(b.road.idx) / 2);
        if (measure(a, b, probe).centres < -1) continue;
        // Their own blocks still overlap a metre beyond the farther cut (as cut unshifted).
        const cut = Math.max(
          ...[a, b].map((e) => setbacks[node.idx]![incident[node.idx]!.indexOf(e.road)]!),
        );
        // A carriageway of a divided pair (its block off its line past half the median) is side by
        // side with its own pair already.
        const divided = [a, b].some(
          (e) =>
            Math.abs(sources[e.road.idx]!.lateralOffsetM) - roadWidth(sources[e.road.idx]!) / 2 >
            0.1,
        );
        if (divided) continue;
        if (
          a.d.x * b.d.x + a.d.y * b.d.y < CONVERGING ||
          measure(a, b, Math.min(cut + OVERLAP_PROBE_M, probe)).shortfall <= MEDIAN_M + 0.05
        ) {
          quiet.push([i, j]);
          continue;
        }
        joined.push([i, j]);
      }
    // Ends grouped from the pairs given, with the ends on one reference line running the same way;
    // the groups that may be split (at a junction, not crowded).
    const form = (pairs: [number, number][]) => {
      const parent = ends.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
      for (const [i, j] of pairs) parent[find(i)] = find(j);
      // Ends on one reference line running the same way (a same-direction pair) move as one.
      for (const [i, a] of ends.entries())
        for (const [j, b] of ends.entries())
          if (
            i < j &&
            a.incoming === b.incoming &&
            references[a.road.idx]!.source === references[b.road.idx]!.source
          )
            parent[find(i)] = find(j);
      const formed: { node: CNode; ins: ConvergingEnd[]; outs: ConvergingEnd[] }[] = [];
      const members = new Map<number, ConvergingEnd[]>();
      ends.forEach((e, i) => members.set(find(i), [...(members.get(find(i)) ?? []), e]));
      for (const group of members.values()) {
        const ins = group.filter((e) => e.incoming),
          outs = group.filter((e) => !e.incoming);
        const junction = ends.some(
          (e) =>
            !group.includes(e) &&
            group.every((m) => Math.abs(e.d.x * m.d.x + e.d.y * m.d.y) < ALONG),
        );
        // A block shifted toward another road end close beside it (a ramp, a fork) would run into
        // it: such a street keeps its carriageways as drawn.
        const crowded = group.some((m) => {
          const toward =
            m.incoming === sigma > 0 ? { x: m.d.y, y: -m.d.x } : { x: -m.d.y, y: m.d.x };
          return ends.some(
            (e) =>
              !group.includes(e) &&
              e.d.x * m.d.x + e.d.y * m.d.y > NEIGHBOUR &&
              e.d.x * toward.x + e.d.y * toward.y > 0,
          );
        });
        if (!ins.length || !outs.length || !junction || crowded) continue;
        formed.push({ node, ins, outs });
      }
      return formed;
    };
    // The arms of a crossing that converge without overlapping beyond their cuts join only where
    // a pair of the node that does overlap is split itself (n:104's west arm, not n:1303's
    // carriageway forking away beside an unsplit pair).
    const strict = form(joined);
    const chosen = strict.length ? form([...joined, ...quiet]) : strict;
    for (const g of chosen) {
      groups.push(g);
      for (const e of [...g.ins, ...g.outs]) grouped.add(key(e.road.idx, e.incoming));
    }
  }
  // A member running straight on (on 20 m chords, as TASK-083 pairs through roads) into a road
  // that is not split, whose lanes would jog by more than 5 m across the node, keeps its pair as
  // drawn (Sindelfingen n:78: the 4-lane r:1061 into r:80), the jog measured between the lanes
  // that join (`laneStep`).
  const chord = (road: CRoad, incoming: boolean) => {
    const near = outwardFrame(references[road.idx]!, incoming, 0).p;
    const far = outwardFrame(references[road.idx]!, incoming, Math.min(20, length(road.idx) / 2)).p;
    const l = Math.hypot(far.x - near.x, far.y - near.y) || 1;
    return { x: (far.x - near.x) / l, y: (far.y - near.y) / l };
  };
  // The lateral step, to the right of travel, from the lanes of `from` that continue into `to`
  // across `node` to the lanes they enter, as their lines are drawn: the lanes the node's lane
  // turn rules name (TASK-093, n:967: the 4-lane r:248's two right lanes into r:1276, beside its two
  // left-turn lanes), else the median-side edges (through movements pair lanes from the median,
  // architecture 5.2).
  const laneStep = (node: CNode, from: number, to: number) => {
    const [a, b] = [sources[from]!, sources[to]!];
    const rules = sourceNodes[node.idx]!.turnRules.filter(
      (r) =>
        r.allowed &&
        r.from === a.id &&
        r.to === b.id &&
        r.fromLane !== undefined &&
        r.toLane !== undefined,
    );
    if (rules.length)
      return (
        rules.reduce((sum, r) => sum + laneOffset(b, r.toLane!) - laneOffset(a, r.fromLane!), 0) /
        rules.length
      );
    return b.lateralOffsetM - a.lateralOffsetM - (sigma * (roadWidth(b) - roadWidth(a))) / 2;
  };
  const blockEdge = (set: ConvergingEnd[]) =>
    sigma > 0
      ? Math.min(
          ...set.map(
            (e) => sources[e.road.idx]!.lateralOffsetM - roadWidth(sources[e.road.idx]!) / 2,
          ),
        )
      : Math.max(
          ...set.map(
            (e) => sources[e.road.idx]!.lateralOffsetM + roadWidth(sources[e.road.idx]!) / 2,
          ),
        );
  const jogging = groups.filter(({ node, ins, outs }) =>
    [...ins, ...outs].some((m) => {
      const f = outwardFrame(references[m.road.idx]!, m.incoming, 0);
      const n = m.incoming ? { x: -f.n.x, y: -f.n.y } : f.n;
      const off = (f.p.x - node.pos.x) * n.x + (f.p.y - node.pos.y) * n.y;
      const shift = (sigma * MEDIAN_M) / 2 - blockEdge(m.incoming ? ins : outs) - off;
      const t = chord(m.road, m.incoming);
      return incident[node.idx]!.some((e) => {
        const incoming = e.to === node.idx;
        if (e.from === e.to || incoming === m.incoming || grouped.has(key(e.idx, incoming)))
          return false;
        const d = chord(e, incoming);
        if (d.x * t.x + d.y * t.y > -ALONG) return false;
        const jog = m.incoming
          ? laneStep(node, m.road.idx, e.idx) - shift
          : laneStep(node, e.idx, m.road.idx) + shift;
        return Math.abs(jog) > 5;
      });
    }),
  );
  for (const g of jogging) {
    groups.splice(groups.indexOf(g), 1);
    for (const e of [...g.ins, ...g.outs]) grouped.delete(key(e.road.idx, e.incoming));
  }
  const result = groups.map(({ node, ins, outs }) => ({
    node: node.idx,
    ins: ins.map((e) => e.road.idx),
    outs: outs.map((e) => e.road.idx),
  }));
  chained = true;
  const empty = new Float64Array(0);
  const medianEdge = (road: number, shift: number) =>
    sources[road]!.lateralOffsetM + shift - (sigma * roadWidth(sources[road]!)) / 2;
  const shifts = new Map<string, Float64Array>();
  // B43: a divided pair (one corridor, both blocks off their lines by over half the median)
  // meeting a node side by side keeps its median there (its own 40 m out where the pair runs
  // together there, else the median its offsets give): where TASK-083's through alignments end
  // its two lines apart (each continues a different road), both take half the difference just
  // beyond the cuts, eased over the taper.
  for (const node of nodes) {
    const ends = incident[node.idx]!.filter((r) => r.from !== r.to);
    for (const c of ends)
      for (const b of ends) {
        if (c.to !== node.idx || b.from !== node.idx || c === b) continue;
        if (grouped.has(key(c.idx, true)) || grouped.has(key(b.idx, false))) continue;
        const [sc, sb] = [sources[c.idx]!, sources[b.idx]!];
        if (!sc.corridorId || sc.corridorId !== sb.corridorId) continue;
        const nominal =
          sigma * (sc.lateralOffsetM + sb.lateralOffsetM) - (roadWidth(sc) + roadWidth(sb)) / 2;
        if (
          Math.abs(sc.lateralOffsetM) - roadWidth(sc) / 2 <= 0.1 ||
          Math.abs(sb.lateralOffsetM) - roadWidth(sb) / 2 <= 0.1
        )
          continue;
        const ce = { road: c, incoming: true, d: outwardFrame(references[c.idx]!, true, 0).t };
        const be = { road: b, incoming: false, d: outwardFrame(references[b.idx]!, false, 0).t };
        if (ce.d.x * be.d.x + ce.d.y * be.d.y < CONVERGING) continue;
        // Measured just beyond the cuts, where the lanes start.
        const at =
          Math.max(...[c, b].map((r) => setbacks[node.idx]![incident[node.idx]!.indexOf(r)]!)) +
          OVERLAP_PROBE_M;
        const gap = MEDIAN_M - measure(ce, be, at).shortfall;
        // The median it keeps: its own 40 m out where the pair still runs together there.
        const out = MEDIAN_M - measure(ce, be, at + 40).shortfall;
        const target = out < 1 ? out : nominal;
        const taper = Math.min(taperLength(sc), taperLength(sb));
        const shape = holdRamp(1, 0, taper);
        const there = shape[Math.round(at / SHIFT_STEP_M)] ?? 0;
        if (there < 0.5) continue;
        const half = (target - gap) / 2 / there;
        if (Math.abs(half) < 0.01) continue;
        shifts.set(key(c.idx, true), trimmed(shape.map((v) => sigma * half * v)));
        shifts.set(key(b.idx, false), trimmed(shape.map((v) => sigma * half * v)));
      }
  }
  const atNode = (road: number, incoming: boolean) =>
    shiftAt(
      {
        startShift: shifts.get(key(road, false)) ?? empty,
        endShift: shifts.get(key(road, true)) ?? empty,
      },
      incoming ? length(road) : 0,
      length(road),
    );
  for (const { node, ins, outs } of groups) {
    const all = [...ins, ...outs];
    // Along each end's chain: to its end where that converges at its far node too (the two
    // nodes' shifts meet there, the larger kept, so the pair never closes in between), to a
    // taper and the cut short of a far junction (to the junction itself on a road too
    // short to hold and ease before it), else to a taper short of the chain's end.
    const limit = Math.min(
      CONVERGE_REACH_M,
      ...all.map(({ road, incoming }) => {
        const chain = chainOf(road.idx, incoming);
        const last = chain.roads.at(-1)!;
        if (grouped.has(key(last, !incoming))) return chain.length;
        const far = farNode(last, incoming);
        const ends = incident[far]!.filter((r) => r.from !== r.to).length;
        const taperLast = taperLength(sources[last]!);
        if (ends === 2) return chain.length - taperLast - 5;
        // At a far junction that does not shift the road, eased out before its cut (as cut
        // without shifts) where the road leaves room to hold and ease first; a shorter road keeps
        // its shift to the far end, where that junction's polygon takes it.
        const cut = setbacks[far]![incident[far]!.findIndex((r) => r.idx === last)]!;
        const eased = chain.length - taperLast - cut;
        return eased >= MOUTH_M + 2 * taperLast ? eased : chain.length;
      }),
    );
    const needed: number[] = [];
    for (let d = 0; d <= Math.max(0, limit) + 1e-9; d += SHIFT_STEP_M)
      needed.push(Math.max(0, ...ins.flatMap((a) => outs.map((b) => measure(a, b, d).shortfall))));
    // Once the blocks part they are done: where they close in again farther on (a pair meeting
    // again at another junction through other roads), that junction sets them apart.
    // Nor past where a pair crosses over (each block on the other's side, a source defect).
    const crossed = needed.findIndex((_, i) =>
      ins.some((a) => outs.some((b) => measure(a, b, i * SHIFT_STEP_M).centres < -1)),
    );
    if (crossed > 0) needed.fill(0, crossed);
    // Two converging junctions can still overlap between them. Each end owns its side of
    // the narrowest gap; the far junction's rising demand must not hold this end open.
    let sharedValley = false;
    if (
      !needed.some((v) => v <= TOUCH_M) &&
      all.every(({ road, incoming }) => {
        const last = chainOf(road.idx, incoming).roads.at(-1)!;
        return grouped.has(key(last, !incoming));
      })
    ) {
      const valley = needed.reduce((best, value, i) => (value < needed[best]! ? i : best), 0);
      if (valley > 0 && needed.at(-1)! > needed[valley]! + TOUCH_M) {
        needed.fill(needed[valley]!, valley + 1);
        sharedValley = true;
      }
    }
    // TASK-099: blocks within `TOUCH_M` of the median have parted (the importer's pull leaves
    // attached carriageways at the median to a few centimetres either way).
    const parted = needed.findIndex((v) => v <= TOUCH_M);
    if (parted > 0) needed.fill(0, parted);
    const taper = Math.min(...all.map(({ road }) => taperLength(sources[road.idx]!)));
    // Owner (TASK-089, the n:104 sketch): each side's lane block gets its own end at the node, its
    // median-side edge half the median off the node point to its side, so its lanes keep their
    // place into the junction; held across the junction mouth and eased away from the node over
    // the taper. Where the pair still overlaps beyond, the rest of the shortfall is shared by half
    // width plus half the median.
    const share = (set: ConvergingEnd[]) =>
      set.reduce((w, { road }) => w + roadWidth(sources[road.idx]!), 0) / 2 + MEDIAN_M / 2;
    const [shareIn, shareOut] = [share(ins), share(outs)];
    const portion = (incoming: boolean) => (incoming ? shareIn : shareOut) / (shareIn + shareOut);
    const edge = (set: ConvergingEnd[]) =>
      sigma > 0
        ? Math.min(
            ...set.map(
              (e) => sources[e.road.idx]!.lateralOffsetM - roadWidth(sources[e.road.idx]!) / 2,
            ),
          )
        : Math.max(
            ...set.map(
              (e) => sources[e.road.idx]!.lateralOffsetM + roadWidth(sources[e.road.idx]!) / 2,
            ),
          );
    // The shift putting a member's side's median edge half the median off the node point.
    const atTheNode = (e: ConvergingEnd) => {
      const f = outwardFrame(references[e.road.idx]!, e.incoming, 0);
      const n = e.incoming ? { x: -f.n.x, y: -f.n.y } : f.n;
      const off = (f.p.x - node.pos.x) * n.x + (f.p.y - node.pos.y) * n.y;
      return (sigma * MEDIAN_M) / 2 - edge(e.incoming ? ins : outs) - off;
    };
    const hold = Math.max(0, Math.min(MOUTH_M, limit - taper));
    const total = sigma * (atTheNode(ins[0]!) + atTheNode(outs[0]!));
    // The split the pair needs from the node out: its full split held over the mouth and eased
    // over the taper, and no less than the shortfall anywhere farther out (its non-increasing
    // envelope), eased by two trailing means: never increasing, so no lane edge turns back.
    const envelope = needed.map((v) => Math.max(0, v));
    for (let i = envelope.length - 2; i >= 0; i--)
      envelope[i] = Math.max(envelope[i]!, envelope[i + 1]!);
    // TASK-093 (B49, n:967): a pair converging onto the node at so shallow an angle that it still
    // overlaps a taper beyond the mouth, where holding the full split would open a median void
    // narrower than `MEDIAN_VOID_M` that closes again farther out, follows its shortfall from the
    // node instead (a centred mean, exact where the shortfall changes linearly, as two
    // carriageways meeting at an angle do, and never below it), so the carriageways run attached
    // at the median up to the junction; a shortfall left where the shift must have eased out
    // (`limit`, at most 1 m) eases out linearly over the taper beyond. Not a pair that needs more
    // farther out than at the node.
    const atMouth = envelope[Math.round(hold / SHIFT_STEP_M)] ?? 0;
    const overlapM = (parted < 0 ? needed.length : parted) * SHIFT_STEP_M;
    // TASK-099 (B54): a pair whose source lines run attached, within half the median of it, for a
    // taper beyond where its blocks part (the importer's `attachCarriageways` closed the median
    // there) follows its shortfall exactly, without a hold, an envelope or a mean: the split and
    // the importer's pull then meet where both are zero and the facing edges run on at the median
    // as one line. What the node needs beyond the shortfall there (nothing where both lines end at
    // the node point) eases out over the taper.
    const runsAttached =
      parted > 0 &&
      Array.from(
        { length: Math.round(taper / SHIFT_STEP_M) },
        (_, k) => (parted + k) * SHIFT_STEP_M,
      ).every(
        (d) =>
          d <= limit &&
          ins.every((a) => outs.every((b) => Math.abs(measure(a, b, d).shortfall) <= MEDIAN_M / 2)),
      );
    const attached =
      runsAttached ||
      (overlapM > hold + taper &&
        (envelope.at(-1)! <= 1 || sharedValley) &&
        total - atMouth < MEDIAN_VOID_M &&
        envelope[0]! - needed[0]! <= MEDIAN_M / 2);
    const held = holdRamp(1, attached ? 0 : hold, taper);
    const size = Math.max(held.length, envelope.length) + Math.ceil(taper / SHIFT_STEP_M) + 2;
    const tail = (i: number) =>
      attached
        ? envelope.at(-1)! * Math.max(0, 1 - ((i - envelope.length + 1) * SHIFT_STEP_M) / taper)
        : 0;
    const raw = Array.from({ length: size }, (_, i) =>
      runsAttached
        ? (needed[i] ?? 0) + Math.max(0, total - needed[0]!) * (held[i] ?? 0)
        : Math.max(envelope[i] ?? tail(i), Math.max(0, total) * (held[i] ?? 0)),
    );
    const split = runsAttached
      ? centredMean(raw, 4)
      : attached
        ? centredMean(raw, taper / 2).map((v, i) => Math.max(v, raw[i]!))
        : trailingMean(trailingMean(raw, taper / 2), taper / 2);
    // Each side's shift never turns back. A side whose end moves toward the other at the node
    // (its line ends beyond its place) eases that move out over the hold; the other takes the
    // rest of the split. Where both move apart, each takes its end's share of the split all
    // along. Where the pair needs more farther out than at the node, its ends at the node are
    // that much farther apart (a wider median there).
    const values = new Map(all.map((e) => [e, sigma * atTheNode(e)]));
    const [vIn, vOut] = [values.get(ins[0]!)!, values.get(outs[0]!)!];
    const profileOf = (e: ConvergingEnd) => {
      const v = values.get(e)!;
      const other = e.incoming ? vOut : vIn;
      const own = (i: number) =>
        total <= 0.05
          ? v * (held[i] ?? 0) + portion(e.incoming) * split[i]!
          : v < 0
            ? v * (held[i] ?? 0)
            : other < 0
              ? split[i]! - other * (held[i] ?? 0)
              : (v * split[i]!) / total;
      return Array.from({ length: size }, (_, i) => sigma * own(i));
    };
    for (const e of all) {
      const { road, incoming } = e;
      const chain = chainOf(road.idx, incoming);
      const side = profileOf(e);
      chain.roads.forEach((r, k) => {
        const part = side.slice(Math.round(chain.offsets[k]! / SHIFT_STEP_M));
        if (part.some((v) => Math.abs(v) > 1e-6)) shifts.set(key(r, incoming), trimmed(part));
      });
    }
  }
  // A through continuation of a shifted end that is not shifted itself takes the shift that lines
  // its median-side edge up with the shifted end's at the node, eased over its own taper; a jog
  // within half the median is left to the through movement.
  for (const node of nodes)
    for (const pair of through[node.idx]!)
      for (const [member, other, otherIncoming] of [
        [pair.from, pair.to, false],
        [pair.to, pair.from, true],
      ] as const) {
        const shift = atNode(member, !otherIncoming);
        if (Math.abs(shift) < 1e-6 || Math.abs(atNode(other, otherIncoming)) > 1e-6) continue;
        const jog = medianEdge(member, shift) - medianEdge(other, 0);
        if (Math.abs(jog) <= MEDIAN_M / 2 + 0.01) continue;
        // A direction of a two-way street never moves, onto its other direction or (TASK-093) away
        // from it, opening their centre line; nor a carriageway whose street's other carriageway
        // meets the node beside it (within 45 degrees).
        if (sources[other]!.streetGroupId !== null) continue;
        const d = outwardFrame(references[other]!, otherIncoming, 0).t;
        if (
          incident[node.idx]!.some((e) => {
            if (e.idx === other || e.from === e.to || (e.to === node.idx) === otherIncoming)
              return false;
            const t = outwardFrame(references[e.idx]!, e.to === node.idx, 0).t;
            return (
              sameStreet(sources[other]!, sources[e.idx]!) && t.x * d.x + t.y * d.y >= CONVERGING
            );
          })
        )
          continue;
        shifts.set(
          key(other, otherIncoming),
          trimmed(holdRamp(jog, 0, taperLength(sources[other]!))),
        );
      }
  // TASK-093 (B47, n:212, n:55): a street continuing straight across a node (each end the other's
  // most nearly opposite, within 30 degrees) with another lane count or other directions on the
  // far side (a one-way lane into a two-way street) lines up the lanes that join (`laneStep`)
  // instead of the centre lines. The road with fewer lanes on its arm (its own and its street's
  // other direction there; then fewer of its own) takes the step, held to its cut and eased over
  // its TASK-080 taper. Not where either end is shifted already, nor between two one-way roads at
  // a node of two road ends (a TASK-071 continuation), nor beside a split's or merge's branch or
  // the road's own other carriageway, nor a direction of a two-way street (it would part from
  // its other direction), nor a step steeper than 1 in 4 over the taper.
  const sameName = (x: Road, y: Road) =>
    x.name !== null ? x.name === y.name : y.name === null && x.roadClass === y.roadClass;
  const nodeOffset = (node: CNode, road: CRoad, incoming: boolean) => {
    const f = outwardFrame(references[road.idx]!, incoming, 0);
    const n = incoming ? { x: -f.n.x, y: -f.n.y } : f.n;
    return (f.p.x - node.pos.x) * n.x + (f.p.y - node.pos.y) * n.y;
  };
  for (const node of nodes) {
    // TASK-131: not across a junction group's member, whose roads keep their OSM lines; the
    // lanes join inside the group.
    if (groupMembers.has(node.idx)) continue;
    const ends = incident[node.idx]!.filter((r) => r.from !== r.to);
    const facing = (a: CRoad, b: CRoad) => {
      const [ta, tb] = [chord(a, true), chord(b, false)];
      return ta.x * tb.x + ta.y * tb.y;
    };
    const reverse = (x: CRoad, y: CRoad) =>
      sources[x.idx]!.streetGroupId !== null &&
      sources[x.idx]!.streetGroupId === sources[y.idx]!.streetGroupId;
    const best = (candidates: CRoad[], score: (r: CRoad) => number) =>
      candidates.reduce<CRoad | undefined>(
        (top, r) => (top === undefined || score(r) < score(top) ? r : top),
        undefined,
      );
    for (const a of ends) {
      if (a.to !== node.idx) continue;
      const b = best(
        ends.filter((r) => r.from === node.idx && !reverse(a, r)),
        (r) => facing(a, r),
      );
      if (!b || facing(a, b) > -ALONG) continue;
      if (
        best(
          ends.filter((r) => r.to === node.idx && !reverse(r, b)),
          (r) => facing(r, b),
        ) !== a
      )
        continue;
      const [sa, sb] = [sources[a.idx]!, sources[b.idx]!];
      if (!sameName(sa, sb)) continue;
      const oneWay = [sa, sb].map((r) => r.streetGroupId === null);
      if (oneWay[0] === oneWay[1] && sa.lanes.length === sb.lanes.length) continue;
      if (oneWay[0] && oneWay[1] && ends.length === 2) continue;
      // Branches of a split or merge beside either road (another end the same way within 60
      // degrees: TASK-071 and TASK-080 set those side by side), or the shifted road's own other
      // carriageway beside it (within 45 degrees), keep the layout as it is.
      const beside = (road: CRoad, incoming: boolean) => {
        const d = chord(road, incoming);
        return ends.some((r) => {
          if (r === road || reverse(r, road)) return false;
          const t = chord(r, r.to === node.idx);
          const cos = t.x * d.x + t.y * d.y;
          return cos >= CONVERGING || ((r.to === node.idx) === incoming && cos >= NEIGHBOUR);
        });
      };
      if (beside(a, true) || beside(b, false)) continue;
      if (Math.abs(atNode(a.idx, true)) > 1e-6 || Math.abs(atNode(b.idx, false)) > 1e-6) continue;
      const step =
        laneStep(node, a.idx, b.idx) + nodeOffset(node, b, false) - nodeOffset(node, a, true);
      if (Math.abs(step) <= 0.1) continue;
      const arm = (road: CRoad) =>
        sources[road.idx]!.lanes.length +
        ends
          .filter((r) => r !== road && reverse(r, road))
          .reduce((sum, r) => sum + sources[r.idx]!.lanes.length, 0);
      const order = arm(a) - arm(b) || sa.lanes.length - sb.lanes.length;
      if (order === 0) continue;
      const [road, incoming, value] = order < 0 ? [a, true, step] : [b, false, -step];
      if (sources[road.idx]!.streetGroupId !== null) continue;
      const taper = taperLength(sources[road.idx]!);
      if (Math.abs(value) > taper / 4) continue;
      const cut = setbacks[node.idx]![incident[node.idx]!.indexOf(road)]!;
      shifts.set(key(road.idx, incoming), trimmed(holdRamp(value, cut, taper)));
    }
  }
  return {
    groups: result,
    shifts: sources.map((_, idx) => ({
      start: shifts.get(key(idx, false)) ?? empty,
      end: shifts.get(key(idx, true)) ?? empty,
    })),
  };
}

/** The roads of a node's converging groups (`convergingShifts`): incoming and outgoing ends. */
export interface ConvergingGroup {
  node: number;
  ins: number[];
  outs: number[];
}

/** Owner (TASK-089, the n:104 sketch): where a street's carriageways converge on a node from both
 * sides, each direction of travel crosses it as one strip: the incoming carriageway of one arm
 * and the outgoing one of the other arm, of one street, join as a through pair (TASK-083's
 * alignment) whatever their angle. By node: [incoming, outgoing] road indices. */
export function convergingFlows(groups: ConvergingGroup[], sources: Road[]): [number, number][][] {
  const flows = new Map<number, [number, number][]>();
  for (const a of groups)
    for (const b of groups) {
      if (a === b || a.node !== b.node) continue;
      const [from, to] = [a.ins[0], b.outs[0]];
      if (from === undefined || to === undefined) continue;
      if (!sameStreet(sources[from]!, sources[to]!)) continue;
      flows.set(a.node, [...(flows.get(a.node) ?? []), [from, to]]);
    }
  return [...flows].reduce<[number, number][][]>((list, [node, pairs]) => {
    list[node] = pairs;
    return list;
  }, []);
}
