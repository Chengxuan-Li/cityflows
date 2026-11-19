import { describe, expect, it } from 'vitest';
import { nearestOnPolyline } from '../../src/geo/polyline';
import { lonLatToLocal } from '../../src/geo/projection';
import { importOsm } from '../../src/importers/osm';
import { MEDIAN_M } from '../../src/importers/osm/corridors';
import { roadSpecs } from '../../src/importers/osm/roads';
import { compile, type Diagnostic } from '../../src/network';
import { roadMarkingGeometry } from '../../src/render/marking-geometry';
import type { City, Road, RoadClass } from '../../src/schema';
import { lonLat, osm } from './junction-group-osm';

// TASK-231 (TASK-216 D5, D6; the rules of parked TASK-218): one carriageway for two OSM ways whose
// lane blocks leave a painted median, and one shared carriageway for a two-way `lanes=1` way.

const specs = (tags: Record<string, string>, roadClass: RoadClass) => {
  const diagnostics: Diagnostic[] = [];
  return roadSpecs({ id: 1, nd: [1, 2], tag: tags }, roadClass, diagnostics).map((spec) => ({
    widths: spec.lanes.map((lane) => lane.widthM),
    inferred: spec.provenance.inferred,
  }));
};

function load(xml: string) {
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result.city;
}

const roadsOf = (city: City, way: number) =>
  Object.values(city.roads).filter((road) => road.provenance.osmIds!.includes(way));

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

/** A two-way residential street "Gasse" along y = 0 with `tags` added. */
const gasse = (tags: Record<string, string>) =>
  load(
    osm([
      {
        id: 1,
        tags: { highway: 'residential', name: 'Gasse', ...tags },
        points: [
          [-100, 0],
          [100, 0],
        ],
      },
    ]),
  );

describe('TASK-231 halves and shared lanes', () => {
  it('D6: a two-way way with lanes=1 is one shared 4.5 m carriageway', () => {
    const shared = specs({ highway: 'service', lanes: '1' }, 'service');
    expect(shared.map((s) => s.widths)).toEqual([[2.25], [2.25]]);
    expect(shared.every((s) => s.inferred.includes('sharedLane'))).toBe(true);
    // lanes=2, lanes:forward given, or a one-way lanes=1 is not shared.
    expect(specs({ lanes: '2' }, 'service').map((s) => s.widths)).toEqual([[3], [3]]);
    expect(specs({ lanes: '1', 'lanes:forward': '1' }, 'tertiary')[0]!.inferred).not.toContain(
      'sharedLane',
    );
    expect(specs({ oneway: 'yes', lanes: '1' }, 'service')[0]!.inferred).not.toContain(
      'sharedLane',
    );
    // Imported, the two directions lie side by side within 4.5 m.
    const roads = roadsOf(gasse({ lanes: '1' }), 1);
    expect(roads).toHaveLength(2);
    for (const road of roads) expect(road.lateralOffsetM).toBeCloseTo(1.125, 9);
  });

  it('D6: no centre line between the halves of a shared carriageway', () => {
    const centres = (city: City) => {
      const result = compile(city);
      if (!result.ok) throw new Error('compile');
      const net = result.compiled;
      return net.roads.flatMap((road) =>
        roadMarkingGeometry(net, road, city).below.filter((shape) => shape.role === 'centre'),
      );
    };
    expect(centres(gasse({ lanes: '1' }))).toHaveLength(0);
    // Tertiary lanes=2 draws a centre line, also on residential roads without a lanes tag.
    expect(centres(gasse({ highway: 'tertiary', lanes: '2' })).length).toBeGreaterThan(0);
  });

  // Bismarckallee before the Hauptbahnhof (`r:1251`/`r:2215`): two primary one-way ways of two
  // lanes, `apart` metres apart; with `shared` they meet at both end nodes, else at neither.
  const allee = (apart: number, shared = false) => {
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
    ]);
  };

  it('D5: one carriageway drawn as two ways keeps no median wider than the painted one', () => {
    for (const shared of [false, true]) {
      const city = load(allee(8.3, shared));
      const a = blockAt(city, roadsOf(city, 1)[0]!),
        b = blockAt(city, roadsOf(city, 2)[0]!);
      // Blocks of 7 m each, 1.3 m apart on their OSM lines: the painted median between them.
      expect(a[0] - b[1]).toBeCloseTo(MEDIAN_M, 2);
      expect(a[1] - b[0]).toBeCloseTo(14 + MEDIAN_M, 2);
      // A real median (RASt 06: 2 m and more) stays as drawn.
      const apart = load(allee(10, shared));
      const c = blockAt(apart, roadsOf(apart, 1)[0]!),
        d = blockAt(apart, roadsOf(apart, 2)[0]!);
      expect(c[0] - d[1]).toBeCloseTo(3, 3);
    }
  });
});
