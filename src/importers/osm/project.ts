import { createGeoReference, lonLatToLocal } from '../../geo/projection';
import type { City } from '../../schema';
import type { ImportOptions } from '../types';
import type { OsmData } from './parse';

export function project(
  data: OsmData,
  options: ImportOptions,
  roadNodes: OsmData['node'],
): NonNullable<City['geo']> | string {
  const closed = options.polygon && closeRing(options.polygon);
  if (typeof closed === 'string') return closed;
  const ring = closed;
  let bbox = ring
    ? ([
        Math.min(...ring.map(([lon]) => lon)),
        Math.min(...ring.map(([, lat]) => lat)),
        Math.max(...ring.map(([lon]) => lon)),
        Math.max(...ring.map(([, lat]) => lat)),
      ] as [number, number, number, number])
    : (options.bbox ?? data.bounds);
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
    ...(ring && {
      boundary: ring.slice(0, -1).map(([lon, lat]) => [lon, lat] as [number, number]),
    }),
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

/** The polygon option closed, or why it is not a ring. */
function closeRing(polygon: [number, number][]): [number, number][] | string {
  const first = polygon[0],
    last = polygon.at(-1);
  const ring =
    first && last && (first[0] !== last[0] || first[1] !== last[1]) ? [...polygon, first] : polygon;
  if (
    ring.length < 4 ||
    !ring.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) < 90)
  )
    return 'Expected a polygon of at least three [longitude, latitude] points';
  return ring;
}
