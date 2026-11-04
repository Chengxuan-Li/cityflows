import type { CompiledCity, Diagnostic } from '../../network';
import type { City, Node } from '../../schema';
import { generateSignalProgram } from '../signal-program';
import type { OsmData } from './parse';

export function addSignal(
  city: City,
  node: Node,
  approachCount: number,
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
  data?: OsmData,
): void {
  node.control = 'signal';
  node.signal = generateSignalProgram(city, node, approachCount, compiled, diagnostics);
  const countries = new Set(
    [...(data?.node ?? []), ...(data?.way ?? []), ...(data?.relation ?? [])].flatMap(({ tag }) => {
      const country =
        tag['addr:country'] ??
        tag['is_in:country_code'] ??
        tag['ISO3166-1:alpha2'] ??
        tag['ISO3166-1'] ??
        tag['is_in:country'];
      return country ? [country.trim().toUpperCase()] : [];
    }),
  );
  if (countries.size)
    node.signal.turnOnRed = [...countries].every((c) =>
      ['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(c),
    );
  node.provenance.inferred!.push('signal');
}
