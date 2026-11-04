import type { CompiledCity, Diagnostic } from '../network';
import type { City, Node, SignalProgram } from '../schema';
import { roadHeading } from './osm/turns';

export function generateSignalProgram(
  city: City,
  node: Node,
  approachCount: number,
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
): SignalProgram {
  const movements = compiled.nodes[compiled.index.node.get(node.id)!]!.movements;
  const groups = new Map<string, { from: string; to: string; members: number[]; left: boolean }>();
  const approaches = new Set<string>();
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
    approaches.add(from);
  }

  const program: SignalProgram = { offsetS: 0, amberS: 3, allRedS: 1, phases: [] };
  const assigned: Set<number>[] = [];
  const addPhase = (durationS: number) => {
    assigned.push(new Set());
    program.phases.push({ durationS, groups: [] });
    return assigned.length - 1;
  };
  addPhase(30);
  addPhase(30);

  const first = approaches.values().next().value;
  const axis = first === undefined ? 0 : roadHeading(city.roads[first]!, true);
  const protectLeft = approachCount >= 4;
  for (const { from, to, members, left } of groups.values()) {
    const own = new Set(members);
    if (
      members.some((index) => compiled.movements[index]!.conflicts.some((other) => own.has(other)))
    ) {
      // The canonical signal can only switch a whole road pair together.
      diagnostics.push({
        severity: 'warning',
        code: 'osm_signal_group_conflict',
        refs: [node.id, from, to],
        message: `Signal ${node.id} cannot serve conflicting lanes from ${from} to ${to} as one group`,
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
