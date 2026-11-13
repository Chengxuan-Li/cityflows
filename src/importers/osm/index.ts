import { polylineLength } from '../../geo/polyline';
import { lonLatToLocal } from '../../geo/projection';
import { compile, type Diagnostic } from '../../network';
import { groupAngle, groupExits } from '../../network/groups';
import { addImplicitGarages } from '../../network/parking';
import { geographicMarkingTheme } from '../../schema/marking-theme';
import { osmMarkingTheme } from './controls';
import { allocateId, citySchema, type City, type Node } from '../../schema';
import type { ImportOptions, ImportResult } from '../types';
import { clipPart, findBoundaryCuts, type RoadPoint } from './clip';
import { importContext } from './context';
import { addLots, restoreLotJunctions } from './lots';
import { addMappedLotPortals } from './lot-junctions';
import { importWalk } from './walk';
import { assignTramForms, importRail } from './rail';
import { importTramStops } from './tram-stops';
import { addStrips } from './strips';
import { addBuildings } from './buildings';
import { addGroupSignal, addSignal, assignSignalLanes, markRoundaboutEntries } from './controls';
import { drivableClass } from './filter';
import { parseOsm } from './parse';
import { addOsmGarages } from './parking';
import { addGateways, addOsmPlaces, connectCarExits } from './places';
import { project } from './project';
import { createRoads, isBridge, osmLayer, roadSpecs, type OsmRoad } from './roads';
import { smoothRoads } from './smooth';
import {
  assignCorridors,
  pairSameDirection,
  sampleSameDirection,
  separateCoincident,
  separateDual,
} from './corridors';
import { DEFAULT_RELAX_MAX_M, relaxRoads } from './relax';
import {
  DEFAULT_JUNCTION_GROUP_MAX_M,
  formJunctionGroups,
  joinDividedFeeders,
  prepareJunctions,
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
    markingTheme: osmMarkingTheme(data) ?? geographicMarkingTheme(geo),
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
  const { signalIds, sources } = prepareJunctions(
    city,
    roads,
    signals.map((n) => n.id),
  );
  // Corridors before the groups: a median crossing joins the two carriageways of one corridor.
  const coincident = assignCorridors(city, roads);
  const sameDirection = pairSameDirection(roads);
  const groups = formJunctionGroups(
    city,
    roads,
    options.junctionGroupMaxM ?? DEFAULT_JUNCTION_GROUP_MAX_M,
    sources,
    new Set(signalIds),
  );
  // Provisional group ids: the final ones are allocated last, so that no other id moves.
  if (groups.length)
    city.junctionGroups = Object.fromEntries(
      groups.map(({ nodes, innerRoads }, i) => [
        `jg:${i}`,
        {
          id: `jg:${i}`,
          nodes,
          innerRoads,
          signal: null,
          provenance: {
            source: 'osm' as const,
            osmIds: nodes.flatMap((id) => city.nodes[id]!.provenance.osmIds!),
            inferred: ['junctionGroup'],
          },
        },
      ]),
    );
  // TASK-131 (checkpoint 0): no realignment and no attachment; smoothing keeps every node and
  // the 30 m around it; the collision model is off by default.
  smoothRoads(
    city,
    roads,
    new Set(ways.filter((way) => way.tag.junction === 'roundabout').map((way) => way.id)),
  );
  separateCoincident(city, coincident);
  separateDual(city, roads);
  relaxRoads(city, roads, options.relaxMaxM ?? DEFAULT_RELAX_MAX_M);
  sampleSameDirection(sameDirection);
  incidents.clear();
  for (const node of Object.values(city.nodes))
    incidents.set(node.id, { incoming: [], outgoing: [] });
  for (const road of roads) {
    incidents.get(road.road.from)!.outgoing.push(road);
    incidents.get(road.road.to)!.incoming.push(road);
  }
  // TASK-131: an entry's arrows choose among the group's exits, reached along the inner roads,
  // with the angles of the node the merge used to make.
  const inner = new Set(groups.flatMap(({ innerRoads }) => innerRoads));
  const exitsVia = groupExits(city);
  const members = new Set(groups.flatMap(({ nodes }) => nodes));
  for (const node of Object.values(city.nodes))
    addLaneTurns(
      node,
      incidents.get(node.id)!,
      city.drivingSide,
      diagnostics,
      members.has(node.id)
        ? { entry: (road) => !inner.has(road.id), exitsVia, angle: groupAngle }
        : undefined,
    );
  markRoundaboutEntries(city, data);
  // One signal anywhere in a group makes the group signalised, as the merged node was.
  const signalGroups = Object.values(city.junctionGroups ?? {}).filter((g) =>
    g.nodes.some((id) => signalIds.includes(id)),
  );
  const groupedSignals = new Set(signalGroups.flatMap((g) => g.nodes));
  const nodeSignals = signalIds.filter((id) => !groupedSignals.has(id));
  let base = compile(city);
  if (!base.ok) return { ok: false, diagnostics: [...diagnostics, ...base.diagnostics] };
  if (assignSignalLanes(city, [...nodeSignals, ...groupedSignals], base.compiled))
    base = compile(city);
  if (!base.ok) return { ok: false, diagnostics: [...diagnostics, ...base.diagnostics] };
  // Signal control changes junction geometry. Fix it before choosing compatible greens.
  const placeholder = () => ({
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [{ durationS: 30, groups: [] }],
  });
  for (const id of nodeSignals) {
    const node = city.nodes[id]!;
    node.control = 'signal';
    node.signal = placeholder();
  }
  for (const group of signalGroups) {
    for (const id of group.nodes) {
      city.nodes[id]!.control = 'signal';
      city.nodes[id]!.signal = null;
    }
    group.signal = placeholder();
  }
  base = compile(city);
  if (!base.ok) return { ok: false, diagnostics: [...diagnostics, ...base.diagnostics] };
  for (const group of signalGroups)
    addGroupSignal(city, group.id, base.compiled, diagnostics, data);
  for (const id of nodeSignals) {
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
  const garageFootprints = addOsmGarages(city, data, positions, bounds, base.compiled);
  addImplicitGarages(city);
  const parkingGraph = addLots(city, data, positions, bounds, diagnostics) ?? base.compiled;
  importWalk(city, data, positions, bounds);
  addStrips(city, data, positions, bounds, diagnostics);
  connectCarExits(city, parkingGraph, garageFootprints);
  importRail(city, data, positions, bounds, diagnostics);
  assignTramForms(city, data, parkingGraph);
  if (options.context !== false)
    city.context = { features: importContext(data, positions, bounds, diagnostics, true) };
  if (city.rail && city.context)
    city.context.features = city.context.features.filter(
      (f) => f.class !== 'rail' && f.class !== 'tram',
    );

  if (city.junctionGroups)
    city.junctionGroups = Object.fromEntries(
      Object.values(city.junctionGroups).map((group) => {
        const id = allocateId(city, 'jg');
        return [id, { ...group, id }];
      }),
    );

  importTramStops(city, data, positions, bounds, parkingGraph, diagnostics);
  const portalGeometry = restoreLotJunctions(
    city,
    data,
    positions,
    bounds,
    diagnostics,
    parkingGraph,
  );
  addMappedLotPortals(city, data, diagnostics, portalGeometry ?? parkingGraph);

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
    ...Object.values(city.parking ?? {}),
  ].reduce((sum, entity) => sum + (entity.provenance.inferred?.length ?? 0), 0);
  const validation = citySchema.safeParse(city);
  if (!validation.success) {
    const issue = validation.error.issues[0]!;
    return fail('osm_invalid_city', `${issue.path.join('.')}: ${issue.message}`);
  }
  const final = compile(city);
  if (final.ok)
    for (const lot of final.compiled.lots ?? []) {
      const facility = city.parking![lot.id]!;
      if (facility.provenance.inferred?.includes('capacity')) facility.capacity = lot.stallCount;
    }
  const inferredDiagnostic = final.diagnostics.find((d) => d.code === 'inferred_attributes');
  if (inferredDiagnostic) {
    inferredDiagnostic.message = `Inferred ${geo.source.inferredCount} attributes on imported entities`;
    inferredDiagnostic.refs.push(
      ...Object.values(city.parking ?? {})
        .filter((p) => p.provenance.inferred?.length)
        .map((p) => p.id),
    );
  }
  diagnostics.push(...final.diagnostics);
  return final.ok ? { ok: true, city, diagnostics } : { ok: false, diagnostics };
}
