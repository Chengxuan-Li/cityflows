import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import {
  importedRoadBodyOverlaps,
  junctionOverlaps,
  movementsOutside,
  outlineCrossings,
  surfaceAudit,
} from './junction-audit';

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
    expect(outlineCrossings(result.compiled)).toEqual([]);
    const surfaces = surfaceAudit(result.compiled);
    console.info(name, 'shape classes', surfaces.classes);
    expect(surfaces.widthsOutside).toEqual([]);
    expect(surfaces.oversized).toEqual([]);
    expect(surfaces.tangents).toEqual([]);
    // These uncapped/near-parallel pairs used to produce distant false gore tips.
    const ids =
      name === 'munich-donnersberger' ? ['n:322', 'n:719'] : ['n:14', 'n:436', 'n:631', 'n:792'];
    if (name === 'munich-donnersberger') {
      // n:324 also has a legitimate 34 m gore; its parallel pair used to add a 505 m one.
      const node = result.compiled.nodes[result.compiled.index.node.get('n:324')!]!;
      expect(
        Math.max(...node.outline.map((p) => Math.hypot(p.x - node.pos.x, p.y - node.pos.y))),
      ).toBeLessThan(50);
    }
    for (const id of ids) {
      const node = result.compiled.nodes[result.compiled.index.node.get(id as `n:${number}`)!]!;
      const lanes = result.compiled.roads
        .filter((r) => r.from === node.idx || r.to === node.idx)
        .flatMap((r) =>
          r.lanes.map((i) =>
            r.to === node.idx
              ? result.compiled.lanes[i]!.polyline.at(-1)!
              : result.compiled.lanes[i]!.polyline[0]!,
          ),
        );
      const limit =
        Math.max(...lanes.map((p) => Math.hypot(p.x - node.pos.x, p.y - node.pos.y))) + 8;
      expect(
        Math.max(...node.outline.map((p) => Math.hypot(p.x - node.pos.x, p.y - node.pos.y))),
      ).toBeLessThanOrEqual(limit + 1e-6);
    }
  },
  120_000,
);
