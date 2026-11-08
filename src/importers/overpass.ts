import type { ImportOptions } from './types';

export type Bbox = NonNullable<ImportOptions['bbox']>;
export const queryVersion = 4;
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

export function buildQuery(bbox: Bbox, context = true): string {
  const error = areaError(bbox);
  if (error) throw new Error(error);
  const [w, s, e, n] = bbox;
  const surroundings = context
    ? [
        '[building][building!=no]',
        '[natural~"^(water|wood|scrub|grassland)$"]',
        '[waterway~"^(riverbank|river|stream|canal)$"]',
        '[landuse~"^(reservoir|basin|grass|meadow|forest|recreation_ground|village_green|allotments|cemetery|residential|commercial|retail|industrial|railway|construction)$"]',
        '[leisure~"^(park|garden|pitch|playground)$"]',
        '[amenity=parking]',
        '[highway~"^(footway|path|cycleway|pedestrian|steps|track)$"]',
        '[railway~"^(rail|light_rail|subway|narrow_gauge|tram)$"]',
      ]
        .map(
          (tags) =>
            'way' +
            tags +
            '(' +
            [s, w, n, e].join(',') +
            ');rel' +
            tags +
            '[type=multipolygon](' +
            [s, w, n, e].join(',') +
            ');',
        )
        .join('') +
      `node[highway=street_lamp](${s},${w},${n},${e});` +
      `node[natural=tree](${s},${w},${n},${e});way[natural=tree_row](${s},${w},${n},${e});`
    : '';
  return `[out:xml][timeout:60];way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$"][service!~"^(parking_aisle|driveway)$"](${s},${w},${n},${e})->.roads;(.roads;rel(bw.roads)[type=restriction];${surroundings});(._;>>;);out body;`;
}

export async function fetchOverpass(
  bbox: Bbox,
  signal: AbortSignal,
  endpoint = defaultEndpoint,
  context = true,
) {
  const query = buildQuery(bbox, context);
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
