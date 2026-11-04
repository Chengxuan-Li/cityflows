import type { CompiledCity, Diagnostic } from '../../network';
import type { City, Node } from '../../schema';
import { generateSignalProgram } from '../signal-program';

// A signal group switches an entire road pair. Require conflicting approach lanes to merge
// before the junction, rather than generating a group which can never receive a green.
export function assignSignalLanes(city: City, signals: string[], compiled: CompiledCity): boolean {
  let changed = false;
  for (const id of signals) {
    const node = city.nodes[id]!;
    const groups = new Map<string, number[]>();
    for (const idx of compiled.nodes[compiled.index.node.get(id)!]!.movements) {
      const m = compiled.movements[idx]!;
      const key = `${compiled.lanes[m.fromLane]!.road}>${compiled.lanes[m.toLane]!.road}`;
      const group = groups.get(key) ?? [];
      group.push(idx);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const accepted: number[] = [];
      for (const idx of group) {
        const m = compiled.movements[idx]!;
        if (!accepted.some((other) => m.conflicts.includes(other))) {
          accepted.push(idx);
          continue;
        }
        const from = compiled.lanes[m.fromLane]!,
          to = compiled.lanes[m.toLane]!;
        node.turnRules.push({
          from: compiled.roads[from.road]!.id,
          to: compiled.roads[to.road]!.id,
          fromLane: from.lane,
          toLane: to.lane,
          allowed: false,
          provenance: { source: 'osm', inferred: ['signalLaneAssignment'] },
        });
        changed = true;
      }
    }
  }
  return changed;
}

export function addSignal(
  city: City,
  node: Node,
  approachCount: number,
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
): void {
  node.control = 'signal';
  node.signal = generateSignalProgram(city, node, approachCount, compiled, diagnostics);
  node.provenance.inferred!.push('signal');
}
