import { describe, expect, it } from 'vitest';
import { createGeoReference, localToLonLat, lonLatToLocal } from './projection';

const ref = createGeoReference({ lon: -73.98, lat: 40.75 });
const EARTH_RADIUS_M = 6378137;
const DEG = Math.PI / 180;

describe('local metric projection', () => {
  it('maps the origin to (0,0) and north to negative y', () => {
    expect(lonLatToLocal(ref, ref.origin)).toEqual({ x: 0, y: 0 });
    const north = lonLatToLocal(ref, { lon: ref.origin.lon, lat: ref.origin.lat + 0.01 });
    expect(north.x).toBeCloseTo(0, 6);
    expect(north.y).toBeLessThan(0);
  });

  it('is true to scale at the origin latitude', () => {
    // 1 km along the parallel spans 1000 / (R cos lat) radians of longitude.
    const dlonDeg = 1000 / (EARTH_RADIUS_M * Math.cos(40.75 * DEG)) / DEG;
    const east = lonLatToLocal(ref, { lon: ref.origin.lon + dlonDeg, lat: ref.origin.lat });
    expect(east.x).toBeCloseTo(1000, 3);
    // 0.009 degrees of latitude is about 1000 m on the sphere.
    const north = lonLatToLocal(ref, { lon: ref.origin.lon, lat: ref.origin.lat + 0.009 });
    expect(-north.y).toBeGreaterThan(995);
    expect(-north.y).toBeLessThan(1005);
  });

  it('round-trips across a city-sized extent', () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 12_345.6, y: -9_876.5 },
      { x: -20_000, y: 20_000 },
    ]) {
      const back = lonLatToLocal(ref, localToLonLat(ref, p));
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });
});
