import type { Vec2 } from './vec2';

export interface LonLat {
  lon: number;
  lat: number;
}

/**
 * Local metric frame: Web Mercator scaled by cos(lat0) around an origin, so distances are true
 * meters at the origin latitude. x grows east, y grows south (screen orientation). Scale error
 * grows with distance from the origin; docs/architecture.md states the extent limit.
 */
export interface GeoReference {
  origin: LonLat;
  /** cos(origin.lat), applied to Mercator meters. */
  scale: number;
}

const EARTH_RADIUS_M = 6378137;
const DEG = Math.PI / 180;

function mercatorY(latDeg: number): number {
  return EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (latDeg * DEG) / 2));
}

export function createGeoReference(origin: LonLat): GeoReference {
  return { origin, scale: Math.cos(origin.lat * DEG) };
}

export function lonLatToLocal(ref: GeoReference, p: LonLat): Vec2 {
  const x = EARTH_RADIUS_M * (p.lon - ref.origin.lon) * DEG * ref.scale;
  const y = (mercatorY(ref.origin.lat) - mercatorY(p.lat)) * ref.scale;
  return { x, y };
}

export function localToLonLat(ref: GeoReference, p: Vec2): LonLat {
  const lon = ref.origin.lon + p.x / (EARTH_RADIUS_M * ref.scale * DEG);
  const my = mercatorY(ref.origin.lat) - p.y / ref.scale;
  const lat = (2 * Math.atan(Math.exp(my / EARTH_RADIUS_M)) - Math.PI / 2) / DEG;
  return { lon, lat };
}
