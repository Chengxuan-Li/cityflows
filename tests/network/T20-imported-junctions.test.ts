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
    const overlaps = junctionOverlaps(result.compiled);
    const sourceDefects = importedRoadBodyOverlaps[name]!;
    console.info(name, 'road-body overlap occurrences', overlaps.length);
    expect(overlaps.filter((pair) => !sourceDefects[pair.lanes.join('>')])).toEqual([]);
    expect([...new Set(overlaps.map((pair) => pair.lanes.join('>')))].sort()).toEqual(
      Object.keys(sourceDefects).sort(),
    );
    expect(movementsOutside(result.compiled)).toEqual([]);
  },
  120_000,
);
