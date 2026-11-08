import type { City } from '../src/schema';

/** TASK-104 oracle: remove appended aisles/nodes/facilities, restoring only import metadata.
 * No road geometry, turn rule, place, connector or control is reconstructed. */
export function withoutLotAisles(source: City): City {
  const city = structuredClone(source);
  const lots = Object.values(city.parking ?? {}).filter((lot) => lot.kind === 'lot');
  if (!lots.length) return city;
  const firstId = Math.min(...lots.map((lot) => Number(lot.id.slice(3))));
  for (const lot of lots) for (const id of lot.aisles ?? []) delete city.roads[id];
  for (const id of Object.keys(city.nodes))
    if (Number(id.slice(2)) >= firstId) delete city.nodes[id];
  delete city.parking;
  city.nextId = firstId;
  if (city.geo)
    city.geo.source.inferredCount = [
      ...Object.values(city.nodes),
      ...Object.values(city.nodes).flatMap((node) => node.turnRules),
      ...Object.values(city.roads),
      ...Object.values(city.places),
    ].reduce((sum, entity) => sum + (entity.provenance.inferred?.length ?? 0), 0);
  return city;
}
