import { polylineLength } from '../../geo/polyline';
import { lonLatToLocal } from '../../geo/projection';
import { compile, type Diagnostic } from '../../network';
import { allocateId, citySchema, type City, type Node } from '../../schema';
import type { ImportOptions, ImportResult } from '../types';
import { clipPart, findBoundaryCuts, type RoadPoint } from './clip';
import { importContext } from './context';
import { addBuildings } from './buildings';
import { addSignal, assignSignalLanes, markRoundaboutEntries } from './controls';
import { drivableClass } from './filter';
import { parseOsm } from './parse';
import { addGateways, addOsmPlaces } from './places';
import { project } from './project';
import { createRoads, isBridge, osmLayer, roadSpecs, type OsmRoad } from './roads';
import { smoothRoads } from './smooth';
import { realignRoads } from './realign';
import {
  assignCorridors,
  pairSameDirection,
  sampleSameDirection,
  separateCoincident,
  separateDual,
  attachCarriageways,
} from './corridors';
import { DEFAULT_RELAX_MAX_M, relaxRoads } from './relax';
import {
  consolidateJunctions,
  joinDividedFeeders,
  junctions,
  mergeShortRoads,
  splitWay,
} from './split';
import { addLaneTurns, addLocalTurnarounds, addRestrictions, type JunctionRoads } from './turns';

