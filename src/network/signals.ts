import type { SignalProgram } from '../schema';
import { crossingArms } from './crossings';
import type { CMovement, CNode, CSignal, CompiledCity, Diagnostic } from './types';

/** TASK-131: two movements into one lane of a group's inner road merge inside the junction, as
 * at an uncontrolled lane drop: one green serves both and the grant rule orders them (Munich
 * r:480's left and through lanes into the one-lane crossing r:713 at n:366). */
export function intoInnerLane(city: CompiledCity, a: CMovement, b: number): boolean {
  const lane = city.lanes[a.toLane]!;
  return lane.idx === city.movements[b]!.toLane && city.roads[lane.road]!.group !== undefined;
}

export function compileSignal(
  node: CNode,
  program: SignalProgram,
  city: CompiledCity,
  diagnostics: Diagnostic[],
  free: ReadonlySet<number> = new Set(),
): CSignal {
  const { offsetS, amberS, allRedS } = program;
  const served = new Set<number>();
  const byRoadPair = new Map<string, number[]>();
  for (const idx of node.movements) {
    const movement = city.movements[idx]!;
    const key = city.lanes[movement.fromLane]!.road + '>' + city.lanes[movement.toLane]!.road;
    const group = byRoadPair.get(key);
    if (group) group.push(idx);
    else byRoadPair.set(key, [idx]);
  }

  const phases = program.phases.map(({ durationS, groups }, phase) => {
    const members = new Set<number>();
    for (const { from, to } of groups) {
      const incoming = city.index.road.get(from);
      const outgoing = city.index.road.get(to);
      if (
        incoming === undefined ||
        outgoing === undefined ||
        city.roads[incoming]!.to !== node.idx ||
        city.roads[outgoing]!.from !== node.idx
      ) {
        diagnostics.push({
          severity: 'error',
          code: 'signal_phase_invalid',
          refs: [node.id, from, to],
          message: `Signal ${node.id} phase ${phase + 1} has a non-incident road pair from ${from} to ${to}`,
        });
        continue;
      }
      for (const idx of byRoadPair.get(incoming + '>' + outgoing) ?? []) members.add(idx);
    }

    const movements = [...members].sort((a, b) => a - b);
    for (const idx of movements) {
      const movement = city.movements[idx]!;
      for (const conflict of movement.conflicts) {
        if (
          conflict > idx &&
          members.has(conflict) &&
          !free.has(idx) &&
          !free.has(conflict) &&
          !intoInnerLane(city, movement, conflict)
        ) {
          const other = city.movements[conflict]!;
          diagnostics.push({
            severity: 'error',
            code: 'signal_conflict',
            refs: [node.id, movement.id, other.id],
            message: `Signal ${node.id} phase ${phase + 1} serves conflicting movements ${movement.id} and ${other.id}`,
          });
        }
      }
      served.add(idx);
    }
    return { durationS, movements, walk: [] as number[] };
  });

  for (const idx of node.movements) {
    const movement = city.movements[idx]!;
    movement.turnOnRed =
      !!program.turnOnRed && movement.turn === (city.drivingSide === 'right' ? 'right' : 'left');
    if (served.has(idx) || movement.turnOnRed) continue;
    movement.neverGreen = true;
    diagnostics.push({
      severity: 'warning',
      code: 'signal_unserved_movement',
      refs: [node.id, movement.id],
      message: `Signal ${node.id} never serves movement ${movement.id}`,
    });
  }
  return {
    ...(program.demandSplit && { demandSplit: true as const }),
    ...(program.actuated && { actuated: true as const }),
    offsetS,
    amberS,
    allRedS,
    phases,
    cycleS: phases.reduce((sum, phase) => sum + (phase.durationS + amberS + allRedS), 0),
  };
}

/**
 * TASK-111: each phase's walk green, as the indices of the signal crossing links of the node
 * (`WalkGraph`, compiled after the signals). Explicit `walk` entries name a road end of the arm
 * whose crossing is green; an entry naming no crossing of the node is ignored (an edit may have
 * removed it). Absent: the derived groups, concurrent operation as in Germany: an arm's crossing
 * is green in every phase in which no movement from the arm is, and in none in a phase without
 * vehicle groups (an exclusive pedestrian phase is never derived).
 */
