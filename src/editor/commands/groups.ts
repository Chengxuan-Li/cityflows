import { compile } from '../../network';
import { generateSignalProgram } from '../../network/signal-program';
import type { City, Command, JunctionGroup, Node, SignalProgram } from '../../schema';
import { applyPatch } from '../patch';
import type { CommandPatch } from './types';

export function groupOf(city: City, nodeId: string): JunctionGroup | undefined {
  return Object.values(city.junctionGroups ?? {}).find((group) => group.nodes.includes(nodeId));
}

/**
 * TASK-131: a topology edit (`patch`) that sets or removes a member node, an inner road or a road
 * ending at a member (before or after the edit) dissolves that junction group. Each remaining
 * member of a signalised group gets its own generated program, as setting a node to signal does.
 */
export function dissolveTouched(city: City, patch: CommandPatch): CommandPatch {
  const touchedNodes = new Set([
    ...Object.keys(patch.set.nodes ?? {}),
    ...(patch.remove.nodes ?? []),
  ]);
  const touchedRoads = new Set([
    ...Object.keys(patch.set.roads ?? {}),
    ...(patch.remove.roads ?? []),
  ]);
  const ends = new Set(
    [...touchedRoads].flatMap((id) => {
      const before = city.roads[id];
      const after = patch.set.roads?.[id];
      return [before?.from, before?.to, after?.from, after?.to].filter((n) => n !== undefined);
    }),
  );
  const dissolved = Object.values(city.junctionGroups ?? {}).filter((group) =>
    group.nodes.some((id) => touchedNodes.has(id) || ends.has(id)),
  );
  if (!dissolved.length) return patch;
  const next: CommandPatch = {
    ...patch,
    set: { ...patch.set, nodes: { ...patch.set.nodes } },
    remove: {
      ...patch.remove,
      junctionGroups: [...(patch.remove.junctionGroups ?? []), ...dissolved.map((g) => g.id)],
    },
  };
  const removed = new Set(patch.remove.nodes ?? []);
  const members = dissolved
    .filter((group) => group.signal)
    .flatMap((group) => group.nodes.filter((id) => !removed.has(id)));
  if (!members.length) return next;
  const placeholder: SignalProgram = {
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [{ durationS: 30, groups: [] }],
  };
  const current = (id: string): Node => next.set.nodes![id] ?? city.nodes[id]!;
  for (const id of members) next.set.nodes![id] = { ...current(id), signal: placeholder };
  const draft = applyPatch(city, next);
  const result = compile(draft);
  if (!result.ok) return next;
  for (const id of members) {
    const node = current(id);
    const incoming = Object.values(draft.roads).filter((road) => road.to === id).length;
    next.set.nodes![id] = {
      ...node,
      signal: generateSignalProgram(draft, node, incoming, result.compiled, []),
    };
  }
  return next;
}

/** TASK-131: a control change on a member node applies to its whole junction group: signal
 * control gives the group the program (one of its own), any other control removes the group's
 * program and sets every member to it. */
export function editGroupControl(
  city: City,
  group: JunctionGroup,
  command: Extract<Command, { kind: 'setControl' | 'setSignal' }>,
): CommandPatch {
  const signal =
    command.kind === 'setSignal' || command.control === 'signal'
      ? (command.signal ?? group.signal)
      : null;
  if (command.kind === 'setControl' && command.control === 'signal' && !signal)
    throw new Error(`Signal control for ${group.id} needs a program`);
  const control = command.kind === 'setSignal' ? 'signal' : command.control;
  const nodes = Object.fromEntries(
    group.nodes.map((id) => {
      const node = city.nodes[id]!;
      const minor =
        command.kind === 'setControl' && (control === 'yield' || control === 'stop')
          ? (command.minorRoads ?? node.minorRoads).filter((road) => city.roads[road]?.to === id)
          : [];
      return [id, { ...node, control, signal: null, minorRoads: minor }];
    }),
  );
  return {
    set: { nodes, junctionGroups: { [group.id]: { ...group, signal } } },
    remove: {},
  };
}
