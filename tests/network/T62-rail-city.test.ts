import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { compile } from '../../src/network';
import { railCensus } from '../../src/network/rail';
import { tierCities } from '../tier';

test.each(tierCities(['munich-donnersberger', 'sindelfingen-a81']))(
  'T62 %s preserves every original element and vehicle lane/movement bytes',
  (name) => {
    const xml = readFileSync(`fixtures/osm/${name}.osm`, 'utf8');
    const original = xml.slice(0, xml.indexOf('\n<!-- TASK-126:')) + '</osm>\n';
    expect(createHash('sha256').update(original).digest('hex')).toBe(
      name.startsWith('munich')
        ? '25f3fdb1539f3fe6d8b818555614de770310c44fc8368d82bc277bef840246ae'
        : 'ce190658582d4468d365d4f6ba33939ebe078a7405fd7249e5dc08cd9417e16d',
    );
    const imported = importOsmCached(xml, { importerVersion: '1' });
    if (!imported.ok) throw Error(JSON.stringify(imported.diagnostics));
    const result = compile(imported.city);
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
    const { lanes, movements, rail, walk } = result.compiled;
    expect(createHash('sha256').update(JSON.stringify({ lanes, movements })).digest('hex')).toBe(
      name.startsWith('munich')
        ? 'cd4da0347bcd02669c5f48284142f6ece5d936b0510be79202b27a79b033fecf'
        : '3e66326ba72296491bcffccaf3ddfccaaa74f9653953ba13c2c29b2e0f41c25b',
    );
    expect(rail!.tracks.length).toBeGreaterThan(10);
    expect(
      imported.city.context?.features.some((f) => f.class === 'rail' || f.class === 'tram'),
    ).toBe(false);
    if (name.startsWith('munich')) {
      const s = Object.values(imported.city.places).find((p) =>
        p.provenance.osmIds?.includes(2470092007),
      )!;
      expect(s.station!.platforms).toHaveLength(2);
      expect(s.station!.entrances).toHaveLength(3);
      for (const id of s.station!.platforms) {
        const p = imported.city.rail!.platforms[id]!;
        expect(p.mode).toBe('rail');
        expect(p.tracks.length).toBeGreaterThanOrEqual(2);
      }
      for (const id of s.station!.entrances) {
        const start = walk.sourceNodes.get(id)!;
        const seen = new Set([start]),
          queue = [start];
        for (const n of queue)
          for (const i of walk.nodes[n]!.links) {
            const l = walk.links[i]!,
              next = l.from === n ? l.to : l.from;
            if (!seen.has(next)) {
              seen.add(next);
              queue.push(next);
            }
          }
        expect(walk.links.some((l) => l.road !== undefined && seen.has(l.from))).toBe(true);
      }
    }
    console.info('T62 rail census', name, railCensus(imported.city, rail!));
  },
);
