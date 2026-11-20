import { describe, expect, it } from 'vitest';
import { nearestOnPolyline } from '../../src/geo/polyline';
import { lonLatToLocal } from '../../src/geo/projection';
import { importOsm } from '../../src/importers/osm';
import { MEDIAN_M } from '../../src/importers/osm/corridors';
import type { City, Road } from '../../src/schema';
import { lonLat, osm } from './junction-group-osm';

// TASK-231 (TASK-216 D5; the rule of parked TASK-218): two OSM ways whose lane blocks leave a
// painted median between them are drawn as one carriageway.

function load(xml: string) {
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result.city;
}

const roadOf = (city: City, way: number) =>
  Object.values(city.roads).find((road) => road.provenance.osmIds!.includes(way))!;

/** The lateral position (m, y south) of a road's lane block edges where it crosses x = 0. */
function blockAt(city: City, road: Road) {
  const local = lonLatToLocal(city.geo!, lonLat(0, 0));
  const near = nearestOnPolyline(road.centerline, { x: local.x, y: road.centerline[0]!.y });
  // Every road here runs east or west: the right of travel is south (+y) eastbound.
  const right = (near.direction.x > 0 ? 1 : -1) * road.lateralOffsetM;
  const half = road.lanes.reduce((w, lane) => w + lane.widthM, 0) / 2;
  const centre = near.point.y - local.y + right;
  return [centre - half, centre + half] as const;
}

/** Bismarckallee before the Hauptbahnhof (`r:1251`/`r:2215`): two primary one-way ways of two
 * lanes, `apart` metres apart; with `shared` they meet at both end nodes, else at neither;
 * `median` maps way 3 between them along x = -60 to 60 (TASK-238). */
function allee(
  apart: number,
  shared = false,
  median?: { tags: Record<string, string>; points: [number, number][] },
) {
  const tags = { highway: 'primary', oneway: 'yes', lanes: '2', name: 'Allee' };
  const h = apart / 2;
  const ends: [number, number][] = shared
    ? [
        [-120, 0],
        [120, 0],
      ]
    : [
        [-110, -h],
        [110, -h],
      ];
  return osm([
    {
      id: 1,
      tags,
      points: shared
        ? [ends[0]!, [-80, h], [80, h], ends[1]!]
        : [
            [-100, h],
            [100, h],
          ],
    },
    {
      id: 2,
      tags,
      points: shared ? [ends[1]!, [80, -h], [-80, -h], ends[0]!] : [ends[1]!, ends[0]!],
    },
    ...(median ? [{ id: 3, ...median }] : []),
  ]);
}

/** Munich's Marsstraße (`r:845`/`r:944`, TASK-238): a grass strip (way 71822752, `landuse=grass`,
 * `barrier=green`) filling the gap between the blocks; a guard rail along the middle. */
const grass = {
  tags: { landuse: 'grass', barrier: 'green' },
  points: [
    [-60, -0.6],
    [60, -0.6],
    [60, 0.6],
    [-60, 0.6],
    [-60, -0.6],
  ] as [number, number][],
};
const rail = {
  tags: { barrier: 'guard_rail' },
  points: [
    [-60, 0],
    [60, 0],
  ] as [number, number][],
};

describe('TASK-231 close halves', () => {
  it('D5: one carriageway drawn as two ways keeps no median wider than the painted one', () => {
    for (const shared of [false, true]) {
      const city = load(allee(8.3, shared));
      const a = blockAt(city, roadOf(city, 1)),
        b = blockAt(city, roadOf(city, 2));
      // Blocks of 7 m each, 1.3 m apart on their OSM lines: the painted median between them.
      expect(a[0] - b[1]).toBeCloseTo(MEDIAN_M, 2);
      expect(a[1] - b[0]).toBeCloseTo(14 + MEDIAN_M, 2);
      // A real median (RASt 06: 2 m and more) stays as drawn.
      const apart = load(allee(10, shared));
      const c = blockAt(apart, roadOf(apart, 1)),
        d = blockAt(apart, roadOf(apart, 2));
      expect(c[0] - d[1]).toBeCloseTo(3, 3);
    }
  });

  it('TASK-238: halves with a mapped median between them stay as drawn', () => {
    for (const shared of [false, true])
      for (const median of [grass, rail]) {
        const city = load(allee(8.3, shared, median));
        const a = blockAt(city, roadOf(city, 1)),
          b = blockAt(city, roadOf(city, 2));
        expect(a[0] - b[1]).toBeCloseTo(1.3, 3);
      }
  });
});
