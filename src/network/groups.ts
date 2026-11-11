import type { City, SignalProgram } from '../schema';
import type { CChain, CGroup, CompiledCity, Diagnostic } from './types';

/**
 * TASK-131: the compiled junction groups. A group's entries are the road ends that enter it
 * (roads ending at a member that are not inner roads), its exits the road starts that leave it.
 * A chain is one lane path through the group: the member-node movements from a lane of an entry
 * road, along inner-road lanes, to a lane of an exit road; no lane is visited twice in a chain,
 * the reachability the merged node's turn rules were computed with. Sets `CNode.group` and
 * `CRoad.group`.
 */
export function compileGroups(city: City, compiled: CompiledCity): CGroup[] {
  const groups = Object.keys(city.junctionGroups ?? {})
    .sort()
    .map((id, idx): CGroup => {
      const source = city.junctionGroups![id]!;
      const nodes = source.nodes.map((n) => compiled.index.node.get(n)!).sort((a, b) => a - b);
      const innerRoads = source.innerRoads
        .map((r) => compiled.index.road.get(r)!)
        .sort((a, b) => a - b);
      const members = new Set(nodes);
      const inner = new Set(innerRoads);
      const entries: number[] = [];
      const exits: number[] = [];
      for (const road of compiled.roads) {
        if (inner.has(road.idx)) continue;
        if (members.has(road.to)) entries.push(road.idx);
        if (members.has(road.from)) exits.push(road.idx);
      }
      const exitSet = new Set(exits);
      const chains: CChain[] = [];
      const follow = (from: number, lane: number, path: number[], visited: Set<number>) => {
        for (const m of compiled.lanes[lane]!.out) {
          const toLane = compiled.movements[m]!.toLane;
          const road = compiled.lanes[toLane]!.road;
          if (exitSet.has(road)) chains.push({ from, to: road, movements: [...path, m] });
          else if (inner.has(road) && !visited.has(toLane))
            follow(from, toLane, [...path, m], new Set([...visited, toLane]));
        }
      };
      for (const entry of entries)
        for (const lane of compiled.roads[entry]!.lanes) follow(entry, lane, [], new Set([lane]));
      for (const n of nodes) compiled.nodes[n]!.group = idx;
      for (const r of innerRoads) compiled.roads[r]!.group = idx;
      return { idx, id, nodes, innerRoads, entries, exits, chains, signalised: !!source.signal };
    });
  return groups;
}

/** The road pairs at `node` (`from>to` road ids) of the member movements on the chains from
 * entry road `from` to exit road `to` (road indices). */
export function memberPairs(
  compiled: CompiledCity,
  group: CGroup,
  node: number,
  from: number,
  to: number,
): string[] {
  const pairs = new Set<string>();
  for (const chain of group.chains) {
    if (chain.from !== from || chain.to !== to) continue;
    for (const m of chain.movements) {
      const movement = compiled.movements[m]!;
      if (movement.node !== node) continue;
      pairs.add(
        `${compiled.roads[compiled.lanes[movement.fromLane]!.road]!.id}>${compiled.roads[compiled.lanes[movement.toLane]!.road]!.id}`,
      );
    }
  }
  return [...pairs].sort();
}

/**
 * The program a member node of a signalised group runs: the group's timing, and in each phase
 * the road pairs at the node of the chains its green groups name, so that one green clears a
 * car from the entry to the exit. Walk entries keep those naming a road end at the node.
 * `vehicles[p]` says whether the group's phase p has vehicle groups at all (TASK-111's derived
 * walk green: none in an exclusive pedestrian phase). Invalid green groups are errors. `free`:
 * the movements from inner roads, green in every phase.
 */
export function memberProgram(
  city: City,
  compiled: CompiledCity,
  group: CGroup,
  node: number,
  diagnostics: Diagnostic[],
): { program: SignalProgram; vehicles: boolean[]; free: Set<number> } {
  const program = city.junctionGroups![group.id]!.signal!;
  const id = compiled.nodes[node]!.id;
  // Inner links carry no control (owner, checkpoint 1): a car on one was cleared at the group's
  // entry and drives on, so the movements from inner roads are green in every phase; the
  // amber and all-red clear them, and they never count as a phase conflict.
  const inner = new Set(group.innerRoads);
  const free = new Set(
    compiled.nodes[node]!.movements.filter((m) =>
      inner.has(compiled.lanes[compiled.movements[m]!.fromLane]!.road),
    ),
  );
  const roadId = (lane: number) => compiled.roads[compiled.lanes[lane]!.road]!.id;
  const innerPairs = [...free].map((m) => {
    const movement = compiled.movements[m]!;
    return `${roadId(movement.fromLane)}>${roadId(movement.toLane)}`;
  });
  const phases = program.phases.map(({ durationS, groups, walk }, phase) => {
    const pairs = new Set<string>();
    for (const { from, to } of groups) {
      const entry = compiled.index.road.get(from);
      const exit = compiled.index.road.get(to);
      if (
        entry === undefined ||
        exit === undefined ||
        !group.entries.includes(entry) ||
        !group.exits.includes(exit)
      ) {
        if (node === group.nodes[0])
          diagnostics.push({
            severity: 'error',
            code: 'signal_phase_invalid',
            refs: [group.id, from, to],
            message: `Signal of ${group.id} phase ${phase + 1} names ${from} to ${to}, not an entry and an exit of the group`,
          });
        continue;
      }
      for (const pair of memberPairs(compiled, group, node, entry, exit)) pairs.add(pair);
    }
    for (const pair of innerPairs) pairs.add(pair);
    return {
      durationS,
      groups: [...pairs].sort().map((pair) => {
        const [from, to] = pair.split('>') as [string, string];
        return { from, to };
      }),
      ...(walk && {
        walk: walk.filter(({ roadId, end }) => {
          const road = city.roads[roadId];
          return road && (end === 'end' ? road.to : road.from) === id;
        }),
      }),
    };
  });
  return {
    program: { ...program, phases },
    vehicles: program.phases.map((phase) => phase.groups.length > 0),
    free,
  };
}
