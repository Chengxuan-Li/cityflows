import { nearestOnPolyline, pointAtDistance, pointInPolygon } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { compile, type CompiledCity, type Diagnostic } from '../../network';
import { allocateId, type City, type Connector, type Road } from '../../schema';
import type { OsmData } from './parse';

/** Parking routing ends at the mapped mouth; circulation continues along the lot's aisles.
 * Keep through streets intact, including their controls, lane changes and historic routes. */
export function addMappedLotPortals(
  city: City,
  data: OsmData,
  diagnostics: Diagnostic[],
  net: CompiledCity,
) {
  const ways = new Map(data.way.map((way) => [way.id, way]));
  const lots = Object.values(city.parking ?? {}).filter((lot) => lot.kind === 'lot');
  const aisles = new Set(lots.flatMap((lot) => lot.aisles ?? []));
  const publicRoads = Object.values(city.roads).filter((road) => !aisles.has(road.id));
  const restored = new Set<string>();
  for (const lot of lots) {
    const portals: Connector[] = [];
    const mappedPortals: NonNullable<typeof lot.mappedPortals> = [];
    const nodes = [
      ...new Set((lot.aisles ?? []).flatMap((id) => [city.roads[id]!.from, city.roads[id]!.to])),
    ];
    // Only facilities with a demonstrated lost/shared source mouth belong to this
    // repair. Existing complete imports retain their normal access selection.
    if (
      !nodes.some((id) => {
        if (publicRoads.some((r) => r.from === id || r.to === id)) return false;
        const node = city.nodes[id]!,
          source = node.provenance.osmIds?.[0];
        return (
          source !== undefined &&
          publicRoads.some(
            (r) =>
              r.provenance.osmIds?.some((osm) => ways.get(osm)?.nd.includes(source)) &&
              nearestOnPolyline(r.centerline, node.pos).away <= 1,
          )
        );
      })
    )
      continue;
    const fallback = lot.provenance.inferred?.includes('driveway')
      ? lot.connectors
      : lot.connectors.filter((c) => {
          if (aisles.has(c.roadId)) return false;
          const road = city.roads[c.roadId]!;
          const lane = net.lanes[net.index.lane.get(`${c.roadId}#${c.lane}`)!]!;
          return !nodes.some((id) => {
            const node = city.nodes[id]!,
              source = node.provenance.osmIds?.[0];
            return (
              source !== undefined &&
              road.provenance.osmIds?.some((osm) => ways.get(osm)?.nd.includes(source)) &&
              nearestOnPolyline(road.centerline, node.pos).away <= 1 &&
              Math.abs(nearestOnPolyline(lane.polyline, node.pos).along - c.positionM) < 1
            );
          });
        });
    for (const id of nodes) {
      const connected = publicRoads.some((r) => r.from === id || r.to === id);
      if (connected && !fallback.length) continue;
      const node = city.nodes[id]!,
        source = node.provenance.osmIds?.[0];
      if (
        source === undefined ||
        lot.exclusions?.some((ring) => pointInPolygon(node.pos, [...ring, ring[0]!]))
      )
        continue;
      const mouths = (lot.aisles ?? [])
        .map((id) => city.roads[id]!)
        .filter((r) => r.from === id || r.to === id);
      const mapped = publicRoads.filter(
        (r) =>
          r.provenance.osmIds?.some((osm) => ways.get(osm)?.nd.includes(source)) &&
          nearestOnPolyline(r.centerline, node.pos).away <= 1,
      );
      for (const road of mapped) {
        if (connected && road !== mapped[0]) continue;
        if (!mouths.every((r) => (r.layer ?? 0) === (road.layer ?? 0))) continue;
        if (['no', 'delivery'].includes(road.access?.car ?? road.access?.all ?? 'yes')) continue;
        const roadDirection = nearestOnPolyline(road.centerline, node.pos).direction;
        for (const mouth of mouths) {
          const incoming = mouth.from === id;
          if (['no', 'delivery'].includes(mouth.access?.car ?? mouth.access?.all ?? 'yes'))
            continue;
          const line = incoming ? mouth.centerline : mouth.centerline.toReversed();
          const dx = line[1]!.x - line[0]!.x,
            dy = line[1]!.y - line[0]!.y;
          const side = roadDirection.x * dy - roadDirection.y * dx;
          // Use the edge lane facing the source mouth, including left-side accesses
          // on one-way roads. Provenance selects this carriageway, never its neighbour.
          const target = connected ? mouth : road;
          const laneIndex = connected
            ? mouth.lanes.findIndex((l) => l.allowed.includes('car'))
            : side > 0
              ? road.lanes.length - 1
              : 0;
          if (laneIndex < 0 || !target.lanes[laneIndex]!.allowed.includes('car')) continue;
          const lane = net.lanes[net.index.lane.get(`${target.id}#${laneIndex}`)!]!;
          const hit = nearestOnPolyline(lane.polyline, node.pos);
          const direction = incoming ? 'in' : 'out';
          const portal: Connector = {
            id: allocateId(city, 'c'),
            roadId: target.id,
            lane: laneIndex,
            positionM: hit.along,
            direction,
            throughputPerMin: 30,
          };
          portals.push(portal);
          mappedPortals.push({
            connectorId: portal.id,
            nodeId: id,
            aisleRoadId: mouth.id,
            direction,
          });
          restored.add(id);
        }
      }
    }
    if (!portals.length) continue;
    if (fallback.length) {
      // A nearest-road driveway was only a fallback for the missing mapped mouth.
      // Move its IDs to the real accesses rather than leaving a second shortcut.
      for (const [index, old] of fallback.entries()) {
        const portal = portals[index];
        if (portal) {
          for (const mapped of mappedPortals)
            if (mapped.connectorId === portal.id) mapped.connectorId = old.id;
          Object.assign(portal, { id: old.id, throughputPerMin: old.throughputPerMin });
        }
      }
      lot.connectors = [...lot.connectors.filter((c) => !fallback.includes(c)), ...portals];
      lot.provenance.inferred = lot.provenance.inferred?.filter((value) => value !== 'driveway');
    } else lot.connectors.push(...portals);
    lot.mappedPortals = mappedPortals;
    (lot.provenance.inferred ??= []).push('mappedLotPortals');
  }
  for (let i = diagnostics.length - 1; i >= 0; i--)
    if (
      diagnostics[i]!.code === 'parking_entry_unreachable' &&
      diagnostics[i]!.refs.some((id) => restored.has(id))
    )
      diagnostics[i] = {
        ...diagnostics[i]!,
        severity: 'info',
        code: 'parking_mapped_portal',
        message:
          'Mapped mouth uses a parking portal on its source street; the aisle remains separate from through-road routing',
      };
}

