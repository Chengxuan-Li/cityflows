import { polylineLength } from '../../geo/polyline';
import type { CompiledCity, Diagnostic } from '../../network';
import type { City, Node, Road } from '../../schema';
import { generateGroupSignalProgram, generateSignalProgram } from '../../network/signal-program';
import type { OsmData } from './parse';

export function isControlJunction(id: string, roads: Road[]): boolean {
  const incident = roads.filter((r) => r.from === id || r.to === id);
  const degree = new Set(incident.map((r) => (r.from === id ? r.to : r.from))).size;
  return (
    degree >= 3 ||
    (degree === 2 &&
      incident.some((a) =>
        incident.some(
          (b) =>
            !(a.name && a.name === b.name) &&
            !a.provenance.osmIds!.some((id) => b.provenance.osmIds!.includes(id)),
        ),
      ))
  );
}

// Snapshot the original directed distances and source ids before contraction changes either.
export function captureControls(city: City, roads: Road[], signals: string[]) {
  const signalIds = new Set(signals);
  const sources = Object.values(city.nodes)
    .filter((n) => signalIds.has(n.id) || n.control === 'stop' || n.control === 'yield')
    .map((n) => ({
      id: n.id,
      osmIds: [...n.provenance.osmIds!],
      control: signalIds.has(n.id) ? ('signal' as const) : n.control,
    }));
  const junctions = new Set(Object.keys(city.nodes).filter((id) => isControlJunction(id, roads)));
  for (const source of sources) {
    if (junctions.has(source.id)) continue;
    city.nodes[source.id]!.control = 'uncontrolled';
    city.nodes[source.id]!.minorRoads = [];
  }
  return {
    sources,
    junctions,
    edges: roads.map((r) => ({
      id: r.id,
      from: r.from,
      to: r.to,
      length: polylineLength(r.centerline),
    })),
  };
}

// Follow only directed road paths, stopping at the first surviving junction within 60 m.
// Two-way approaches choose the nearest junction; canonical ids break ties.
export function relocateControls(
  city: City,
  captured: ReturnType<typeof captureControls>,
  representatives: Map<string, string>,
): string[] {
  const roads = Object.values(city.roads);
  const junctions = new Set(Object.keys(city.nodes).filter((id) => isControlJunction(id, roads)));
  const representative = (id: string) => representatives.get(id) ?? id;
  const signals = new Set<string>();
  const priority = ['uncontrolled', 'yield', 'stop', 'signal'];
  for (const node of Object.values(city.nodes)) {
    node.control = 'uncontrolled';
    node.minorRoads = [];
  }
  for (const source of captured.sources) {
    const queue = [{ id: source.id, length: 0, path: [] as string[] }];
    const visited = new Set<string>();
    let target: Node | undefined;
    let approach: string[] = [];
    while (queue.length) {
      queue.sort((a, b) => a.length - b.length || a.id.localeCompare(b.id));
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      const id = representative(current.id);
      if (captured.junctions.has(current.id) && junctions.has(id)) {
        target = city.nodes[id]!;
        approach = current.path.filter((road) => city.roads[road]?.to === id);
        if (!approach.length) {
          approach = captured.edges
            .filter((edge) => edge.to === source.id && city.roads[edge.id]?.to === id)
            .map((edge) => edge.id);
        }
        break;
      }
      for (const edge of captured.edges) {
        if (edge.from !== current.id || visited.has(edge.to)) continue;
        const length = current.length + edge.length;
        if (length <= 60) queue.push({ id: edge.to, length, path: [...current.path, edge.id] });
      }
    }
    if (!target) continue;
    if (target.id !== source.id || !captured.junctions.has(source.id)) {
      const highway =
        source.control === 'signal'
          ? 'traffic_signals'
          : source.control === 'yield'
            ? 'give_way'
            : 'stop';
      target.provenance.inferred!.push(
        ...source.osmIds.map((id) => `controlTransferred:${highway}:node/${id}`),
      );
    }
    if (source.control === 'signal') signals.add(target.id);
    else {
      if (priority.indexOf(source.control) > priority.indexOf(target.control))
        target.control = source.control;
      if (!captured.junctions.has(source.id))
        target.minorRoads = [...new Set([...target.minorRoads, ...approach])];
    }
  }
  return [...signals];
}

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
  node.signal.turnOnRed = turnOnRed(data);
  if (node.signal.turnOnRed === undefined) delete node.signal.turnOnRed;
  node.provenance.inferred!.push('signal');
}

/** TASK-131: a signalised junction group's one program, over its entry-to-exit chains. */
export function addGroupSignal(
  city: City,
  groupId: string,
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
  data?: OsmData,
): void {
  const group = city.junctionGroups![groupId]!;
  group.signal = generateGroupSignalProgram(city, groupId, compiled, diagnostics);
  group.signal.turnOnRed = turnOnRed(data);
  if (group.signal.turnOnRed === undefined) delete group.signal.turnOnRed;
  group.provenance.inferred!.push('signal');
}

function turnOnRed(data?: OsmData): boolean | undefined {
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
  if (!countries.size) return undefined;
  return [...countries].every((c) =>
    ['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(c),
  );
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

/** Explicit area country tags take precedence over the coarse geographic default. */
export function osmMarkingTheme(data: OsmData): City['markingTheme'] {
  const countries = [...data.relation, ...data.way, ...data.node].flatMap(({ tag }) => {
    const value =
      tag['addr:country'] ??
      tag['is_in:country_code'] ??
      tag['ISO3166-1:alpha2'] ??
      tag['ISO3166-1'] ??
      tag['is_in:country'];
    return value ? [value.trim().toUpperCase()] : [];
  });
  if (!countries.length) return undefined;
  const country = countries[0]!;
  if (['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA', 'CA', 'CANADA'].includes(country))
    return 'us';
  if (['GB', 'UK', 'UNITED KINGDOM', 'IE', 'IRELAND'].includes(country)) return 'uk';
  return 'de';
}
