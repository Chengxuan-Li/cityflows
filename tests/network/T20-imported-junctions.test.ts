import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import { importedRoadBodyOverlaps, junctionOverlaps, movementsOutside } from './junction-audit';

test.each([
  ['sindelfingen-a81', [8.98, 48.69, 9.0, 48.702]],
  ['munich-donnersberger', [11.525, 48.135, 11.545, 48.148]],
] as const)(
  'T20: %s lane overlap audit',
  (name, bbox) => {
    const imported = importOsm(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: 'test',
      bbox: [...bbox],
    });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const result = compile(imported.city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const all = junctionOverlaps(result.compiled);
    const overlaps = all.filter((pair) => !pair.capped);
    const sourceDefects = importedRoadBodyOverlaps[name]!;
    console.info(
      name,
      'road-body overlap occurrences',
      overlaps.length,
      'crossings beyond a capped setback',
      all.length - overlaps.length,
    );
    expect(overlaps.filter((pair) => !sourceDefects[pair.lanes.join('>')])).toEqual([]);
    // Every listed source defect still crosses somewhere, capped node or not.
    const keys = new Set(all.map((pair) => pair.lanes.join('>')));
    expect(Object.keys(sourceDefects).filter((key) => !keys.has(key))).toEqual([]);
    expect(movementsOutside(result.compiled)).toEqual([]);
  },
  120_000,
);
