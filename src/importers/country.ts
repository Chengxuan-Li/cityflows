import type { City } from '../schema';

// Approximate offline boxes, not political boundaries. More specific boxes come first.
const boxes = [
  ['ch', 5.95, 45.82, 10.5, 47.81],
  ['de', 5.87, 47.27, 15.04, 55.06],
  ['gb', -5.85, 49.9, 1.8, 55.8],
  ['gb', -8.7, 54.8, -0.5, 61],
  ['gb', -8.2, 54, -5.4, 55.4],
  ['us', -125, 24, -82, 49.1],
  ['us', -82, 24, -66, 43.5],
  ['us', -71.1, 43.5, -66.8, 47.5],
  ['us', -180, 51, -130, 72],
  ['us', -161, 18, -154, 23],
] as const;

export function geographicCountry(geo: City['geo']): City['country'] {
  if (!geo) return;
  const { lon, lat } = geo.origin;
  return boxes.find(([, w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n)?.[0];
}
