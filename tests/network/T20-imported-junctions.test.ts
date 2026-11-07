import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { importOsmCached } from '../../bench/city-cache';
import { compile } from '../../src/network';
import { polylineSelfCrossings } from '../../bench/geometry-audit';
import { tierCities } from '../tier';
import { junctionOverlaps, movementsOutside, roadBodyCrossings } from './junction-audit';

test.each(
  tierCities([
    ['sindelfingen-a81', [8.98, 48.69, 9.0, 48.702]],
    ['munich-donnersberger', [11.525, 48.135, 11.545, 48.148]],
  ] as const),
)(
  'T20: %s lane overlap audit',
  (name, bbox) => {
    const imported = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: 'test',
      bbox: [...bbox],
    });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const result = compile(imported.city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const all = junctionOverlaps(result.compiled);
    const overlaps = all.filter((pair) => !pair.capped);
    console.info(
      name,
      'road-body overlap occurrences',
      overlaps.length,
      'crossings beyond a capped setback',
      all.length - overlaps.length,
    );
    // TASK-082: the seam crossing of service way 7973188 (r:28#0 and r:30#0 at n:26 and n:696,
    // the offset folding across its zero-setback seam) is gone: the loop's two halves now join
    // with one tangent at their nodes.
    // TASK-090: within the budget of junction-audit.ts, not the named source defects.
    const crossings = roadBodyCrossings(result.compiled, name);
    console.info(name, 'road-body crossings', crossings.pairs);
    expect(crossings.pairs.length).toBeLessThanOrEqual(crossings.budget);
    // TASK-083: every movement surface lies in its junction polygon and no polygon crosses
    // itself (T38.2 checks the surfaces' edges too). A polygon touches itself at each curb's
    // tangent point, where its boundary returns along the arc beside the road edge it came out
    // on, so only proper crossings count.
    expect(movementsOutside(result.compiled)).toEqual([]);
    expect(
      result.compiled.nodes.filter((n) => polylineSelfCrossings(n.outline, true)).map((n) => n.id),
    ).toEqual([]);
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
