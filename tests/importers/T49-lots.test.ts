// TASK-124: re-pin repaired/split connector data and exit warnings; T61 pins unchanged car geometry and strips.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { compile } from '../../src/network';
import { tierCities } from '../tier';
import { vehicleJson } from '../vehicle-json';
import { withoutLotAisles } from '../without-lot-aisles';

// TASK-110's walk data is excluded, as in T44.
const hash = (value: unknown) => createHash('sha256').update(vehicleJson(value)).digest('hex');
// TASK-119 re-pins parking-place removal and owner links; T55 separately pins main's vehicle
// geometry. No original entity is reconstructed by the aisle-stripping oracle.
const main = {
  'munich-donnersberger': [
    '6481a7518b7fec3fc2599358602c9a50e73ae982af2d935c46a1f4cc3441b01d',
    'c6466371c1f015dede1d9f1c70ef9dfb7f76ab7f3dd15bf1918fcc1d144558ba',
  ],
  'sindelfingen-a81': [
    '4bfc2462a47e79af02a0c23bd2b66ad11b850220365bfe81ba58860267048763',
    '8bf06b8ea699f40d4bda2e16fd758317d61b038a5685816a2156bfc2dca5e2a3',
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
    // TASK-114's display-only marking theme is not part of TASK-102's pins (as in T44).
    const { markingTheme, ...network } = stripped;
    expect(markingTheme).toBe('de');
    expect(hash(network)).toBe(main[name][0]);
    expect(hash(compile(stripped))).toBe(main[name][1]);
    const start = performance.now();
    const compiled = compile(city);
    const compileMs = performance.now() - start;
    const baselineStart = performance.now();
    compile(stripped);
    const mainCompileMs = performance.now() - baselineStart;
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    // TASK-102's garages share `City.parking`.
    const lots = Object.values(city.parking!).filter((f) => f.kind === 'lot');
    const aisles = new Set(lots.flatMap((lot) => lot.aisles!));
    const stalls = compiled.compiled.lots!.reduce((s, lot) => s + lot.stallCount, 0);
    const counts = [lots.length, aisles.size, stalls];
    // TASK-103 also fills lots without mapped aisles, without adding a vehicle road.
    const expected = name === 'munich-donnersberger' ? [25, 51, 395] : [31, 147, 505];
    counts.forEach((value, i) =>
      expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(expected[i]! * 0.1),
    );
    for (const id of aisles) {
      const road = city.roads[id]!;
      expect(road.roadClass).toBe('service');
      expect(road.speedLimitMps).toBe(10 / 3.6);
      expect(road.access?.all).not.toBe('yes');
    }
    const mismatches = compiled.compiled.lots!.flatMap((lot) => {
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
      inferredEntries: lots.filter((l) => l.provenance.inferred?.includes('driveway')).length,
      mismatches,
    });
  },
);
