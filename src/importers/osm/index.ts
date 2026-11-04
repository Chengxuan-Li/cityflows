import { polylineLength } from '../../geo/polyline';
import { lonLatToLocal } from '../../geo/projection';
import { compile, type Diagnostic } from '../../network';
import { allocateId, citySchema, type City, type Node } from '../../schema';
import type { ImportOptions, ImportResult } from '../types';
import { clipPart, findBoundaryCuts, type RoadPoint } from './clip';
import { addSignal } from './controls';
import { drivableClass } from './filter';
import { parseOsm } from './parse';
import { addGateways, addOsmPlaces } from './places';
import { project } from './project';
import { createRoads, roadSpecs, type OsmRoad } from './roads';
import { junctions, splitWay } from './split';
import { addLaneTurns, addRestrictions, type JunctionRoads } from './turns';

export function importOsm(xml: string, options: ImportOptions): ImportResult {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, message: string, refs: string[] = []): ImportResult => ({
    ok: false,
    diagnostics: [...diagnostics, { severity: 'error', code, message, refs }],
  });
  const data = parseOsm(xml);
  if (typeof data === 'string') return fail('osm_parse_error', data);
  const kept = data.way.flatMap((way) => {
    const roadClass = drivableClass(way);
    return roadClass ? [{ way, roadClass }] : [];
  });
  if (!kept.length) return fail('osm_no_drivable_ways', 'The extract has no drivable highways');
  const sourceNodes = new Map(data.node.map((node) => [node.id, node]));
  const used = new Set<number>();
  const wayLayers = new Map<number, string>();
  for (const { way } of kept) {
    if (way.nd.length < 2)
      return fail('road_degenerate', `OSM way ${way.id} needs at least two nodes`, [
        `way/${way.id}`,
      ]);
    for (const ref of way.nd) {
      if (!sourceNodes.has(ref))
        return fail('dangling_ref', `OSM way ${way.id} references missing node ${ref}`, [
          `way/${way.id}`,
          `node/${ref}`,
        ]);
      used.add(ref);
      if (way.tag.layer !== undefined && !wayLayers.has(ref)) wayLayers.set(ref, way.tag.layer);
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
    schemaVersion: 1,
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
  function addNode(point: RoadPoint, wayLayer: string | undefined, wayId: number) {
    const existing = nodes.get(point.key);
    if (existing) return existing.id;
    const tags = point.osmId === undefined ? undefined : sourceNodes.get(point.osmId)!.tag;
    const layerTag =
      point.osmId === undefined ? wayLayer : (tags?.layer ?? wayLayers.get(point.osmId));
    const layer = layerTag && /^-?\d+$/.test(layerTag) ? Number(layerTag) : NaN;
    const hasLayer = Number.isSafeInteger(layer);
    if (layerTag !== undefined && !hasLayer)
      diagnostics.push({
        severity: 'warning',
        code: 'osm_unsupported_tag',
        refs: [`way/${wayId}`],
        message: `Unsupported layer=${layerTag} at OSM node ${point.key}`,
      });
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
      layer: hasLayer ? layer : 0,
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
        const from = addNode(first, way.tag.layer, way.id);
        const to = addNode(last, way.tag.layer, way.id);
        for (const road of createRoads(city, way, roadClass, specs, clipped, segment++, from, to)) {
          incidents.get(road.road.from)!.outgoing.push(road);
          incidents.get(road.road.to)!.incoming.push(road);
          roads.push(road);
        }
      }
    }
  }
  if (!roads.length) return fail('osm_no_drivable_ways', 'No drivable highways intersect the bbox');

  addRestrictions(data.relation, nodes, incidents, diagnostics);
  for (const node of nodes.values())
    addLaneTurns(node, incidents.get(node.id)!, city.drivingSide, diagnostics);
  const base = compile(city);
  if (!base.ok) return { ok: false, diagnostics: [...diagnostics, ...base.diagnostics] };
  for (const node of signals) {
    addSignal(
      city,
      node,
      incidents.get(node.id)!.incoming.length,
      base.compiled,
      diagnostics,
      data,
    );
  }
  addGateways(city, roads, base.compiled);
  addOsmPlaces(city, data, positions, bounds, base.compiled);

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
