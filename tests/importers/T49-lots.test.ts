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
    'e19120f7fe0bfd0234347915a5e7e57b3c999831aef84017e16e88ed14a09258',
    '2013fe496781d8aeb533c19b7425807a25990fcf89c0a5d1724a2e5049097c6f',
  ],
  'sindelfingen-a81': [
    'eda6809b6682636376c1b9d6ee2333a2b88fc8776f6cd7340efabaf52888df0f',
    '0a43d582601a30cf76cb0b0b2dc0cd2cee72d1463f7f568733938b3cfddb8628',
  ],
};

test.each(tierCities(['munich-donnersberger', 'sindelfingen-a81'] as const))(
  'T49 %s: aisles and mapped public joins preserve the contracted network; counts and capacity',
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
    // These four Munich lots previously contributed no bays to the T49 census.
    // Verify the restored bays separately and keep the original census tolerance.
    const restored =
      name === 'munich-donnersberger'
        ? [54172005, 106547917, 106547920, 372315670].map((osmId) => {
            const lot = lots.find((f) => f.provenance.osmIds?.includes(osmId))!;
            return compiled.compiled.lots!.find((f) => f.id === lot.id)!.stallCount;
          })
        : [];
    if (restored.length) expect(restored).toEqual([86, 17, 10, 6]);
    const counts = [lots.length, aisles.size, stalls - restored.reduce((sum, n) => sum + n, 0)];
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
