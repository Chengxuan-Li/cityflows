import { compile } from '../../network';
import { generateGroupSignalProgram, generateSignalProgram } from '../../network/signal-program';
import { allocateId } from '../../schema';
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

/**
 * TASK-131: regroups nodes. `groups` replace `removed` (group ids); `freed` nodes leave their
 * group. A signalised group (one with a signal among the joined) gets a generated program over
 * its chains; a freed node of a signalised group gets its own, as setting a node to signal does.
 */
function regroup(
  city: City,
  removed: JunctionGroup[],
  groups: { nodes: string[]; signalised: boolean }[],
  freed: { node: string; signalised: boolean }[],
): CommandPatch {
  const draftCity = { ...city, nextId: city.nextId };
  const placeholder: SignalProgram = {
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [{ durationS: 30, groups: [] }],
  };
  const patch: CommandPatch = {
    set: { nodes: {}, junctionGroups: {} },
    remove: { junctionGroups: removed.map((g) => g.id) },
  };
  const created = groups.map(({ nodes, signalised }) => {
    const id = allocateId(draftCity, 'jg');
    const set = new Set(nodes);
    const group: JunctionGroup = {
      id,
      nodes: [...nodes].sort(),
      innerRoads: Object.values(city.roads)
        .filter((r) => set.has(r.from) && set.has(r.to))
        .map((r) => r.id)
        .sort(),
      signal: signalised ? placeholder : null,
      provenance: { source: 'authored' },
    };
    patch.set.junctionGroups![id] = group;
    for (const node of nodes)
      patch.set.nodes![node] = signalised
        ? { ...city.nodes[node]!, control: 'signal', signal: null, minorRoads: [] }
        : city.nodes[node]!.control === 'signal'
          ? { ...city.nodes[node]!, control: 'uncontrolled', signal: null }
          : city.nodes[node]!;
    return group;
  });
  for (const { node, signalised } of freed)
    patch.set.nodes![node] = signalised
      ? { ...city.nodes[node]!, control: 'signal', signal: placeholder }
      : city.nodes[node]!;
  patch.nextId = draftCity.nextId;
  const draft = applyPatch(city, patch);
  const result = compile(draft);
  if (!result.ok) return patch;
  for (const group of created)
    if (group.signal)
      patch.set.junctionGroups![group.id] = {
        ...group,
        signal: generateGroupSignalProgram(group.id, result.compiled, []),
      };
  for (const { node, signalised } of freed)
    if (signalised)
      patch.set.nodes![node] = {
        ...patch.set.nodes![node]!,
        signal: generateSignalProgram(
          draft,
          draft.nodes[node]!,
          Object.values(draft.roads).filter((r) => r.to === node).length,
          result.compiled,
          [],
        ),
      };
  return patch;
}

/** TASK-131: joins two junctions (nodes or the groups they belong to) into one group. */
export function joinJunctions(city: City, [a, b]: [string, string]): CommandPatch {
  const ga = groupOf(city, a),
    gb = groupOf(city, b);
  if (ga && ga === gb) return { set: {}, remove: {} };
  const nodes = [...(ga?.nodes ?? [a]), ...(gb?.nodes ?? [b])];
  const signalised =
    !!ga?.signal || !!gb?.signal || nodes.some((n) => city.nodes[n]!.control === 'signal');
  return regroup(
    city,
    [ga, gb].filter((g) => g !== undefined),
    [{ nodes, signalised }],
    [],
  );
}

/** TASK-131: takes a node out of its group; a group left with one node dissolves. */
export function leaveJunctionGroup(city: City, nodeId: string): CommandPatch {
  const group = groupOf(city, nodeId);
  if (!group) return { set: {}, remove: {} };
  const signalised = group.signal !== null;
  const rest = group.nodes.filter((n) => n !== nodeId);
  return regroup(
    city,
    [group],
    rest.length > 1 ? [{ nodes: rest, signalised }] : [],
    [nodeId, ...(rest.length > 1 ? [] : rest)].map((node) => ({ node, signalised })),
  );
}
