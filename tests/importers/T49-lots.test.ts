import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { compile } from '../../src/network';
import { tierCities } from '../tier';
import { withoutLotAisles } from '../without-lot-aisles';

const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value, (_, v: unknown) => (v instanceof Map ? [...v] : v)))
    .digest('hex');
// Main 806263a, before TASK-104. No original entity is reconstructed by the stripping oracle.
const main = {
  'munich-donnersberger': [
    '5214f5f79a95e4fa038e01fa58ec6aaf65fe74b09cfc495d83dca579ae279b3b',
    '114894aea61446a784fca6707c1ef6601080ac8e03d374f0e66586be8b2f36fe',
  ],
  'sindelfingen-a81': [
    '440715f6bc83776119a532b4d27dff374f7d03dc4cceae1d24cbfcddd282ecd8',
    '6796e26d82f456a43fd826489ab54f9285f4148ca82c0f3be1ed1a15d8027478',
  ],
};

test.each(tierCities(['munich-donnersberger', 'sindelfingen-a81'] as const))(
  'T49 %s: aisles are the only network change; city counts and capacity estimates',
  (name) => {
    const imported = importOsmCached(readFileSync('fixtures/osm/' + name + '.osm', 'utf8'), {
      importerVersion: '1',
      context: false,
      terrain: false,
    });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const city = imported.city;
    const stripped = withoutLotAisles(city);
    expect(hash(stripped)).toBe(main[name][0]);
    expect(hash(compile(stripped))).toBe(main[name][1]);
    const start = performance.now();
    const compiled = compile(city);
    const compileMs = performance.now() - start;
    const baselineStart = performance.now();
    compile(stripped);
    const mainCompileMs = performance.now() - baselineStart;
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const lots = Object.values(city.parking!);
    const aisles = new Set(lots.flatMap((lot) => lot.aisles!));
    const stalls = compiled.compiled.parking!.reduce((s, lot) => s + lot.stallCount, 0);
    const counts = [lots.length, aisles.size, stalls];
    const expected = name === 'munich-donnersberger' ? [22, 51, 268] : [31, 147, 364];
    counts.forEach((value, i) =>
      expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(expected[i]! * 0.1),
    );
    for (const id of aisles) {
      const road = city.roads[id]!;
      expect(road.roadClass).toBe('service');
      expect(road.speedLimitMps).toBe(10 / 3.6);
      expect(road.access?.all).not.toBe('yes');
    }
    const mismatches = compiled.compiled.parking!.flatMap((lot) => {
      const source = city.parking![lot.id]!;
      if (source.provenance.inferred?.includes('capacity')) {
        expect(source.capacity).toBe(lot.stallCount);
        return [];
      }
      return Math.abs(lot.stallCount - source.capacity) > Math.max(1, source.capacity) * 0.3
        ? [
            {
              id: lot.id,
              osmIds: source.provenance.osmIds,
              capacity: source.capacity,
              stalls: lot.stallCount,
            },
          ]
        : [];
    });
    console.info('T49', name, {
      lots: lots.length,
      aisles: aisles.size,
      stalls,
      compileMs,
      mainCompileMs,
      unreachable: imported.diagnostics.filter((d) => d.code === 'parking_unreachable').length,
      inferredEntries: 0,
      mismatches,
    });
  },
);
