import { existsSync, readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { cachePath, importerGraph, importOsmCached } from '../../bench/city-cache';
import { importOsm } from '../../src/importers/osm';
import type { ImportOptions } from '../../src/importers/types';

// TASK-090: the disk cache of real-city imports (bench/city-cache.ts).

test.each([
  ['munich-donnersberger', [11.525, 48.135, 11.545, 48.148]],
  ['sindelfingen-a81', [8.98, 48.69, 9.0, 48.702]],
] as const)(
  'a cache hit of %s equals a fresh import',
  (name, bbox) => {
    vi.stubEnv('CITYFLOWS_NO_CACHE', '');
    const xml = readFileSync(`fixtures/osm/${name}.osm`, 'utf8');
    const options: ImportOptions = { importerVersion: '1', drivingSide: 'right', bbox: [...bbox] };
    importOsmCached(xml, options);
    expect(existsSync(cachePath(xml, options))).toBe(true);
    expect(importOsmCached(xml, options)).toStrictEqual(importOsm(xml, options));
    expect(cachePath(xml, { ...options, relaxMaxM: 0 })).not.toBe(cachePath(xml, options));
  },
  60_000,
);

test('the cache key covers the importer, the network it compiles with and their libraries', () => {
  const { files, packages } = importerGraph();
  for (const file of [
    'src/importers/osm/index.ts',
    'src/importers/osm/relax.ts',
    'src/network/junctions.ts',
    'src/geo/polyline.ts',
    'src/schema/city.schema.ts',
  ])
    expect(files).toContain(file);
  expect(packages.some((p) => p.startsWith('clipper2-ts@'))).toBe(true);
});
