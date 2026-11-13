import {
  cumulativeLengths,
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { compile, type CompiledCity, type Diagnostic } from '../../network';
import { allocateId, type City, type Connector, type Road } from '../../schema';
import type { OsmData } from './parse';

/** Restore mapped aisle joins after public-road allocation, retaining unrelated import IDs. */
export function joinLotAisles(
  city: City,
  data: OsmData,
  publicRoads: Road[],
  aisles: { id: string; holes: Vec2[][] }[],
  diagnostics: Diagnostic[],
  publicGeometry: CompiledCity,
  extended = false,
): { compiled: CompiledCity; nodes: string[] } | undefined {
  const ways = new Map(data.way.map((way) => [way.id, way]));
  const grouped = new Set(Object.values(city.junctionGroups ?? {}).flatMap((g) => g.nodes));
  const inner = new Set(Object.values(city.junctionGroups ?? {}).flatMap((g) => g.innerRoads));
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
    const roads = mapped.filter((road) => {
      if (!extended)
        return road.centerline.slice(1, -1).some((p) => p.x === node.pos.x && p.y === node.pos.y);
      const hit = nearestOnPolyline(road.centerline, node.pos);
      const length = cumulativeLengths(road.centerline).at(-1)!;
      // Only a shared source node qualifies. Smoothing may have replaced its vertex;
      // follow that existing line within one metre, never invent a public-road bend.
      return hit.away <= 1 && hit.along > 1 && hit.along < length - 1;
    });
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
          (extended || (road.roadClass === 'service' && road.lanes.length === 1)) &&
          road.lanes.some((lane) => lane.allowed.includes('car')) &&
          !(extended ? ['no', 'delivery'] : ['no', 'private', 'delivery']).includes(
            road.access?.car ?? road.access?.all ?? 'yes',
          ) &&
          aisleLayers.every((layer) => layer === (road.layer ?? 0)) &&
          !inner.has(road.id) &&
          !Object.values(city.parking ?? {}).some((p) => p.strip?.roadId === road.id) &&
          (extended ||
            [road.from, road.to].every(
              (end) => city.nodes[end]!.control === 'uncontrolled' && !grouped.has(end),
            )),
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
    return [
      {
        node,
        source,
        pos: extended ? nearestOnPolyline(roads[0]!.centerline, node.pos).point : node.pos,
      },
    ];
  });
  if (!candidates.length) return;
  const replacements = new Map<string, string[]>();
  for (const { node, source, pos } of candidates) {
    const roads = publicRoads.filter(
      (road) =>
        road.from !== node.id &&
        road.to !== node.id &&
        road.provenance.osmIds?.some((osmId) => ways.get(osmId)?.nd.includes(source)) &&
        (extended
          ? nearestOnPolyline(road.centerline, pos).away < 1e-6
          : road.centerline.slice(1, -1).some((p) => p.x === node.pos.x && p.y === node.pos.y)),
    );
    if (extended) {
      node.pos = pos;
      for (const { id } of aisles) {
        const road = city.roads[id]!;
        if (road.from === node.id) road.centerline[0] = pos;
        if (road.to === node.id) road.centerline[road.centerline.length - 1] = pos;
      }
      for (const road of roads) {
        if (road.centerline.some((p) => p.x === pos.x && p.y === pos.y)) continue;
        const hit = nearestOnPolyline(road.centerline, pos);
        const lengths = cumulativeLengths(road.centerline);
        const at = lengths.findIndex((length) => length > hit.along);
        road.centerline.splice(at, 0, pos);
      }
    }
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
      // Group entry programs can live away from the physical downstream node.
      for (const owner of [
        ...Object.values(city.nodes),
        ...Object.values(city.junctionGroups ?? {}),
      ])
        for (const phase of owner.signal?.phases ?? []) {
          for (const movement of phase.groups) if (movement.from === road.id) movement.from = id;
          for (const crossing of phase.walk ?? [])
            if (crossing.roadId === road.id && crossing.end === 'end') crossing.roadId = id;
        }
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
  for (let i = diagnostics.length - 1; i >= 0; i--)
    if (
      diagnostics[i]!.code === 'parking_entry_unreachable' &&
      diagnostics[i]!.refs.some((id) => joined.has(id))
    )
      diagnostics.splice(i, 1);
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
