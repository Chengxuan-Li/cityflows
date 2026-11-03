import { signalStateAt, type CompiledCity } from '../network';

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
