import { readFileSync } from 'node:fs';
import { encode } from 'fast-png';
import type { Page } from '@playwright/test';
import { createGeoReference, lonLatToLocal } from '../../src/geo/projection';
import { parseOsm } from '../../src/importers/osm/parse';
import type { City } from '../../src/schema/city';

/** Offline tile boundary: reconstruct Terrarium PNGs from the committed elevation grid.
 * The wizard and worker still run their real download/decode/resampling path. */
export async function fixtureTerrain(page: Page, osm: string) {
  const name = osm.replaceAll('\\', '/').split('/').at(-1)!.replace('.osm', '');
  const grid = JSON.parse(readFileSync(`fixtures/terrain/${name}.json`, 'utf8')) as NonNullable<
    City['terrain']
  >;
  const parsed = parseOsm(readFileSync(osm, 'utf8'));
  if (typeof parsed === 'string' || !parsed.bounds) throw new Error('Fixture bounds missing');
  const [west, south, east, north] = parsed.bounds;
  const geo = createGeoReference({ lon: (west + east) / 2, lat: (south + north) / 2 });
  const bytes = Buffer.from(grid.heights, 'base64');
  const at = (c: number, r: number) => grid.baseM + bytes.readInt16LE((r * grid.cols + c) * 2) / 10;
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/**', async (route) => {
    const [, z, x, y] = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(route.request().url())!;
    const size = 256 * 2 ** Number(z),
      pixels = new Uint8Array(256 * 256 * 3);
    for (let row = 0; row < 256; row++)
      for (let col = 0; col < 256; col++) {
        const px = Number(x) * 256 + col + 0.5,
          py = Number(y) * 256 + row + 0.5;
        const p = lonLatToLocal(geo, {
          lon: (px / size) * 360 - 180,
          lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / size))) * 180) / Math.PI,
        });
        const c = Math.max(0, Math.min(grid.cols - 1, (p.x - grid.originM.x) / grid.cellM));
        const r = Math.max(0, Math.min(grid.rows - 1, (p.y - grid.originM.y) / grid.cellM));
        const c0 = Math.min(grid.cols - 2, Math.floor(c)),
          r0 = Math.min(grid.rows - 2, Math.floor(r));
        const dx = c - c0,
          dy = r - r0;
        const h =
          (at(c0, r0) * (1 - dx) + at(c0 + 1, r0) * dx) * (1 - dy) +
          (at(c0, r0 + 1) * (1 - dx) + at(c0 + 1, r0 + 1) * dx) * dy;
        const encoded = Math.round((h + 32768) * 256),
          i = (row * 256 + col) * 3;
        pixels[i] = encoded >> 16;
        pixels[i + 1] = (encoded >> 8) & 255;
        pixels[i + 2] = encoded & 255;
      }
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(encode({ width: 256, height: 256, data: pixels, channels: 3 })),
      headers: { 'access-control-allow-origin': '*' },
    });
  });
}
