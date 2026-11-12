import type { City, Connector } from '../src/schema';
import { compile } from '../src/network';
import { nearestOnPolyline, pointAtDistance } from '../src/geo/polyline';

/** TASK-104 oracle: remove appended aisles/nodes/lot facilities, restoring only import metadata.
 * TASK-144 also contracts the public-road sections split at real, appended aisle nodes. */
export function withoutLotAisles(source: City): City {
  const city = structuredClone(source);
  const lots = Object.values(city.parking ?? {}).filter((lot) => lot.kind === 'lot');
  if (!lots.length) return city;
  const firstId = Math.min(...lots.map((lot) => Number(lot.id.slice(3))));
  const aisles = new Set(lots.flatMap((lot) => lot.aisles ?? []));
  const joins = Object.values(city.nodes).filter(
    (node) =>
      Number(node.id.slice(2)) >= firstId &&
      Object.values(city.roads).some(
        (r) => !aisles.has(r.id) && (r.from === node.id || r.to === node.id),
      ),
  );
  const before = joins.length ? compile(source) : undefined;
  if (before && !before.ok) throw new Error('Aisle oracle needs a valid imported city');
  for (const lot of lots) for (const id of lot.aisles ?? []) delete city.roads[id];
  const replacements = new Map<string, string>();
  const changed = new Set<string>();
  for (const node of joins) {
    for (const incoming of Object.values(city.roads).filter((r) => r.to === node.id)) {
      const candidates = Object.values(city.roads).filter(
        (r) => r.from === node.id && r.to !== incoming.from,
      );
      if (candidates.length !== 1)
        throw new Error('Aisle oracle expects a simple split service road');
      const next = candidates[0]!;
      if (JSON.stringify(incoming.provenance) !== JSON.stringify(next.provenance))
        throw new Error('Aisle oracle cannot join different source roads');
      changed.add(incoming.id);
      changed.add(next.id);
      replacements.set(next.id, incoming.id);
      incoming.to = next.to;
      incoming.centerline.push(...next.centerline.slice(1));
      incoming.streetGroupId = incoming.streetGroupId?.replace(/@n:\d+/g, '') ?? null;
      if (next.crossings?.end !== undefined)
        incoming.crossings = { ...incoming.crossings, end: next.crossings.end };
      const end = city.nodes[next.to]!;
      end.minorRoads = end.minorRoads.map((id) => (id === next.id ? incoming.id : id));
      end.turnRules = end.turnRules.map((rule) => ({
        ...rule,
        from: rule.from === next.id ? incoming.id : rule.from,
        to: rule.to === next.id ? incoming.id : rule.to,
      }));
      delete city.roads[next.id];
    }
  }
  for (const id of Object.keys(city.nodes))
    if (Number(id.slice(2)) >= firstId) delete city.nodes[id];
  // TASK-102's garages are allocated before the lots and stay.
  for (const lot of Object.values(city.parking ?? {}))
    if (lot.kind !== 'garage') delete city.parking![lot.id];
  if (!Object.keys(city.parking!).length) delete city.parking;
  // TASK-110's walk network is allocated after the lots.
  delete city.walk;
  if (before?.ok) {
    const geometry = compile({
      ...city,
      places: Object.fromEntries(
        Object.entries(city.places).map(([id, p]) => [id, { ...p, connectors: [] }]),
      ),
      parking: Object.fromEntries(
        Object.entries(city.parking ?? {}).map(([id, p]) => [id, { ...p, connectors: [] }]),
      ),
    });
    if (!geometry.ok) throw new Error('Aisle oracle produced invalid contracted geometry');
    const seen = new Set<Connector>();
    for (const owner of [...Object.values(city.places), ...Object.values(city.parking ?? {})])
      for (const connector of owner.connectors) {
        if (!changed.has(connector.roadId) || seen.has(connector)) continue;
        seen.add(connector);
        const original =
          before.compiled.connectors[before.compiled.index.connector.get(connector.id)!]!;
        const lane = before.compiled.lanes[original.lane]!;
        const point = pointAtDistance(lane.polyline, lane.cumulative, original.positionM);
        while (replacements.has(connector.roadId))
          connector.roadId = replacements.get(connector.roadId)!;
        const target =
          geometry.compiled.lanes[
            geometry.compiled.index.lane.get(`${connector.roadId}#${connector.lane}`)!
          ]!;
        connector.positionM = nearestOnPolyline(target.polyline, point).along;
      }
  }
  city.nextId = firstId;
  if (city.geo)
    city.geo.source.inferredCount = [
      ...Object.values(city.nodes),
      ...Object.values(city.nodes).flatMap((node) => node.turnRules),
      ...Object.values(city.roads),
      ...Object.values(city.places),
      ...Object.values(city.parking ?? {}),
    ].reduce((sum, entity) => sum + (entity.provenance.inferred?.length ?? 0), 0);
  return city;
}
