import { decode } from 'fast-png';
import { localToLonLat, lonLatToLocal } from '../geo/projection';
import type { City } from '../schema/city';
import type { ImportResult } from './types';
import { cachedTerrainTile } from './cache';

export const terrainSource =
  'AWS Terrain Tiles (Mapzen, SRTM, GMTED2010, ETOPO1; https://registry.opendata.aws/terrain-tiles/)';
const zoom = 15;
const worldPixels = 256 * 2 ** zoom;
type TileCache = (key: string, bytes?: Uint8Array) => Promise<Uint8Array | undefined>;

/** Shared worker/Node decoder. Pixel coordinates refer to pixel centres, including tile seams. */
export async function fetchTerrain(
  geo: NonNullable<City['geo']>,
  options: { cellM?: number; fetch?: typeof fetch; cache?: TileCache } = {},
): Promise<NonNullable<City['terrain']>> {
  const cellM = options.cellM ?? 10;
  const nw = lonLatToLocal(geo, { lon: geo.bbox[0], lat: geo.bbox[3] });
  const se = lonLatToLocal(geo, { lon: geo.bbox[2], lat: geo.bbox[1] });
  const originM = {
    x: Math.floor((nw.x - 100) / cellM) * cellM,
    y: Math.floor((nw.y - 100) / cellM) * cellM,
  };
  const cols = Math.ceil((se.x + 100 - originM.x) / cellM) + 1;
  const rows = Math.ceil((se.y + 100 - originM.y) / cellM) + 1;
  const pixel = (x: number, y: number) => {
    const p = localToLonLat(geo, { x, y });
    const lat = (p.lat * Math.PI) / 180;
    return {
      x: ((p.lon + 180) / 360) * worldPixels - 0.5,
      y: ((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * worldPixels - 0.5,
    };
  };
  const first = pixel(originM.x, originM.y),
    last = pixel(originM.x + (cols - 1) * cellM, originM.y + (rows - 1) * cellM);
  const tiles = new Map<string, ReturnType<typeof decode>>();
  const cache = options.cache ?? cachedTerrainTile;
  const jobs: { x: number; y: number }[] = [];
  for (let y = Math.floor(first.y / 256); y <= Math.floor((last.y + 1) / 256); y++)
    for (let x = Math.floor(first.x / 256); x <= Math.floor((last.x + 1) / 256); x++)
      jobs.push({ x, y });
  // Bound the requests; imports are small, but the maximum import can cover many tiles.
  await Promise.all(
    Array.from({ length: Math.min(6, jobs.length) }, async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) {
        const key = `${zoom}/${job.x}/${job.y}`;
        let bytes = await cache(key);
        const downloaded = !bytes;
        if (!bytes) {
          const response = await (options.fetch ?? fetch)(
            `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`,
            { signal: AbortSignal.timeout(20_000) },
          );
          if (!response.ok) throw new Error(`Elevation tile ${key}: HTTP ${response.status}`);
          bytes = new Uint8Array(await response.arrayBuffer());
        }
        const tile = decode(bytes);
        if (
          tile.width !== 256 ||
          tile.height !== 256 ||
          tile.depth !== 8 ||
          (tile.channels !== 3 && tile.channels !== 4)
        )
          throw new Error(`Elevation tile ${key}: expected 256 × 256 RGB Terrarium PNG`);
        tiles.set(`${job.x}/${job.y}`, tile);
        if (downloaded) await cache(key, bytes);
      }
    }),
  );
  const at = (x: number, y: number) => {
    const tile = tiles.get(`${Math.floor(x / 256)}/${Math.floor(y / 256)}`)!;
    const i = ((y % 256) * 256 + (x % 256)) * tile.channels;
    return tile.data[i]! * 256 + tile.data[i + 1]! + tile.data[i + 2]! / 256 - 32768;
  };
  const samples = new Float64Array(cols * rows);
  let min = Infinity,
    max = -Infinity;
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const p = pixel(originM.x + col * cellM, originM.y + row * cellM);
      const x = Math.floor(p.x),
        y = Math.floor(p.y),
        dx = p.x - x,
        dy = p.y - y;
      const h =
        (at(x, y) * (1 - dx) + at(x + 1, y) * dx) * (1 - dy) +
        (at(x, y + 1) * (1 - dx) + at(x + 1, y + 1) * dx) * dy;
      samples[row * cols + col] = h;
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  const baseM = Math.floor((min + max) / 2);
  const bytes = new Uint8Array(cols * rows * 2),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const h = Math.round((samples[i]! - baseM) * 10);
    if (h < -32768 || h > 32767) throw new Error('Terrain exceeds the decimetre Int16 range');
    view.setInt16(i * 2, h, true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { source: terrainSource, originM, cellM, cols, rows, baseM, heights: btoa(binary) };
}

/** A failed elevation request must not discard an otherwise usable road import. */
export async function includeTerrain(
  result: ImportResult,
  enabled = true,
  options: Parameters<typeof fetchTerrain>[1] = {},
): Promise<ImportResult> {
  if (!enabled || !result.ok || !result.city.geo) return result;
  try {
    const terrain = await fetchTerrain(result.city.geo, options);
    return { ...result, city: { ...result.city, terrain } };
  } catch (error) {
    return {
      ...result,
      diagnostics: [
        ...result.diagnostics,
        {
          severity: 'warning',
          code: 'terrain_unavailable',
          refs: [],
          message: `Imported without terrain: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
