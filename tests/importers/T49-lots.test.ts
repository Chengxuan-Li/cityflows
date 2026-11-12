// TASK-136: crossing metadata/facilities change whole-network pins; T75 strips them and retains the previous bytes.
// TASK-127: compiled rail gains boundary flags; T62 still pins unchanged lanes/movements.
// TASK-124: re-pin repaired/split connector data and exit warnings; T61 pins unchanged car geometry and strips.
// TASK-126: whole-city/compile pins include rail and station metadata; T62 keeps main lane/movement hashes.
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
// TASK-131 keeps OSM geometry (no node merges, junction groups): the aisle-free networks no
// longer equal main's (main: Munich 33bfd6b9…/3c6dfcc5…, Sindelfingen b72831fb…/c9e05f99…).
// Munich re-pinned for 06dae00 (median crossings offset by half their lane block)
// and e4654d8 (merging lanes kept on a group's inner roads).
// TASK-135: Munich's 54 tram tracks gain `form` and `provenance`; with them stripped (the
// import without assignTramForms) every pin equals c3a6ec2's.
// TASK-132: building passages (Munich 18 tracks, Sindelfingen 3) gain `covered`; with it
// stripped every pin equals 2df05a1's.
// TASK-137: Munich gains 14 `rail.tramStops` (ids ts:10812 to ts:10825 move `nextId`); with those
// removed and `nextId` 14 lower, the city hash is dfd83d49…, and the compile hash is unchanged.
const baseline = {
  'munich-donnersberger': [
    'be00cc4e7fb89e714c59aefab50b1da0915a36caf28b748590b11b08aa7490f0',
    '3a4185baac26c23c7bab8b1f2037b61d2542e915e1b2de33054f981d9ed599a8',
  ],
  'sindelfingen-a81': [
    '4b69b80b85b55293a2e3f7a6bec22a606b5292dcbb0c1572848768bbe081299e',
    '918735a676b4ed984584581a901aa14a06f7caac7d7fd5a76a672a585b95ee22',
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
    expect(hash(network)).toBe(baseline[name][0]);
    expect(hash(compile(stripped))).toBe(baseline[name][1]);
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