/** Restore mapped aisle joins after public-road allocation, retaining unrelated import IDs. */
export function joinLotAisles(
  city: City,
  data: OsmData,
  publicRoads: Road[],
  aisles: { id: string; holes: Vec2[][] }[],
  diagnostics: Diagnostic[],
  publicGeometry: CompiledCity,
): { compiled: CompiledCity; nodes: string[] } | undefined {
  const ways = new Map(data.way.map((way) => [way.id, way]));
  const grouped = new Set(Object.values(city.junctionGroups ?? {}).flatMap((g) => g.nodes));
  const nodes = new Set(
    aisles.flatMap(({ id, holes }) =>
      [city.roads[id]!.from, city.roads[id]!.to].filter(
        (node) => !holes.some((ring) => pointInPolygon(city.nodes[node]!.pos, [...ring, ring[0]!])),
      ),
    ),
  );
  const candidates = [...nodes].flatMap((id) => {
    const node = city.nodes[id]!;
    const source = node.provenance.osmIds?.[0];
    if (source === undefined) return [];
    if (publicRoads.some((road) => road.from === id || road.to === id)) return [];
    const mapped = publicRoads.filter(
      (road) =>
        road.from !== id &&
        road.to !== id &&
        road.provenance.osmIds?.some((osmId) => ways.get(osmId)?.nd.includes(source)),
    );
    if (!mapped.length) return [];
    const roads = mapped.filter((road) =>
      road.centerline.slice(1, -1).some((p) => p.x === node.pos.x && p.y === node.pos.y),
    );
    if (!roads.length) {
      diagnostics.push({
        severity: 'warning',
        code: 'parking_entry_unreachable',
        refs: [id, ...mapped.map((r) => r.id)],
        message:
          'Mapped interior aisle join has no retained public-road vertex; existing public layout retained',
      });
      return [];
    }
    const aisleLayers = aisles
      .filter(({ id: aisle }) => city.roads[aisle]!.from === id || city.roads[aisle]!.to === id)
      .map(({ id: aisle }) => city.roads[aisle]!.layer ?? 0);
    if (!aisleLayers.length) return [];
    const paired =
      roads.length === 1 ||
      (roads.length === 2 &&
        roads[0]!.from === roads[1]!.to &&
        roads[0]!.to === roads[1]!.from &&
        roads[0]!.streetGroupId !== null &&
        roads[0]!.streetGroupId === roads[1]!.streetGroupId);
    const plain =
      paired &&
      roads.every(
        (road) =>
          road.roadClass === 'service' &&
          road.lanes.length === 1 &&
          road.lanes[0]!.allowed.includes('car') &&
          !['no', 'private', 'delivery'].includes(road.access?.car ?? road.access?.all ?? 'yes') &&
          aisleLayers.every((layer) => layer === (road.layer ?? 0)) &&
          [road.from, road.to].every(
            (end) => city.nodes[end]!.control === 'uncontrolled' && !grouped.has(end),
          ),
      );
    if (!plain) {
      diagnostics.push({
        severity: 'warning',
        code: 'parking_entry_unreachable',
        refs: [id, ...roads.map((r) => r.id)],
        message:
          'Mapped interior aisle join needs a complex public-road split; existing public layout retained',
      });
      return [];
    }
    return [{ node, source }];
  });
  if (!candidates.length) return;
  const replacements = new Map<string, string[]>();
  for (const { node, source } of candidates) {
    const roads = publicRoads.filter(
      (road) =>
        road.from !== node.id &&
        road.to !== node.id &&
        road.provenance.osmIds?.some((osmId) => ways.get(osmId)?.nd.includes(source)) &&
        road.centerline.slice(1, -1).some((p) => p.x === node.pos.x && p.y === node.pos.y),
    );
    const group = roads[0]!.streetGroupId;
    const splitGroup = group === null ? null : `${group}@${node.id}`;
    for (const [direction, road] of roads.entries()) {
      const at = road.centerline.findIndex((p) => p.x === node.pos.x && p.y === node.pos.y);
      const end = city.nodes[road.to]!;
      const id = allocateId(city, 'r');
      const next: Road = {
        ...road,
        id,
        from: node.id,
        centerline: road.centerline.slice(at),
        streetGroupId: direction === 0 ? splitGroup : group,
        provenance: {
          ...road.provenance,
          inferred: [...new Set([...(road.provenance.inferred ?? []), 'lotJunction'])],
        },
      };
      road.to = node.id;
      road.centerline = road.centerline.slice(0, at + 1);
      road.streetGroupId = direction === 0 ? group : splitGroup;
      const crossings = road.crossings;
      delete road.crossings;
      delete next.crossings;
      if (crossings?.start !== undefined) road.crossings = { start: crossings.start };
      if (crossings?.end !== undefined) next.crossings = { end: crossings.end };
      // Lane-specific turns and yield rules still belong to the original downstream end.
      end.minorRoads = end.minorRoads.map((r) => (r === road.id ? id : r));
      end.turnRules = end.turnRules.map((rule) => ({
        ...rule,
        from: rule.from === road.id ? id : rule.from,
        to: rule.to === road.id ? id : rule.to,
      }));
      city.roads[id] = next;
      publicRoads.push(next);
      const original = [...replacements].find(([, ids]) => ids.includes(road.id))?.[0] ?? road.id;
      replacements.set(original, [...(replacements.get(original) ?? [road.id]), id]);
    }
  }
  const geometry = compile({
    ...city,
    places: Object.fromEntries(
      Object.entries(city.places).map(([id, place]) => [id, { ...place, connectors: [] }]),
    ),
    parking: Object.fromEntries(
      Object.entries(city.parking ?? {}).map(([id, facility]) => [
        id,
        { ...facility, connectors: [] },
      ]),
    ),
  });
  if (!geometry.ok) throw new Error('Mapped lot junction split produced invalid geometry');
  const joined = new Set(candidates.map(({ node }) => node.id));
  const affected = new Set(
    Object.values(city.roads)
      .filter((r) => joined.has(r.from) || joined.has(r.to))
      .map((r) => r.id),
  );
  const relocate = (connector: Connector) => {
    const ids =
      replacements.get(connector.roadId) ??
      (affected.has(connector.roadId) ? [connector.roadId] : undefined);
    if (!ids) return;
    const old =
      publicGeometry.lanes[
        publicGeometry.index.lane.get(`${connector.roadId}#${connector.lane}`)!
      ]!;
    const point = pointAtDistance(old.polyline, old.cumulative, connector.positionM);
    const best = ids
      .map((roadId) => {
        const lane =
          geometry.compiled.lanes[
            geometry.compiled.index.lane.get(`${roadId}#${connector.lane}`)!
          ]!;
        return { roadId, hit: nearestOnPolyline(lane.polyline, point) };
      })
      .sort((a, b) => a.hit.away - b.hit.away)[0]!;
    connector.roadId = best.roadId;
    connector.positionM = best.hit.along;
  };
  const seen = new Set<Connector>();
  for (const owner of [...Object.values(city.places), ...Object.values(city.parking ?? {})])
    for (const connector of owner.connectors)
      if (!seen.has(connector)) {
        seen.add(connector);
        relocate(connector);
      }
  return { compiled: geometry.compiled, nodes: candidates.map(({ node }) => node.id) };
}
