import type { City, Node, Road, SignalProgram } from '../schema';
import { memberPairs } from './groups';
import type { CompiledCity, Diagnostic } from './types';

/** Travel heading of `road` at its end (`end`) or start. */
function roadHeading(road: Road, end: boolean): number {
  const points = road.centerline;
  const a = points[end ? points.length - 2 : 0]!;
  const b = points[end ? points.length - 1 : 1]!;
  return Math.atan2(b.y - a.y, b.x - a.x);
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
 * the member-node road pairs of its chains (as `memberProgram` compiles them), so the conflicts
 * are checked over every movement those road pairs hold at every member.
 */
export function generateGroupSignalProgram(
  city: City,
  groupId: string,
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
): SignalProgram {
  const group = compiled.groups![compiled.index.group!.get(groupId)!]!;
  const units = new Map<string, Unit>();
  for (const chain of group.chains) {
    const key = `${chain.from}>${chain.to}`;
    if (units.has(key)) continue;
    const members = group.nodes.flatMap((n) => {
      const pairs = new Set(memberPairs(compiled, group, n, chain.from, chain.to));
      return compiled.nodes[n]!.movements.filter((m) => {
        const movement = compiled.movements[m]!;
        return pairs.has(
          `${compiled.roads[compiled.lanes[movement.fromLane]!.road]!.id}>${compiled.roads[compiled.lanes[movement.toLane]!.road]!.id}`,
        );
      });
    });
    const left = group.chains.some(
      (c) =>
        c.from === chain.from &&
        c.to === chain.to &&
        c.movements.some((m) => ['left', 'uturn'].includes(compiled.movements[m]!.turn)),
    );
    units.set(key, {
      from: compiled.roads[chain.from]!.id,
      to: compiled.roads[chain.to]!.id,
      members,
      left,
    });
  }
  const ordered = [...units.entries()]
    .sort(([a], [b]) => {
      const [af, at] = a.split('>').map(Number) as [number, number];
      const [bf, bt] = b.split('>').map(Number) as [number, number];
      return af - bf || at - bt;
    })
    .map(([, unit]) => unit);
  return phasesFor(city, groupId, ordered, group.entries.length, compiled, diagnostics);
}

function phasesFor(
  city: City,
  label: string,
  groups: Unit[],
  approachCount: number,
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
): SignalProgram {
  const program: SignalProgram = { offsetS: 0, amberS: 3, allRedS: 1, phases: [] };
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
      members.some((index) => compiled.movements[index]!.conflicts.some((other) => own.has(other)))
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
        compiled.movements[index]!.conflicts.every((other) => !assigned[phase]!.has(other)),
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
