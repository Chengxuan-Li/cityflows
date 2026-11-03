import { createGeoReference, lonLatToLocal } from '../../geo/projection';
import type { City } from '../../schema';
import type { ImportOptions } from '../types';
import type { OsmData } from './parse';

export function project(
  data: OsmData,
  options: ImportOptions,
  roadNodes: OsmData['node'],
): NonNullable<City['geo']> | string {
  let bbox = options.bbox ?? data.bounds;
  if (!bbox) {
    let west = Infinity,
      south = Infinity,
      east = -Infinity,
      north = -Infinity;
    for (const { lat, lon } of roadNodes) {
      west = Math.min(west, lon);
      south = Math.min(south, lat);
      east = Math.max(east, lon);
      north = Math.max(north, lat);
    }
    // A straight east-west or north-south extract can have zero extent on one axis.
    if (west === east) {
      west -= 1e-7;
      east += 1e-7;
    }
    if (south === north) {
      south -= 1e-7;
      north += 1e-7;
    }
    bbox = [west, south, east, north];
  }
  const [west, south, east, north] = bbox;
  if (!(west >= -180 && west < east && east <= 180 && south > -90 && south < north && north < 90)) {
    return 'Expected an ordered bbox [west, south, east, north] in longitude and latitude';
  }
  const ref = createGeoReference({ lon: (west + east) / 2, lat: (south + north) / 2 });
  const nw = lonLatToLocal(ref, { lon: west, lat: north });
  const se = lonLatToLocal(ref, { lon: east, lat: south });
  const width = se.x - nw.x;
  const height = se.y - nw.y;
  if (width > 25000 || height > 25000 || width * height > 50_000_000) {
    return 'OSM bbox must fit within 25 km by 25 km and 50 square km';
  }
  return {
    ...ref,
    bbox: [...bbox],
    source: {
      kind: 'osm',
      snapshotDate: data.meta?.osm_base?.slice(0, 10) ?? null,
      attribution:
        '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)',
      importerVersion: options.importerVersion,
      inferredCount: 0,
    },
  };
}
