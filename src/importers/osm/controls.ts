import type { CompiledCity, Diagnostic } from '../../network';
import type { City, Node } from '../../schema';
import { generateSignalProgram } from '../signal-program';

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
