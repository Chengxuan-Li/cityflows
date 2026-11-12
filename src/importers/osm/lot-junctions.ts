import {
  cumulativeLengths,
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineCrossings,
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
  publicGeometry?: CompiledCity,
): void {
  const ways = new Map(data.way.map((way) => [way.id, way]));
  const grouped = new Set(Object.values(city.junctionGroups ?? {}).flatMap((g) => g.nodes));
  const eligible = aisles.filter(({ id, holes }) => {
    if (!holes.length) return true;
    const line = city.roads[id]!.centerline;
    const rings = holes.map((ring) => [...ring, ring[0]!]);
    const cumulative = cumulativeLengths(line);
    const cuts = [
      0,
      cumulative.at(-1)!,
      ...rings.flatMap((ring) => polylineCrossings(line, ring).map((hit) => hit.alongA)),
    ].sort((a, b) => a - b);
    return cuts.some(
      (at, i) =>
        i > 0 &&
        at > cuts[i - 1]! &&
        !rings.some((ring) =>
          pointInPolygon(pointAtDistance(line, cumulative, (at + cuts[i - 1]!) / 2), ring),
        ),
    );
  });
  const nodes = new Set(eligible.flatMap(({ id }) => [city.roads[id]!.from, city.roads[id]!.to]));
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
    const aisleLayers = eligible
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
          !['no', 'private', 'delivery'].includes(road.access?.car ?? road.access?.all ?? 'yes') &&
          aisleLayers.includes(road.layer ?? 0) &&
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
  const before = publicGeometry ? { ok: true as const, compiled: publicGeometry } : compile(city);
  if (!before.ok) {
    diagnostics.push({
      severity: 'warning',
      code: 'parking_entry_unreachable',
      refs: candidates.map(({ node }) => node.id),
      message:
        'Mapped interior aisle joins cannot be split while the existing public geometry is invalid',
    });
    return;
  }
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
  const relocate = (connector: Connector) => {
    const ids = replacements.get(connector.roadId);
    if (!ids) return;
    const old =
      before.compiled.lanes[
        before.compiled.index.lane.get(`${connector.roadId}#${connector.lane}`)!
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
}
