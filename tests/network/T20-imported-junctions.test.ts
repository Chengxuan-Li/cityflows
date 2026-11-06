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
    // Where a fan of overlapping ramps crosses itself the outline is walked so that it only
    // touches itself at one point (bench/junction-audit.ts counts no proper crossing there).
    crossings: [
      'n:434:6/10',
      'n:434:6/11',
      'n:434:7/10',
      'n:434:7/11',
      'n:68:23/27',
      'n:68:23/28',
      'n:68:24/27',
      'n:68:24/28',
    ],
    // Dead-end caps across two road ends cut at different distances, and a curb that follows a
    // movement's edge.
    tangents: ['n:161:0', 'n:161:0', 'n:996:2.999999999999966'],
    widthsOutside: [
      // TASK-080 (B36): the coincident service way r:15 and residential r:233 now run side by
      // side into n:14, an absorbing merge with 2.5 m setbacks; the 5.9 m merge curve from the
      // outer lane is wider than the junction outline there (junctions.ts, outside TASK-080).
      'r:233#0>r:16#0',
      'r:285#0>r:400#0',
      'r:1198#0>r:298#0',
      'r:597#0>r:888#0',
      'r:494#0>r:377#0',
      'r:596#0>r:494#0',
      // TASK-084: u-turns between the carriageways of a separated coincident pair (r:595/r:880,
      // r:746/r:803), now as wide as the divided street, run outside the outline of a node that
      // still treats the pair as two arms (corridor-aware junctions are TASK-083).
      'r:595#0>r:880#0',
      'r:80#0>r:82#0',
      'r:1061#1>r:966#0',
      'r:803#0>r:746#0',
      'r:82#0>r:647#0',
    ],
  },
  'munich-donnersberger': {
    // TASK-080: r:1368's continuation transition at n:936 (hold, then a 20 m taper) reshapes
    // its lanes up to n:774, and r:1276#0>r:1368#0 now stays inside n:774's outline.
    movementsOutside: ['r:1163#0>r:1121#0', 'r:973#0>r:972#0'],
    crossings: [] as string[],
    // Dead-end caps across two road ends cut at different distances, and curbs that follow a
    // movement's edge where a road end is a short stub.
    tangents: [
      'n:212:0',
      'n:425:0',
      'n:425:0',
      'n:970:2.9999999999999494',
      'n:971:2.9999999999999902',
    ],
    // TASK-080 resolved n:305 (r:1188#2>r:307#3, r:676#1>r:307#3) and n:726 (r:978#2>r:984#1)
    // with side-by-side branches (B36), and n:774 (r:1276, r:1362, r:777 into r:1368) with
    // r:1368's shorter transition at n:936.
    widthsOutside: [
      'r:1163#0>r:1121#0',
      'r:1163#0>r:1164#0',
      'r:1163#0>r:415#0',
      'r:1163#0>r:781#0',
      'r:1163#0>r:792#0',
      'r:988#1>r:1044#1',
      'r:988#1>r:353#0',
      'r:716#1>r:958#3',
      'r:184#0>r:1173#0',
      'r:671#0>r:267#0',
      'r:1076#0>r:941#0',
      'r:1330#0>r:327#0',
      // TASK-084: u-turns between the carriageways of the separated Arnulfstraße and Landsberger
      // Straße pairs (r:1342/r:451, r:450/r:395, r:392/r:402, r:388/r:408, r:406/r:1346,
      // r:1334/r:1280), now as wide as the divided street, run outside the outline of a node
      // that still treats the pair as two arms (corridor-aware junctions are TASK-083); at n:446
      // the separated r:395/r:450 widen their arm and the turns into r:1354 leave the outline.
      'r:1342#0>r:451#0',
      'r:450#0>r:395#0',
      'r:1269#0>r:41#0',
      'r:392#0>r:402#0',
      'r:451#0>r:1342#0',
      'r:388#0>r:408#0',
      'r:406#0>r:1346#0',
      'r:447#0>r:1354#0',
      'r:542#0>r:1354#0',
      'r:1273#0>r:1230#0',
      'r:517#0>r:1230#0',
      'r:523#0>r:1230#0',
      'r:192#0>r:57#0',
      'r:1334#0>r:1280#0',
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