export function compileSignalWalk(
  city: CompiledCity,
  programs: Map<number, { program: SignalProgram; vehicles: boolean[] }>,
) {
  const byNode = new Map<number, number[]>();
  for (const link of city.walk.links)
    if (link.crossing?.control === 'signal' && link.crossing.node >= 0) {
      const list = byNode.get(link.crossing.node) ?? [];
      list.push(link.idx);
      byNode.set(link.crossing.node, list);
    }
  for (const [index, links] of byNode) {
    const node = city.nodes[index]!;
    if (!node.signal) continue;
    const arms = crossingArms(city, node);
    const { program, vehicles } = programs.get(index)!;
    node.signal.phases.forEach((phase, p) => {
      const explicit = program.phases[p]!.walk;
      let green: Set<number>;
      if (explicit) {
        green = new Set(
          explicit.flatMap(({ roadId, end }) => {
            const road = city.index.road.get(roadId);
            const arm = arms.findIndex((ends) =>
              ends.some((e) => e.road.idx === road && e.atEnd === (end === 'end')),
            );
            return arm === -1 ? [] : [arm];
          }),
        );
      } else {
        green = new Set();
        if (vehicles[p])
          arms.forEach((ends, arm) => {
            const served = phase.movements.some((m) =>
              ends.some(
                (e) => e.atEnd && e.road.idx === city.lanes[city.movements[m]!.fromLane]!.road,
              ),
            );
            if (!served) green.add(arm);
          });
      }
      phase.walk = links.filter((i) => green.has(city.walk.links[i]!.crossing!.arm));
    });
  }
}

/** TASK-111: a signal crossing link's walk green windows in the cycle: the green of the phases
 * that list the link, run on through the amber and all-red between two such phases. */
export function walkWindows(signal: CSignal, link: number): [number, number][] {
  const spans: [number, number][] = [];
  let start = 0;
  signal.phases.forEach((phase, p) => {
    const end = start + phase.durationS + signal.amberS + signal.allRedS;
    if (phase.walk.includes(link)) {
      const next = signal.phases[(p + 1) % signal.phases.length]!;
      const until = next.walk.includes(link) ? end : start + phase.durationS;
      const last = spans.at(-1);
      if (last && last[1] === start) last[1] = until;
      else spans.push([start, until]);
    }
    start = end;
  });
  return spans;
}

/** TASK-111: the walk green left at `timeS` on a crossing link of a signal: 0 when its walk light
 * is red, Infinity when it never turns red. */
export function walkGreenS(
  signal: CSignal,
  link: number,
  timeS: number,
  spans = walkWindows(signal, link),
): number {
  let elapsed = (timeS + signal.offsetS) % signal.cycleS;
  if (elapsed < 0) elapsed += signal.cycleS;
  for (const [from, to] of spans) {
    if (elapsed < from || elapsed >= to) continue;
    if (to < signal.cycleS - 1e-9 || spans[0]![0] > 1e-9) return to - elapsed;
    return from <= 1e-9 ? Infinity : to - elapsed + spans[0]![1];
  }
  return 0;
}

export function signalStateAt(
  signal: CSignal,
  timeS: number,
): { phase: number; state: 'green' | 'amber' | 'all-red' } {
  let elapsed = (timeS + signal.offsetS) % signal.cycleS;
  if (elapsed < 0) elapsed += signal.cycleS;
  for (const [phase, { durationS }] of signal.phases.entries()) {
    if (elapsed < durationS) return { phase, state: 'green' };
    if (elapsed < durationS + signal.amberS) return { phase, state: 'amber' };
    const end = durationS + signal.amberS + signal.allRedS;
    if (elapsed < end) return { phase, state: 'all-red' };
    elapsed -= end;
  }
  // Accumulated floating-point rounding can leave a residual at the cycle boundary.
  return { phase: 0, state: 'green' };
}
