import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import process from 'node:process';
import { deserialize, serialize } from 'node:v8';
import { importOsm } from '../src/importers/osm';
import { parseOsm } from '../src/importers/osm/parse';
import type { ImportOptions, ImportResult } from '../src/importers/types';

// Imports of OSM extracts cached on disk (TASK-090): a real city takes 2 s to import idle and 5
// to 12 s under a parallel test run, and about 50 test files and the audits import the same two.
// The key covers the extract, the options and every module the importer statically imports,
// found by walking the imports from its entry, so any change to the importer, the network it
// compiles with or a library version misses. Entries are V8-serialized (keeps -0, NaN,
// undefined). CITYFLOWS_NO_CACHE=1 imports fresh.

const entry = 'src/importers/osm/index.ts';
export const cacheDir = 'node_modules/.cache/cityflows';
const format = '1';

function resolveLocal(from: string, specifier: string): string {
  const base = posix.join(posix.dirname(from), specifier);
  for (const file of [base, `${base}.ts`, `${base}/index.ts`])
    if (/\.(ts|js|json)$/.test(file) && existsSync(file)) return file;
  throw new Error(`city cache: cannot resolve ${specifier} from ${from}`);
}

function packageVersion(specifier: string): string {
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  if (name.startsWith('node:')) return name;
  const manifest = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')) as {
    version: string;
  };
  return `${name}@${manifest.version}`;
}

/** Every module in the importer's static import graph (repository paths), and the packages it
 * imports with their versions. */
export function importerGraph(): { files: string[]; packages: string[] } {
  const files: string[] = [];
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.includes(file)) return;
    files.push(file);
    const source = readFileSync(file, 'utf8');
    const statements = /^\s*(?:(?:import|export)\s[\w$*{},\s]*?\bfrom|import)\s*['"]([^'"]+)['"]/gm;
    for (const [, specifier] of source.matchAll(statements)) {
      if (specifier!.startsWith('.')) visit(resolveLocal(file, specifier!));
      else packages.add(packageVersion(specifier!));
    }
  };
  visit(entry);
  return { files, packages: [...packages].sort() };
}

let importerHash: string | undefined;
function importerKey(): string {
  if (importerHash === undefined) {
    const hash = createHash('sha256').update(format);
    const { files, packages } = importerGraph();
    for (const file of files.toSorted()) hash.update(`\0${file}\0`).update(readFileSync(file));
    hash.update(packages.join('\0'));
    importerHash = hash.digest('hex');
  }
  return importerHash;
}

/** The cache file an import of `xml` with `options` reads and writes. */
export function cachePath(xml: string, options: ImportOptions): string {
  const key = createHash('sha256')
    .update(importerKey())
    .update('\0')
    .update(xml)
    .update('\0')
    .update(JSON.stringify(options, (_, v: unknown) => (v === Infinity ? 'Infinity' : v)))
    .digest('hex')
    .slice(0, 32);
  return `${cacheDir}/${key}.v8`;
}

/** `importOsm`, served from the disk cache when the same import ran before. Each call returns
 * its own copy. */
export function importOsmCached(xml: string, options: ImportOptions): ImportResult {
  if (process.env.CITYFLOWS_NO_CACHE === '1')
    return withTerrain(importOsm(xml, options), xml, options);
  const file = cachePath(xml, options);
  if (existsSync(file))
    return withTerrain(deserialize(readFileSync(file)) as ImportResult, xml, options);
  const result = importOsm(xml, options);
  // Parallel test workers may race: write a file of our own, then rename it into place. On
  // Windows the rename fails while another worker holds the target open; its copy is the same.
  mkdirSync(cacheDir, { recursive: true });
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(temp, serialize(result));
  try {
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    if (!existsSync(file)) throw error;
  }
  return withTerrain(result, xml, options);
}

let terrainFixtures:
  | {
      xml: string;
      origin: { lon: number; lat: number };
      terrain: NonNullable<Extract<ImportResult, { ok: true }>['city']['terrain']>;
    }[]
  | undefined;
function withTerrain(result: ImportResult, xml: string, options: ImportOptions): ImportResult {
  if (!result.ok || options.terrain === false) return result;
  terrainFixtures ??= ['munich-donnersberger', 'sindelfingen-a81'].flatMap((name) => {
    const file = `fixtures/terrain/${name}.json`;
    if (!existsSync(file)) return [];
    const xml = readFileSync(`fixtures/osm/${name}.osm`, 'utf8');
    const data = parseOsm(xml);
    if (typeof data === 'string' || !data.bounds)
      throw new Error(`Missing terrain fixture bounds: ${name}`);
    const [west, south, east, north] = data.bounds;
    return [
      {
        xml,
        origin: { lon: (west + east) / 2, lat: (south + north) / 2 },
        terrain: JSON.parse(readFileSync(file, 'utf8')),
      },
    ];
  });
  const fixture = terrainFixtures.find((fixture) => fixture.xml === xml);
  if (!fixture) return result;
  // A custom bbox uses a different local frame; fixture grids belong to their original one.
  if (
    result.city.geo?.origin.lon !== fixture.origin.lon ||
    result.city.geo.origin.lat !== fixture.origin.lat
  )
    return result;
  return {
    ...result,
    city: {
      ...result.city,
      terrain: { ...fixture.terrain, originM: { ...fixture.terrain.originM } },
    },
  };
}
