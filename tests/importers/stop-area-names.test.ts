import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compileRail } from '../../src/network/rail';
import { tramTimetable } from '../../src/network/trams';

// TASK-277 (TASK-259's D13): a platform or tram stop without a name of its own is named by its
// `public_transport=stop_area`; a `ref` is a platform number, not the stop's name. The excerpt is
// Philadelphia's 13th Street (stop area 7929732): the Market-Frankford platforms carry no name,
// the trolley tunnel's platforms only `ref` 1, 2 and 3.

const xml = readFileSync('tests/importers/stop-area-13th-street.osm', 'utf8');

function load() {
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result.city;
}

test('unnamed platforms take their stop area name and keep their ref', () => {
  const city = load();
  const platforms = Object.values(city.rail!.platforms);
  const byOsm = (id: number) => platforms.find((p) => p.osmId === id)!;
  // Market-Frankford Line platforms: no name, no ref (were "Platform").
  for (const id of [770447392, 770447393]) expect(byOsm(id).name).toBe('13th Street');
  // Trolley tunnel platforms: ref only (were "1", "2", "3").
  for (const [id, ref] of [
    [770447398, '1'],
    [770447399, '2'],
    [770447403, '3'],
  ] as const) {
    expect(byOsm(id).name).toBe('13th Street');
    expect(byOsm(id).ref).toBe(ref);
  }
});

test('a tram stop at a platform with only a ref is named by its stop area', () => {
  const city = load();
  const stops = Object.values(city.rail!.tramStops ?? {});
  expect(stops.length).toBeGreaterThan(0);
  expect(stops.map((s) => s.name).filter((n) => /^[\d;]+$/.test(n))).toEqual([]);
  const timetable = tramTimetable(compileRail(city)!);
  const names = timetable.routes.flatMap((r) => r.stops.map((s) => s.name));
  expect(names).toContain('13th Street');
  expect(names).not.toContain('3');
});