export function importOsm(xml: string, options: ImportOptions): ImportResult {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, message: string, refs: string[] = []): ImportResult => ({
    ok: false,
    diagnostics: [...diagnostics, { severity: 'error', code, message, refs }],
  });
  const data = parseOsm(xml);
  if (typeof data === 'string') return fail('osm_parse_error', data);
  const sourceNodes = new Map(data.node.map((node) => [node.id, node]));
  // Extracts clipped by osmium, osmconvert and similar tools keep references to nodes outside
  // the file, and mappers leave one-node ways. Keep each way's longest run of present nodes
  // (one piece per way, since street groups are named by way id) and drop what cannot be a road.
  const trimmed: number[] = [];
  const dropped: number[] = [];
  const kept = data.way.flatMap((way) => {
    const roadClass = drivableClass(way);
    if (!roadClass) return [];
    let best: number[] = [];
    let run: number[] = [];
    for (const ref of [...way.nd, NaN]) {
      if (sourceNodes.has(ref)) {
        run.push(ref);
        continue;
      }
      if (run.length > best.length) best = run;
      run = [];
    }
    if (best.length < 2) {
      dropped.push(way.id);
      return [];
    }
    if (best.length < way.nd.length) trimmed.push(way.id);
    return [{ way: { ...way, nd: best }, roadClass }];
  });
  if (trimmed.length || dropped.length) {
    const names = (ids: number[]) =>
      ids.length > 5 ? `${ids.slice(0, 5).join(', ')} and ${ids.length - 5} more` : ids.join(', ');
    diagnostics.push({
      severity: 'warning',
      code: 'osm_incomplete_way',
      refs: [...trimmed, ...dropped].slice(0, 20).map((id) => `way/${id}`),
      message: [
        trimmed.length &&
          `Trimmed ${trimmed.length} ways to the nodes present in the file (${names(trimmed)})`,
        dropped.length &&
          `dropped ${dropped.length} ways with fewer than two present nodes (${names(dropped)})`,
      ]
        .filter(Boolean)
        .join('; '),
    });
  }
  if (!kept.length) return fail('osm_no_drivable_ways', 'The extract has no drivable highways');
  const used = new Set<number>();
  const wayLayers = new Map<
    number,
    { wayId: number; layer: number; through: boolean; bridge: boolean }[]
  >();
  for (const { way } of kept) {
    const layer = osmLayer(way.tag) ?? 0;
    const bridge = isBridge(way.tag);
    for (const [index, ref] of way.nd.entries()) {
      used.add(ref);
      const layers = wayLayers.get(ref) ?? [];
      layers.push({
        wayId: way.id,
        layer,
        through: index > 0 && index < way.nd.length - 1,
        bridge,
      });
      wayLayers.set(ref, layers);
    }
  }
  const geo = project(
    data,
    options,
    [...used].map((id) => sourceNodes.get(id)!),
  );
  if (typeof geo === 'string') return fail('osm_invalid_bbox', geo);
  const [west, south, east, north] = geo.bbox;
  const bounds = {
    min: lonLatToLocal(geo, { lon: west, lat: north }),
    max: lonLatToLocal(geo, { lon: east, lat: south }),
  };
  const city: City = {
    schemaVersion: 3,
    version: 0,
    name: 'OpenStreetMap import',
    drivingSide: options.drivingSide ?? 'right',
    geo,
    nodes: {},
    roads: {},
    places: {},
    nextId: 1,
  };

  const positions = new Map(data.node.map((node) => [node.id, lonLatToLocal(geo, node)]));
  const ways = kept.map(({ way }) => way);
  const boundaryCuts = findBoundaryCuts(ways, positions, bounds);
  const splits = junctions(ways, [
    ...data.node
      .filter(({ tag }) => ['traffic_signals', 'stop', 'give_way'].includes(tag.highway ?? ''))
      .map(({ id }) => id),
    ...data.relation.flatMap(({ tag, member }) =>
      tag.type === 'restriction'
        ? member.filter(({ type, role }) => type === 'node' && role === 'via').map(({ ref }) => ref)
        : [],
    ),
  ]);
  const nodes = new Map<string, Node>();
  const incidents = new Map<string, JunctionRoads>();
  const signals: Node[] = [];
  function addNode(point: RoadPoint, wayLayer: number, wayId: number) {
    const existing = nodes.get(point.key);
    if (existing) return existing.id;
    const tags = point.osmId === undefined ? undefined : sourceNodes.get(point.osmId)!.tag;
    const taggedLayer = tags?.layer === undefined ? undefined : osmLayer(tags);
    if (tags?.layer !== undefined && taggedLayer === undefined)
      diagnostics.push({
        severity: 'warning',
        code: 'osm_unsupported_tag',
        refs: [`way/${wayId}`],
        message: `Unsupported layer=${tags.layer} at OSM node ${point.key}`,
      });
    let layer = taggedLayer ?? wayLayer;
    if (taggedLayer === undefined && point.osmId !== undefined) {
      const layers = wayLayers.get(point.osmId)!;
      // Use the through way first, then a continuation across way boundaries.
      // A bridge endpoint without a deck continuation meets the ground.
      const candidates = layers.map((candidate) => {
        const continues = layers.some(
          (other) => other.wayId !== candidate.wayId && other.layer === candidate.layer,
        );
        return {
          wayId: candidate.wayId,
          priority: candidate.through ? 2 : continues ? 1 : 0,
          layer: candidate.bridge && !candidate.through && !continues ? 0 : candidate.layer,
        };
      });
      candidates.sort(
        (a, b) =>
          b.priority - a.priority ||
          Number(b.layer === 0) - Number(a.layer === 0) ||
          a.wayId - b.wayId,
      );
      layer = candidates[0]!.layer;
    }
    const control =
      tags?.highway === 'stop' ? 'stop' : tags?.highway === 'give_way' ? 'yield' : 'uncontrolled';
    // Only genuinely guessed attributes count as inferred; untagged layer and control are the
    // OSM defaults, not guesses.
    const inferred: string[] = [];
    if (control === 'stop' || control === 'yield') inferred.push('minorRoads');
    const id = allocateId(city, 'n');
    const node: Node = {
      id,
      pos: point.pos,
      layer,
      control,
      minorRoads: [],
      turnRules: [],
      signal: null,
      provenance: { source: 'osm', osmIds: [point.osmId ?? wayId], inferred },
    };
    if (tags?.highway === 'traffic_signals') signals.push(node);
    nodes.set(point.key, node);
    city.nodes[id] = node;
    incidents.set(id, { incoming: [], outgoing: [] });
    return id;
  }

  const roads: OsmRoad[] = [];
  for (const { way, roadClass } of kept) {
    let segment = 0;
    const specs = roadSpecs(way, roadClass, diagnostics);
    const ids = way.nd.filter((id, i) => id !== way.nd[i - 1]);
    const parts = splitWay(ids, splits);
    if (!parts.length)
      return fail('road_degenerate', `OSM way ${way.id} has no distinct endpoints`, [
        `way/${way.id}`,
      ]);
    for (const [index, part] of parts.entries()) {
      const points = part.map((id) => ({ key: String(id), osmId: id, pos: positions.get(id)! }));
      if (polylineLength(points.map(({ pos }) => pos)) === 0) {
        return fail('road_degenerate', `OSM way ${way.id} has a zero-length section`, [
          `way/${way.id}`,
        ]);
      }
      for (const clipped of clipPart(points, bounds, `way/${way.id}/${index}`, boundaryCuts)) {
        const first = clipped.points[0]!;
        const last = clipped.points.at(-1)!;
        if (first.key === last.key)
          return fail('road_degenerate', `OSM way ${way.id} has a self-loop`, [`way/${way.id}`]);
        const wayLayer = osmLayer(way.tag) ?? 0;
        const from = addNode(first, wayLayer, way.id);
        const to = addNode(last, wayLayer, way.id);
        for (const road of createRoads(city, way, roadClass, specs, clipped, segment++, from, to)) {
          incidents.get(road.road.from)!.outgoing.push(road);
          incidents.get(road.road.to)!.incoming.push(road);
          roads.push(road);
        }
      }
    }
  }
  if (!roads.length) return fail('osm_no_drivable_ways', 'No drivable highways intersect the bbox');

  const protectedNodes = new Set([
    ...signals.map((node) => node.id),
    ...data.relation.flatMap(({ member }) =>
      member
        .filter((m) => m.role === 'via' && m.type === 'node')
        .flatMap((m) => (nodes.has(String(m.ref)) ? [nodes.get(String(m.ref))!.id] : [])),
    ),
  ]);
  mergeShortRoads(city, roads, protectedNodes);
  joinDividedFeeders(city, roads, protectedNodes);
  for (const [key, node] of nodes) if (!city.nodes[node.id]) nodes.delete(key);
  for (const node of Object.values(city.nodes)) {
    if (![...nodes.values()].includes(node)) nodes.set(node.id, node);
  }
  incidents.clear();
  for (const node of nodes.values()) incidents.set(node.id, { incoming: [], outgoing: [] });
  for (const road of roads) {
    incidents.get(road.road.from)!.outgoing.push(road);
    incidents.get(road.road.to)!.incoming.push(road);
  }

  addRestrictions(data.relation, nodes, incidents, diagnostics);
  for (const node of nodes.values()) {
    addLocalTurnarounds(node, incidents.get(node.id)!);
  }
  const beforeConsolidation = compile(city);
  if (!beforeConsolidation.ok)
    return { ok: false, diagnostics: [...diagnostics, ...beforeConsolidation.diagnostics] };
  const originalControls = Object.values(city.nodes)
    .filter((node) => node.control !== 'uncontrolled')
    .map((node) => node.id);
  const signalIds = consolidateJunctions(
    city,
    roads,
    beforeConsolidation.compiled,
    signals.map((n) => n.id),
  );
  const coincident = assignCorridors(city, roads);
  const sameDirection = pairSameDirection(roads);
  smoothRoads(
    city,
    roads,
    new Set([...protectedNodes, ...originalControls, ...signalIds]),
    new Set(ways.filter((way) => way.tag.junction === 'roundabout').map((way) => way.id)),
  );
  realignRoads(
    city,
    roads,
    new Set([...protectedNodes, ...originalControls, ...signalIds]),
    new Set(ways.filter((way) => way.tag.junction === 'roundabout').map((way) => way.id)),
    diagnostics,
  );
  separateCoincident(city, coincident);
  separateDual(city, roads);
  attachCarriageways(city, roads);
  relaxRoads(city, roads, options.relaxMaxM ?? DEFAULT_RELAX_MAX_M);
  sampleSameDirection(sameDirection);
  incidents.clear();
  for (const node of Object.values(city.nodes))
    incidents.set(node.id, { incoming: [], outgoing: [] });
  for (const road of roads) {
    incidents.get(road.road.from)!.outgoing.push(road);
    incidents.get(road.road.to)!.incoming.push(road);
  }
  for (const node of Object.values(city.nodes))
    addLaneTurns(node, incidents.get(node.id)!, city.drivingSide, diagnostics);
  markRoundaboutEntries(city, data);
  let base = compile(city);
  if (!base.ok) return { ok: false, diagnostics: [...diagnostics, ...base.diagnostics] };
  if (assignSignalLanes(city, signalIds, base.compiled)) base = compile(city);
  if (!base.ok) return { ok: false, diagnostics: [...diagnostics, ...base.diagnostics] };
  // Signal control changes junction geometry. Fix it before choosing compatible greens.
  for (const id of signalIds) {
    const node = city.nodes[id]!;
    node.control = 'signal';
    node.signal = { offsetS: 0, amberS: 3, allRedS: 1, phases: [{ durationS: 30, groups: [] }] };
  }
  base = compile(city);
  if (!base.ok) return { ok: false, diagnostics: [...diagnostics, ...base.diagnostics] };
  for (const id of signalIds) {
    addSignal(
      city,
      city.nodes[id]!,
      roads.filter(({ road }) => road.to === id).length,
      base.compiled,
      diagnostics,
      data,
    );
  }
  // Connector access must use the real programs, never the geometry-only signal pass.
  base = compile(city);
  if (!base.ok) return { ok: false, diagnostics: [...diagnostics, ...base.diagnostics] };
  addGateways(city, roads, base.compiled);
  addOsmPlaces(city, data, positions, bounds, base.compiled);
  addBuildings(city, data, positions, bounds, base.compiled);
  if (options.context !== false)
    city.context = { features: importContext(data, positions, bounds) };

  const clipped = roads.filter(({ cutStart, cutEnd }) => cutStart || cutEnd);
  if (clipped.length)
    diagnostics.push({
      severity: 'warning',
      code: 'osm_clipped',
      refs: clipped.map(({ road }) => road.id),
      message: `Clipped ${clipped.length} directed roads to the bbox`,
    });
  for (const [attribute, label, code] of [
    ['lanes', 'lane counts', 'osm_inferred_lanes'],
    ['speedLimitMps', 'speed limits', 'osm_inferred_speeds'],
  ] as const) {
    const inferred = roads.filter(({ road }) => road.provenance.inferred!.includes(attribute));
    if (inferred.length)
      diagnostics.push({
        severity: 'warning',
        code,
        refs: inferred.map(({ road }) => road.id),
        message: `Inferred ${label} on ${inferred.length} roads`,
      });
  }
  geo.source.inferredCount = [
    ...Object.values(city.nodes),
    ...Object.values(city.nodes).flatMap((node) => node.turnRules),
    ...Object.values(city.roads),
    ...Object.values(city.places),
  ].reduce((sum, entity) => sum + (entity.provenance.inferred?.length ?? 0), 0);
  const validation = citySchema.safeParse(city);
  if (!validation.success) {
    const issue = validation.error.issues[0]!;
    return fail('osm_invalid_city', `${issue.path.join('.')}: ${issue.message}`);
  }
  const final = compile(city);
  diagnostics.push(...final.diagnostics);
  return final.ok ? { ok: true, city, diagnostics } : { ok: false, diagnostics };
}
