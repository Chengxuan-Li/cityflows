import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import process from 'node:process';
import { importOsmCached } from './city-cache';
import { importFreiburg } from './freiburg';
import { fetchTerrain } from '../src/importers/terrain';
import type { City } from '../src/schema';

// Fetch the terrain fixtures of the named cities (default: Munich and Sindelfingen) from AWS
// Terrain Tiles. Tiles are kept in CITYFLOWS_TERRAIN_TILES (default
// node_modules/.cache/terrain-tiles) and read from there before any download.
//   node --experimental-strip-types --import ./bench/register.ts bench/terrain-fetch.ts freiburg

const fixture = (name: string) => () => {
  const result = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
    importerVersion: '1',
    terrain: false,
  });
  if (!result.ok) throw new Error(`Cannot import ${name}`);
  return result.city;
};
const cities: Record<string, () => City> = {
  'munich-donnersberger': fixture('munich-donnersberger'),
  'sindelfingen-a81': fixture('sindelfingen-a81'),
  freiburg: importFreiburg,
};
const names = process.argv.slice(2);
const tiles = process.env.CITYFLOWS_TERRAIN_TILES ?? 'node_modules/.cache/terrain-tiles';
mkdirSync('fixtures/terrain', { recursive: true });
mkdirSync(tiles, { recursive: true });
for (const name of names.length ? names : ['munich-donnersberger', 'sindelfingen-a81']) {
  const city = cities[name]?.();
  if (!city?.geo) throw new Error(`Cannot import ${name}`);
  const started = performance.now();
  const terrain = await fetchTerrain(city.geo, {
    cache: async (key, bytes) => {
      const path = `${tiles}/${key.replaceAll('/', '-')}.png`;
      if (bytes) {
        writeFileSync(path, bytes);
        return bytes;
      }
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
    },
  });
  const json = JSON.stringify(terrain);
  writeFileSync(`fixtures/terrain/${name}.json`, json + '\n');
  const bytes = Buffer.from(terrain.heights, 'base64');
  let minM = Infinity,
    maxM = -Infinity;
  for (let i = 0; i < bytes.length; i += 2) {
    const h = terrain.baseM + bytes.readInt16LE(i) / 10;
    minM = Math.min(minM, h);
    maxM = Math.max(maxM, h);
  }
  console.info(
    JSON.stringify({
      city: name,
      cols: terrain.cols,
      rows: terrain.rows,
      cellM: terrain.cellM,
      bytes: Buffer.byteLength(json),
      cityBytes: Buffer.byteLength(JSON.stringify(city)),
      minM,
      maxM,
      fetchMs: performance.now() - started,
    }),
  );
}
