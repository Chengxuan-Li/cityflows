import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { compile } from '../../src/network';
import { trainTimetable, trainsAt, trainCensus } from '../../src/network/trains';
import { tierCities } from '../tier';

test.each(tierCities(['munich-donnersberger', 'sindelfingen-a81']))(
  'T64 %s timetable is collision-free, has stable daily service and preserves compiled vehicle data',
  (name) => {
    const imported = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: '1',
    });
    if (!imported.ok) throw Error('import');
    const built = compile(imported.city);
    if (!built.ok) throw Error('compile');
    const rail = built.compiled.rail!,
      start = performance.now(),
      table = trainTimetable(rail),
      buildMs = performance.now() - start;
    const before = JSON.stringify({
      lanes: built.compiled.lanes,
      movements: built.compiled.movements,
    });
    expect(table.periodS).toBe(720);
    for (let time = 0; time < 86400; time++) {
      const used = new Set<number>();
      for (const train of trainsAt(rail, table, time))
        for (const track of train.occupied) {
          if (used.has(track))
            throw Error(`Section collision ${rail.tracks[track]!.id} at ${time}`);
          used.add(track);
        }
    }
    expect(
      JSON.stringify({ lanes: built.compiled.lanes, movements: built.compiled.movements }),
    ).toBe(before);
    const census = trainCensus(rail, table);
    if (name.startsWith('munich')) {
      expect(census.stopsPerHour).toBe(30);
      expect(new Set(table.routes.flatMap((r) => r.stops.map((s) => s.platform))).size).toBe(2);
      expect(table.routes.every((r) => r.terminal === undefined)).toBe(true);
      expect(census.perHour).toEqual({ sbahn: 30, mainline: 180 });
    } else {
      expect(table.routes).toHaveLength(2);
      expect(table.routes.every((r) => r.terminal !== undefined)).toBe(true);
      expect(census.crossings.some((c) => c.perHour > 0)).toBe(true);
    }
    console.info('T64 timetable', name, { buildMs, ...census });
  },
  60000,
);
