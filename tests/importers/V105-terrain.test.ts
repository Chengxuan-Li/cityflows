import { encode } from 'fast-png';
import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { fetchTerrain, includeTerrain } from '../../src/importers/terrain';
import { createGeoReference } from '../../src/geo/projection';
import { fixture } from './fixtures';
import { importOsmCached } from '../../bench/city-cache';

test('V105 a shifted bbox never receives terrain from a different local frame', () => {
  const { xml } = fixture('sindelfingen-a81');
  const result = importOsmCached(xml, { importerVersion: '1', bbox: [8.981, 48.69, 9.0, 48.702] });
  expect(result.ok && result.city.terrain).toBeUndefined();
});

test('V105 bilinear Terrarium resampling crosses tile seams without wrapping a pixel', async () => {
  const seamX = 17200,
    lon = (seamX / 2 ** 15) * 360 - 180;
  const reference = createGeoReference({ lon, lat: 48 });
  const tiles = [100.25, 200.75].map((height) => {
    const pixels = new Uint8Array(256 * 256 * 3),
      encoded = Math.round((height + 32768) * 256);
    for (let i = 0; i < pixels.length; i += 3) {
      pixels[i] = encoded >> 16;
      pixels[i + 1] = (encoded >> 8) & 255;
      pixels[i + 2] = encoded & 255;
    }
    return encode({ width: 256, height: 256, channels: 3, data: pixels });
  });
  const terrain = await fetchTerrain(
    {
      ...reference,
      bbox: [lon - 0.0001, 47.9999, lon + 0.0001, 48.0001],
      source: {
        kind: 'file',
        snapshotDate: null,
        attribution: 'Test',
        importerVersion: 'test',
        inferredCount: 0,
      },
    },
    {
      cache: async () => undefined,
      fetch: async (url) => {
        const x = Number(/\/(\d+)\/\d+\.png$/.exec(String(url))![1]);
        return new Response(new Uint8Array(tiles[x < seamX ? 0 : 1]!));
      },
    },
  );
  const c = Math.round(-terrain.originM.x / terrain.cellM),
    r = Math.round(-terrain.originM.y / terrain.cellM);
  expect(
    terrain.baseM +
      Buffer.from(terrain.heights, 'base64').readInt16LE((r * terrain.cols + c) * 2) / 10,
  ).toBeCloseTo(150.5, 1);
});

test('V105 terrain uses the shared PNG decoder; disabled and failed requests preserve the road import', async () => {
  const { xml, options } = fixture('downtown');
  const plain = importOsm(xml, { ...options, terrain: false });
  if (!plain.ok) throw new Error(JSON.stringify(plain.diagnostics));
  const pixels = new Uint8Array(256 * 256 * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = 128;
    pixels[i + 1] = 123;
    pixels[i + 2] = 128;
  }
  const png = encode({ width: 256, height: 256, channels: 3, data: pixels });
  const fetchTile: typeof fetch = async () => new Response(new Uint8Array(png));
  const on = await includeTerrain(plain, true, { fetch: fetchTile, cache: async () => undefined });
  if (!on.ok) throw new Error('Import failed');
  expect(on.city.terrain?.baseM).toBe(123);
  const heights = Buffer.from(on.city.terrain!.heights, 'base64');
  for (let i = 0; i < heights.length; i += 2) expect(heights.readInt16LE(i)).toBe(5);
  const { terrain, ...roads } = on.city;
  expect(terrain).toBeDefined();
  expect(roads).toEqual(plain.city);
  const failure: typeof fetch = async () => {
    throw new Error('Offline');
  };
  expect(await includeTerrain(plain, false, { fetch: failure })).toBe(plain);
  const failed = await includeTerrain(plain, true, {
    fetch: failure,
    cache: async () => undefined,
  });
  expect(failed.ok && failed.city).toBe(plain.city);
  expect(failed.diagnostics.filter((d) => d.code === 'terrain_unavailable')).toHaveLength(1);
});
