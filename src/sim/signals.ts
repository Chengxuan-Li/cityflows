import { signalStateAt, type CompiledCity } from '../network';

/** Keep phase epochs separate from the canonical program sent back to restart. */
export function patchSignals(
  before: CompiledCity,
  after: CompiledCity,
  timeS: number,
  epochs: Map<string, number>,
) {
  const signature = (city: CompiledCity, index: number) => {
    const signal = city.nodes[index]!.signal;
    return (
      signal &&
      JSON.stringify({
        ...signal,
        phases: signal.phases.map((phase) => ({
          ...phase,
          movements: phase.movements.map((i) => city.movements[i]!.id),
          // TASK-111: walk links by id; their indices shift with unrelated edits.
          walk: phase.walk.map((i) => city.walk.links[i]!.id),
        })),
      })
    );
  };
  return {
    ...after,
    nodes: after.nodes.map((node) => {
      const old = before.index.node.get(node.id);
      if (
        node.signal &&
        (old === undefined || signature(before, old) !== signature(after, node.idx))
      )
        epochs.set(node.id, timeS);
      const epoch = epochs.get(node.id);
      return node.signal && epoch !== undefined
        ? { ...node, signal: { ...node.signal, offsetS: node.signal.offsetS - epoch } }
        : node;
    }),
  };
}

export const RED = 0;
export const GREEN = 1;
export const AMBER = 2;

export function updateSignals(compiled: CompiledCity, timeS: number, colors: Uint8Array) {
  for (const node of compiled.nodes) {
    const signal = node.signal;
    if (!signal) continue;
    for (const movement of node.movements) colors[movement] = RED;
    const { phase, state } = signalStateAt(signal, timeS);
    if (state === 'all-red') continue;
    const color = state === 'green' ? GREEN : AMBER;
    for (const movement of signal.phases[phase]!.movements) colors[movement] = color;
  }
}
