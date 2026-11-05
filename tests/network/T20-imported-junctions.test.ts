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

const expected = {
  'sindelfingen-a81': {
    movementsOutside: [] as string[],
    crossings: ['n:498:20/28', 'n:81:64/75'],
    // Dead-end caps across two road ends cut at different distances, and a curb that follows a
    // movement's edge.
    tangents: ['n:161:0', 'n:161:0', 'n:996:2.999999999999966'],
    widthsOutside: [
      'r:285#0>r:400#0',
      'r:1198#0>r:298#0',
      'r:597#0>r:888#0',
      'r:494#0>r:377#0',
      'r:596#0>r:494#0',
      'r:80#0>r:82#0',
      'r:1061#1>r:966#0',
      'r:645#0>r:86#0',
      'r:82#0>r:647#0',
    ],
  },
  'munich-donnersberger': {
    movementsOutside: ['r:1163#0>r:1121#0', 'r:1276#0>r:1368#0', 'r:973#0>r:972#0'],
    crossings: ['n:201:61/67'],
    // Dead-end caps across two road ends cut at different distances, and curbs that follow a
    // movement's edge where a road end is a short stub.
    tangents: [
      'n:1123:0',
      'n:1123:0',
      'n:212:0',
      'n:425:0',
      'n:425:0',
      'n:970:2.9999999999999494',
      'n:971:2.9999999999999902',
    ],
    widthsOutside: [
      'r:107#0>r:964#2',
      'r:476#1>r:964#2',
      'r:1163#0>r:1121#0',
      'r:1163#0>r:1164#0',
      'r:1163#0>r:415#0',
      'r:1163#0>r:781#0',
      'r:1163#0>r:792#0',
      'r:414#0>r:1121#0',
      'r:780#0>r:1121#0',
      'r:793#0>r:1121#0',
      'r:988#1>r:1044#1',
      'r:988#1>r:353#0',
      'r:715#1>r:140#0',
      'r:715#1>r:386#1',
      'r:671#0>r:267#0',
      'r:1188#2>r:307#3',
      'r:676#1>r:307#3',
      'r:1076#0>r:941#0',
      'r:1330#0>r:327#0',
      'r:1269#0>r:41#0',
      'r:1273#0>r:1230#0',
      'r:192#0>r:57#0',
      'r:1334#1>r:724#1',
      'r:978#2>r:984#1',
      'r:1276#0>r:1368#0',
      'r:1362#0>r:1368#0',
      'r:777#0>r:1368#0',
      'r:973#0>r:972#0',
      'r:977#0>r:976#0',
      'r:976#0>r:1081#0',
      'r:1267#0>r:301#1',
      'r:211#0>r:301#1',
    ],
  },
};

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
    const derivedCrossings =
      name === 'sindelfingen-a81'
        ? [
            // The forced radius on service way 7973188 is smaller than the inner
            // lane offset. The compiler's offset folds across the zero-setback seam.
            { node: 'n:26', lanes: ['r:28#0', 'r:30#0'], capped: false },
            // The same unchanged seam crossing is now visible from uncapped n:696.
            { node: 'n:696', lanes: ['r:28#0', 'r:30#0'], capped: false },
          ]
        : [];
    expect(overlaps.filter((pair) => !sourceDefects[pair.lanes.join('>')])).toEqual(
      derivedCrossings,
    );
    // Every listed source defect still crosses somewhere, capped node or not.
    const keys = new Set(all.map((pair) => pair.lanes.join('>')));
    expect(Object.keys(sourceDefects).filter((key) => !keys.has(key))).toEqual([]);
    // TASK-074 residuals, measured by bench/junction-audit.ts and listed in T27 with reasons:
    // movements whose surface leaves both the outline and their own roads, and outlines that
    // cross themselves, at nodes where source carriageways lie on top of each other.
    const residual = expected[name];
    expect(movementsOutside(result.compiled)).toEqual(residual.movementsOutside);
    expect(outlineCrossings(result.compiled)).toEqual(residual.crossings);
    const surfaces = surfaceAudit(result.compiled);
    console.info(name, 'shape classes', surfaces.classes);
    expect(surfaces.widthsOutside).toEqual(residual.widthsOutside);
    expect(surfaces.oversized).toEqual([]);
    expect(surfaces.tangents).toEqual(residual.tangents);
    // These uncapped/near-parallel pairs used to produce distant false gore tips.
    // TASK-074: n:436 left this list: its capped corner's mouth now reaches out to where the
    // uncapped cut would be (37 m), covering the capped pair's overlap.
    const ids = name === 'munich-donnersberger' ? ['n:322', 'n:719'] : ['n:14', 'n:631', 'n:792'];
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
