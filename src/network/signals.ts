import type { SignalProgram } from '../schema';
import type { CNode, CSignal, CompiledCity, Diagnostic } from './types';

export function compileSignal(
  node: CNode,
  program: SignalProgram,
  city: CompiledCity,
  diagnostics: Diagnostic[],
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
        if (conflict > idx && members.has(conflict)) {
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
    return { durationS, movements };
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
    offsetS,
    amberS,
    allRedS,
    phases,
    cycleS: phases.reduce((sum, phase) => sum + (phase.durationS + amberS + allRedS), 0),
  };
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
