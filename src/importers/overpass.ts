import type { ImportOptions } from './types';

export type Bbox = NonNullable<ImportOptions['bbox']>;
export const queryVersion = 1;
export const defaultEndpoint =
  import.meta.env.VITE_OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
let active = false;

export function areaError([west, south, east, north]: Bbox): string | null {
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    south < -85 ||
    north > 85 ||
    west >= east ||
    south >= north
  )
    return 'Enter valid west, south, east and north bounds.';
  const area =
    ((6371 ** 2 * (east - west) * Math.PI) / 180) *
    (Math.sin((north * Math.PI) / 180) - Math.sin((south * Math.PI) / 180));
  return area > 50 ? 'Choose an area of 50 km² or less.' : null;
}

export function buildQuery(bbox: Bbox): string {
  const error = areaError(bbox);
  if (error) throw new Error(error);
  const [w, s, e, n] = bbox;
  return `[out:xml][timeout:60];way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$"][service!~"^(parking_aisle|driveway)$"](${s},${w},${n},${e})->.roads;(.roads;rel(bw.roads)[type=restriction];);(._;>>;);out body;`;
}

export async function fetchOverpass(bbox: Bbox, signal: AbortSignal, endpoint = defaultEndpoint) {
  const query = buildQuery(bbox);
  if (active) throw new Error('An Overpass request is already running.');
  active = true;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal,
    });
    if (!response.ok)
      throw new Error(
        `Overpass returned ${response.status}. Try again later or choose another endpoint.`,
      );
    return await response.text();
  } finally {
    active = false;
  }
}
