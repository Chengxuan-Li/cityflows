import type { CompiledCity, Diagnostic } from '../../network';
import type { City, Node } from '../../schema';
import { generateSignalProgram } from '../signal-program';
import type { OsmData } from './parse';

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

/** Circulating OSM ways stay intact; only joining approaches give way. */
export function markRoundaboutEntries(city: City, data: OsmData): void {
  const ways = new Set(data.way.filter((w) => w.tag.junction === 'roundabout').map((w) => w.id));
  const ring = new Set(
    Object.values(city.roads)
      .filter((r) => r.provenance.osmIds?.some((id) => ways.has(id)))
      .map((r) => r.id),
  );
  const entries = new Set(
    Object.values(city.roads)
      .filter((r) => ring.has(r.id))
      .map((r) => r.to),
  );
  for (const id of entries) {
    const node = city.nodes[id]!;
    const minor = Object.values(city.roads)
      .filter((r) => r.to === id && !ring.has(r.id))
      .map((r) => r.id);
    if (!minor.length || node.control === 'signal') continue;
    node.control = 'yield';
    node.minorRoads = minor;
  }
}
