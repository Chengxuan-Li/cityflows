import { localToLonLat } from '../geo/projection';
import type { Vec2 } from '../geo/vec2';
import type { City } from '../schema';

function exteriorRing(points: Vec2[], geographic: boolean): Vec2[] {
  const first = points[0]!;
  const last = points.at(-1)!;
  const ring = first.x === last.x && first.y === last.y ? points.slice(0, -1) : [...points];
  if (geographic) {
    // Geographic y points north. A positive signed area in the local frame winds clockwise there.
    let area = 0;
    for (let i = 1; i < ring.length - 1; i++) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      area += (a.x - first.x) * (b.y - first.y) - (a.y - first.y) * (b.x - first.x);
    }
    if (area > 0) return [first, ...ring.slice(1).reverse(), first];
  }
  return [...ring, first];
}

export function exportGeoJson(city: City) {
  const geo = city.geo;
  function position(point: Vec2): [number, number] {
    if (!geo) return [point.x, point.y];
    const { lon, lat } = localToLonLat(geo, point);
    return [lon, lat];
  }
  const roads = Object.keys(city.roads)
    .sort()
    .map((id) => {
      const road = city.roads[id]!;
      return {
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: road.centerline.map(position) },
        properties: {
          'cityflows:id': id,
          lanes: road.lanes.length,
          oneway: true,
          speed: road.speedLimitMps,
          class: road.roadClass,
          name: road.name,
        },
      };
    });
  const places = Object.keys(city.places)
    .sort()
    .map((id) => {
      const { shape, name, kind, population, jobs } = city.places[id]!;
      return {
        type: 'Feature' as const,
        geometry:
          shape.kind === 'point'
            ? { type: 'Point' as const, coordinates: position(shape.pos) }
            : {
                type: 'Polygon' as const,
                coordinates: [exteriorRing(shape.ring, geo !== null).map(position)],
              },
        properties: { 'cityflows:id': id, name, kind, population, jobs },
      };
    });
  return {
    type: 'FeatureCollection' as const,
    'cityflows:coordinates': geo ? ('lonlat' as const) : ('local' as const),
    'cityflows:schemaVersion': city.schemaVersion,
    'cityflows:notice': 'Synthetic traffic, not observed traffic',
    ...(geo?.source.attribution ? { 'cityflows:attribution': geo.source.attribution } : {}),
    'cityflows:lossy': [
      'nodeIds',
      'nodeLayers',
      'junctionControls',
      'turnRules',
      'signals',
      'lanes.widthM',
      'lanes.allowed',
      'lateralOffsetM',
      'streetGroupId',
      'connectors',
      'attraction',
      'capacity',
      'profile',
      'events',
      'provenance',
    ],
    features: [...roads, ...places],
  };
}
