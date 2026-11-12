import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { nearestOnPolyline } from '../../src/geo/polyline';
import { compileRail } from '../../src/network/rail';
import { trainTimetable, trainsAt, trainPoint } from '../../src/network/trains';
import { railTimetable, tramTimetable, tramCensus } from '../../src/network/trams';

test('T76 Munich synthetic service serves every mapped halt on connected tram tracks and preserves train timetable', () => {
  const imported = importOsmCached(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), {
    importerVersion: '1',
  });
  if (!imported.ok) throw Error('import');
  const rail = compileRail(imported.city)!,
    table = tramTimetable(rail),
    census = tramCensus(rail, table);
  expect(trainTimetable(rail).hash).toBe('0d505d0f');
  expect(table.routes).toHaveLength(4);
  expect(table.periodS).toBe(720);
  expect(census.usedSections).toBe(54);
  expect(census.unusedSections).toEqual([]);
  expect(census.servedStops).toHaveLength(14);
  expect(census.unservedStops).toEqual([]);
  expect(census.routes.map((r) => r.perHour)).toEqual([10, 10, 10, 10]);
  for (const route of table.routes) {
    expect(rail.nodes[route.from]!.boundary).toBe(true);
    expect(rail.nodes[route.to]!.boundary).toBe(true);
    expect(route.sections.every((s) => rail.tracks[s.track]!.kind === 'tram')).toBe(true);
    for (const stop of route.stops) {
      const halt = rail
        .tramStops!.find((s) => s.id === stop.platform)!
        .halts.find((h) => route.sections.some((s) => rail.tracks[s.track]!.id === h.track))!;
      const track = rail.tracks.find((t) => t.id === halt.track)!;
      const expected = nearestOnPolyline(track.line, halt.pos).point,
        front = trainPoint(rail, route, stop.positionM + 18);
      expect(Math.hypot(front.x - expected.x, front.y - expected.y)).toBeLessThan(1e-6);
    }

    for (let i = 1; i < route.sections.length; i++) {
      const a = route.sections[i - 1]!,
        b = route.sections[i]!;
      expect(rail.connections).toContainEqual({
        node: a.forward ? rail.tracks[a.track]!.toNode : rail.tracks[a.track]!.fromNode,
        from: a.track,
        to: b.track,
      });
    }
  }
  const both = railTimetable(rail);
  for (let time = 0; time < 86400; time += 5) {
    const used = new Set<number>();
    for (const train of trainsAt(rail, both, time))
      for (const track of train.occupied) {
        if (used.has(track)) throw Error(`Collision at ${time} on ${track}`);
        used.add(track);
      }
  }
  console.info('T76 Munich tram service', JSON.stringify(census));
});
