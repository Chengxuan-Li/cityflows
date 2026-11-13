import type { City, Node, Road, SignalProgram } from '../schema';
import { memberPairs } from './groups';
import { intoInnerLane } from './signals';
import type { CompiledCity, Diagnostic } from './types';

/** Travel heading of `road` at its end (`end`) or start. */
function roadHeading(road: Road, end: boolean): number {
  const points = road.centerline;
  const a = points[end ? points.length - 2 : 0]!;
  const b = points[end ? points.length - 1 : 1]!;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** TASK-170: generated programs split their green by demand when a run loads; their phases'
 * durations are the split's total and the fallback. */
export const GENERATED_TIMING: Pick<SignalProgram, 'demandSplit' | 'actuated'> = {
  demandSplit: true,
  actuated: true,
};

/** TASK-170: the shortest green a demand split or an actuated controller gives a phase. */
export const MIN_GREEN_S = 5;
/** TASK-170: the share of each phase's own green a demand split keeps: the free-flow demand
 * misses the traffic that congestion moves onto other approaches. */
export const SPLIT_FLOOR_SHARE = 0.5;

/**
 * TASK-170: a program's green time `totalS` split by demand (architecture section 5.4).
 * `served[g]` lists the phases in which green group g is green, `load[g]` its expected flow per
 * lane, and `minS[p]` phase p's minimum green. Webster's rule, equal degrees of saturation, for
 * phases that share green groups: from the minimums, each further second goes to the green group
 * with the least green per unit of load, in its phase with the least green. A green group green
 * in every phase gets the whole green whatever the split, so it is left out. Null when no green
 * group carries load or the minimums exceed `totalS`: the program's own split stands.
 */
export function demandSplit(
  served: readonly number[][],
  load: readonly number[],
  minS: readonly number[],
  totalS: number,
): number[] | null {
  const loaded = load.flatMap((l, g) =>
    l > 0 && served[g]!.length && served[g]!.length < minS.length ? [g] : [],
  );
  const green = [...minS];
  let left = totalS - green.reduce((sum, s) => sum + s, 0);
  if (!loaded.length || left < -1e-9) return null;
  const share = (g: number) => served[g]!.reduce((sum, p) => sum + green[p]!, 0) / load[g]!;
  while (left > 1e-9) {
    const worst = loaded.reduce((a, g) => (share(g) < share(a) ? g : a));
    const phase = served[worst]!.reduce((a, p) => (green[p]! < green[a]! ? p : a));
    const step = Math.min(1, left);
    green[phase] = green[phase]! + step;
    left -= step;
  }
  return green;
}

/** One green group: the movements a road pair (`from` to `to`, road ids) switches together. */
interface Unit {
  from: string;
  to: string;
  members: number[];
  left: boolean;
}

export function generateSignalProgram(
  city: City,
  node: Node,
  approachCount: number,
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
): SignalProgram {
  const movements = compiled.nodes[compiled.index.node.get(node.id)!]!.movements;
  const groups = new Map<string, Unit>();
  for (const index of movements) {
    const movement = compiled.movements[index]!;
    const from = compiled.roads[compiled.lanes[movement.fromLane]!.road]!.id;
    const to = compiled.roads[compiled.lanes[movement.toLane]!.road]!.id;
    const key = `${from}>${to}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        from,
        to,
        members: [],
        left: movement.turn === 'left' || movement.turn === 'uturn',
      };
      groups.set(key, group);
    }
    group.members.push(index);
  }
  return phasesFor(city, node.id, [...groups.values()], approachCount, compiled, diagnostics);
}

/**
 * TASK-131: a junction group's program. Its green groups are entry-to-exit pairs; each switches
 * the member-node road pairs of its chains (as `memberProgram` compiles them).
 *
 * TASK-161: movements from inner roads are green in every phase, so a green group's chains run
 * on through the group whatever else is green. Two green groups share a phase only if no movement
 * on one's chains conflicts with a movement on the other's, inner movements included: the stream
 * a phase releases into an inner road stops whenever a green group that crosses it is green.
 * The phases are the fewest that separate every crossing pair; each green group then joins every
 * other phase it fits, and the phases share the green time evenly.
 */
export function generateGroupSignalProgram(
  groupId: string,
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
): SignalProgram {
  const group = compiled.groups![compiled.index.group!.get(groupId)!]!;
  const inner = new Set(group.innerRoads);
  const roadId = (lane: number) => compiled.roads[compiled.lanes[lane]!.road]!.id;
  const units = new Map<string, GroupUnit>();
  for (const chain of group.chains) {
    const key = `${chain.from}>${chain.to}`;
    let unit = units.get(key);
    if (!unit) {
      const pairs = new Map(
        group.nodes.map((n) => [n, new Set(memberPairs(compiled, group, n, chain.from, chain.to))]),
      );
      unit = {
        from: compiled.roads[chain.from]!.id,
        to: compiled.roads[chain.to]!.id,
        entry: chain.from,
        exit: chain.to,
        // The movements the green switches: those of its road pairs from outside the group.
        members: group.nodes.flatMap((n) =>
          compiled.nodes[n]!.movements.filter((m) => {
            const movement = compiled.movements[m]!;
            return (
              !inner.has(compiled.lanes[movement.fromLane]!.road) &&
              pairs.get(n)!.has(`${roadId(movement.fromLane)}>${roadId(movement.toLane)}`)
            );
          }),
        ),
        path: new Set(),
        chains: [],
      };
      units.set(key, unit);
    }
    unit.chains.push(chain.movements);
  }
  // A chain that passes a member twice circles the group (Munich jg:10787's r:327 to r:1279
  // around its four members, beside the direct through): it is driven only where a lane has no
  // direct way, so it sets the unit's conflicts only when the unit has no direct chain.
  for (const unit of units.values()) {
    const direct = unit.chains.filter(
      (c) => new Set(c.map((m) => compiled.movements[m]!.node)).size === c.length,
    );
    unit.path = new Set([...unit.members, ...(direct.length ? direct : unit.chains).flat()]);
  }
  const ordered = [...units.values()].sort((a, b) => a.entry - b.entry || a.exit - b.exit);
  return groupPhases(groupId, ordered, compiled, diagnostics);
}

interface GroupUnit {
  from: string;
  to: string;
  entry: number;
  exit: number;
  members: number[];
  /** Every movement its green switches or its chains drive, inner ones included. */
  path: Set<number>;
  chains: number[][];
}

/** TASK-161: the longest cycle of a generated group program, intergreens included. */
export const GROUP_CYCLE_MAX_S = 120;

function groupPhases(
  label: string,
  units: GroupUnit[],
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
): SignalProgram {
  const crosses = (a: GroupUnit, b: GroupUnit) =>
    [...a.path].some((m) => {
      const movement = compiled.movements[m]!;
      return movement.conflicts.some((o) => b.path.has(o) && !intoInnerLane(compiled, movement, o));
    });
  const usable = units.filter((unit) => {
    const own = new Set(unit.members);
    const conflicting = unit.members.some((m) =>
      compiled.movements[m]!.conflicts.some(
        (o) => own.has(o) && !intoInnerLane(compiled, compiled.movements[m]!, o),
      ),
    );
    if (conflicting)
      diagnostics.push({
        severity: 'warning',
        code: 'osm_signal_group_conflict',
        refs: [label, unit.from, unit.to],
        message: `Signal ${label} cannot serve conflicting lanes from ${unit.from} to ${unit.to} as one group`,
      });
    return !conflicting;
  });
  const crossing = usable.map((a) => usable.map((b) => a !== b && crosses(a, b)));
  const colour = fewestPhases(crossing);
  const phases: GroupUnit[][] = [];
  usable.forEach((unit, i) => (phases[colour[i]!] ??= []).push(unit));
  // A group none of whose entries reaches an exit still runs a cycle.
  if (!phases.length) phases.push([]);
  // Then each green group joins every other phase none of whose green groups it crosses.
  for (let i = 0; i < usable.length; i++)
    phases.forEach((phase, p) => {
      if (p !== colour[i] && phase.every((o) => !crossing[i]![usable.indexOf(o)]))
        phase.push(usable[i]!);
    });
  // No demand is known, so every entry lane is taken to carry the same flow: every phase then
  // holds a lane with the same flow ratio, and Webster's split gives each phase the same green.
  // 30 s a phase, as a single junction's, within a cycle of `GROUP_CYCLE_MAX_S`.
  const greenS = Math.min(30, Math.floor(GROUP_CYCLE_MAX_S / phases.length) - 4);
  return {
    ...GENERATED_TIMING,
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: phases.map((phase) => ({
      durationS: greenS,
      groups: phase
        .toSorted((a, b) => a.entry - b.entry || a.exit - b.exit)
        .map(({ from, to }) => ({ from, to })),
    })),
  };
}

/**
 * The phase of each green group: a colouring of the crossing graph with the fewest colours, by
 * a search from a first-fit bound in order of degree (a group has a few dozen green groups; the
 * search keeps its best after `budget` steps). Phases are numbered in green group order.
 */
function fewestPhases(crossing: boolean[][], budget = 100_000): number[] {
  const n = crossing.length;
  const degree = crossing.map((row) => row.filter(Boolean).length);
  const order = [...Array(n).keys()].sort((a, b) => degree[b]! - degree[a]! || a - b);
  const colour = new Array<number>(n).fill(-1);
  const free = (u: number, c: number) => crossing[u]!.every((x, v) => !x || colour[v] !== c);
  for (const u of order) {
    let c = 0;
    while (!free(u, c)) c++;
    colour[u] = c;
  }
  let best = [...colour];
  let bestK = Math.max(0, ...colour) + 1;
  colour.fill(-1);
  let steps = 0;
  const search = (i: number, k: number) => {
    if (k >= bestK || steps++ > budget) return;
    if (i === n) {
      best = [...colour];
      bestK = k;
      return;
    }
    const u = order[i]!;
    for (let c = 0; c <= k && c < bestK - 1; c++) {
      if (!free(u, c)) continue;
      colour[u] = c;
      search(i + 1, Math.max(k, c + 1));
      colour[u] = -1;
    }
  };
  search(0, 0);
  // Number the phases by their first green group.
  const first = new Map<number, number>();
  best.forEach((c) => first.has(c) || first.set(c, first.size));
  return best.map((c) => first.get(c)!);
}

function phasesFor(
  city: City,
  label: string,
  groups: Unit[],
  approachCount: number,
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
): SignalProgram {
  const program: SignalProgram = {
    ...GENERATED_TIMING,
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [],
  };
  const assigned: Set<number>[] = [];
  const addPhase = (durationS: number) => {
    assigned.push(new Set());
    program.phases.push({ durationS, groups: [] });
    return assigned.length - 1;
  };
  addPhase(30);
  addPhase(30);

  const first = groups[0]?.from;
  const axis = first === undefined ? 0 : roadHeading(city.roads[first]!, true);
  const protectLeft = approachCount >= 4;
  for (const { from, to, members, left } of groups) {
    const own = new Set(members);
    if (
      members.some((index) =>
        compiled.movements[index]!.conflicts.some(
          (other) => own.has(other) && !intoInnerLane(compiled, compiled.movements[index]!, other),
        ),
      )
    ) {
      // The canonical signal can only switch a whole road pair together.
      diagnostics.push({
        severity: 'warning',
        code: 'osm_signal_group_conflict',
        refs: [label, from, to],
        message: `Signal ${label} cannot serve conflicting lanes from ${from} to ${to} as one group`,
      });
      continue;
    }

    const fits = (phase: number) =>
      members.every((index) =>
        compiled.movements[index]!.conflicts.every(
          (other) =>
            !assigned[phase]!.has(other) ||
            intoInnerLane(compiled, compiled.movements[index]!, other),
        ),
      );
    const angle = roadHeading(city.roads[from]!, true) - axis;
    const preferred = Math.abs(Math.cos(angle)) >= Math.SQRT1_2 ? 0 : 1;
    let phase = preferred;
    if ((protectLeft && left) || !fits(preferred)) {
      // Keep the two opposing-approach phases and add a phase only where needed.
      phase = assigned.findIndex(
        (_, i) => i >= 2 && program.phases[i]!.durationS === (left ? 15 : 30) && fits(i),
      );
      if (phase === -1) phase = addPhase(left ? 15 : 30);
    }
    program.phases[phase]!.groups.push({ from, to });
    members.forEach((index) => assigned[phase]!.add(index));
  }
  return program;
}
