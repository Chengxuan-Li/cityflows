import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { importOsmCached } from './city-cache';
import { fetchTerrain } from '../src/importers/terrain';

mkdirSync('fixtures/terrain', { recursive: true });
mkdirSync('node_modules/.cache/terrain-tiles', { recursive: true });
for (const name of ['munich-donnersberger', 'sindelfingen-a81']) {
  const result = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
    importerVersion: '1',
    terrain: false,
  });
  if (!result.ok || !result.city.geo) throw new Error(`Cannot import ${name}`);
  const started = performance.now();
  const terrain = await fetchTerrain(result.city.geo, {
    cache: async (key, bytes) => {
      const path = `node_modules/.cache/terrain-tiles/${key.replaceAll('/', '-')}.png`;
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
      cityBytes: Buffer.byteLength(JSON.stringify(result.city)),
      minM,
      maxM,
      fetchMs: performance.now() - started,
    }),
  );
}
