import { describe, expect, it } from 'vitest';
import { cumulativeLengths, nearestOnPolyline, pointAtDistance } from '../../src/geo/polyline';
import { importOsm } from '../../src/importers/osm';
import { MEDIAN_M } from '../../src/importers/osm/corridors';
import { placementOffset, roadSpecs } from '../../src/importers/osm/roads';
import type { Diagnostic } from '../../src/network';
import type { City, RoadClass } from '../../src/schema';
import { osm } from './junction-group-osm';

// TASK-242, landed by TASK-254: tagged road widths (TASK-216 D9; TASK-218's width rules) and
// OSM `placement` (TASK-216 D3).

const widths = (tags: Record<string, string>, roadClass: RoadClass) => {
  const diagnostics: Diagnostic[] = [];
  return roadSpecs({ id: 1, nd: [1, 2], tag: tags }, roadClass, diagnostics).map((spec) =>
    spec.lanes.map((lane) => lane.widthM),
  );
};

function load(xml: string): City {
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result.city;
}

const roadOf = (city: City, way: number) => {
  const roads = Object.values(city.roads).filter((road) => road.provenance.osmIds!.includes(way));
  expect(roads).toHaveLength(1);
  return roads[0]!;
};

describe('TASK-254 tagged road widths and placement', () => {
  it('width:lanes, and width where no street parking is tagged, are read within bounds', () => {
    const friedrich = { oneway: 'yes', lanes: '5', 'width:lanes': '2.5|3|3|3|2.5' };
    expect(widths(friedrich, 'primary')).toEqual([[2.5, 3, 3, 3, 2.5]]);
    // Not every lane listed, a lane out of bounds, or an estimate (Stefan-Meier-Straße, way
    // 233466343, 3|3|3|3|2.5 estimated against 15.5 m on the ground): not read.
    expect(widths({ ...friedrich, 'width:lanes': '3|3|3|3' }, 'primary')).toEqual([
      Array(5).fill(3.5),
    ]);
    expect(widths({ ...friedrich, 'width:lanes': '3|3|3|3|1.5' }, 'primary')).toEqual([
      Array(5).fill(3.5),
    ]);
    expect(widths({ ...friedrich, 'source:width': 'estimated' }, 'primary')).toEqual([
      Array(5).fill(3.5),
    ]);
    // Per direction on a two-way way.
    expect(
      widths({ lanes: '3', 'lanes:forward': '2', 'width:lanes:forward': '3.1|3.3' }, 'primary'),
    ).toEqual([[3.1, 3.3], [3.5]]);
    // Rotteckring (way 536508979): width=4 on one lane without street parking. With parking
    // (Munich's way 90400545, width=7) or none tagged, the width covers the parking lanes.
    const noParking = { 'parking:both': 'no' };
    expect(widths({ ...noParking, oneway: 'yes', lanes: '1', width: '4' }, 'residential')).toEqual([
      [4],
    ]);
    expect(widths({ ...noParking, width: '5 m' }, 'residential')).toEqual([[2.5], [2.5]]);
    expect(widths({ 'parking:both': 'yes', width: '7' }, 'residential')).toEqual([[3], [3]]);
    expect(widths({ width: '7' }, 'residential')).toEqual([[3], [3]]);
    // Out of bounds: a width that holds more than the lanes, or motorway lanes under 3 m.
    expect(widths({ ...noParking, width: '14' }, 'residential')).toEqual([[3], [3]]);
    expect(widths({ ...noParking, oneway: 'yes', lanes: '3', width: '8' }, 'motorway')).toEqual([
      Array(3).fill(3.5),
    ]);
  });

  it('placement puts the lane block on the named lane boundary', () => {
    const three = [3.5, 3.5, 3.5];
    expect(placementOffset('right_of:1', three)).toBe(1.75);
    expect(placementOffset('left_of:2', three)).toBe(1.75);
    expect(placementOffset('middle_of:2', three)).toBe(0);
    expect(placementOffset('left_of:3', three)).toBe(-1.75);
    expect(placementOffset('right_of:3', [3.5, 3.5, 3.5, 3.5])).toBe(-3.5);
    expect(placementOffset('middle_of:1', [3, 3])).toBe(1.5);
    for (const value of ['transition', 'right_of:4', 'left_of:0', undefined])
      expect(placementOffset(value, three)).toBeUndefined();

    // A one-way primary between two crossings (Zur Unterführung r:261, right_of:2 of five lanes,
    // lies 1.6 m right of the way on the imagery): its block lies right of the line.
    const main = { highway: 'primary', oneway: 'yes', lanes: '3', name: 'Main' };
    const side = { highway: 'residential', name: 'Side' };
    const city = load(
      osm([
        {
          id: 1,
          tags: { ...main, placement: 'right_of:1' },
          points: [
            [-200, 0],
            [-100, 0],
            [100, 0],
            [200, 0],
          ],
        },
        {
          id: 2,
          tags: side,
          points: [
            [-100, -100],
            [-100, 0],
            [-100, 100],
          ],
        },
        {
          id: 3,
          tags: side,
          points: [
            [100, -100],
            [100, 0],
            [100, 100],
          ],
        },
      ]),
    );
    const placed = Object.values(city.roads).filter((road) => road.provenance.osmIds![0] === 1);
    expect(placed.map((road) => road.lateralOffsetM)).toEqual([1.75, 1.75, 1.75]);
  });

  it('a placed road whose block would step against the road it runs on into is left centred', () => {
    const main = { highway: 'primary', oneway: 'yes', lanes: '3', name: 'Main' };
    const run = (second: Record<string, string>) =>
      load(
        osm([
          {
            id: 1,
            tags: { ...main, placement: 'right_of:1' },
            points: [
              [-200, 0],
              [0, 0],
            ],
          },
          {
            id: 2,
            tags: { ...main, ...second },
            points: [
              [0, 0],
              [200, 0],
            ],
          },
        ]),
      );
    // Both placed alike: the lanes run on.
    let city = run({ placement: 'right_of:1' });
    expect([roadOf(city, 1), roadOf(city, 2)].map((r) => r.lateralOffsetM)).toEqual([1.75, 1.75]);
    // The next way centred (untagged, or a transition the network cannot taper): neither steps.
    for (const second of [{}, { placement: 'transition' }] as Record<string, string>[]) {
      city = run(second);
      expect([roadOf(city, 1), roadOf(city, 2)].map((r) => r.lateralOffsetM)).toEqual([0, 0]);
    }
    // A lane gained on the right (left_of:2 of three after an untagged two-lane way, Greiffeneggring
    // r:945 to r:711): the left edges meet, so the wider road keeps its placement.
    city = load(
      osm([
        {
          id: 1,
          tags: { ...main, lanes: '2' },
          points: [
            [-200, 0],
            [0, 0],
          ],
        },
        {
          id: 2,
          tags: { ...main, placement: 'left_of:2' },
          points: [
            [0, 0],
            [200, 0],
          ],
        },
      ]),
    );
    expect(roadOf(city, 2).lateralOffsetM).toBe(1.75);
  });

  it('the corridor rules measure a placed block where it lies', () => {
    // Opposite carriageways of one street 4 m apart, each placed right_of:1 (its block 1.75 m
    // away from the other): the blocks still overlap, so they are pushed apart to the median.
    const main = {
      highway: 'primary',
      oneway: 'yes',
      lanes: '3',
      name: 'Main',
      placement: 'right_of:1',
    };
    const city = load(
      osm([
        {
          id: 1,
          tags: main,
          points: [
            [-250, 2],
            [0, 2],
            [250, 2],
          ],
        },
        {
          id: 2,
          tags: main,
          points: [
            [245, -2],
            [0, -2],
            [-245, -2],
          ],
        },
      ]),
    );
    const [east, west] = [roadOf(city, 1), roadOf(city, 2)];
    expect([east.lateralOffsetM, west.lateralOffsetM]).toEqual([1.75, 1.75]);
    // At the middle, the facing (left) edges of the two blocks lie at least the median apart.
    const lengths = cumulativeLengths(east.centerline);
    const p = pointAtDistance(east.centerline, lengths, lengths.at(-1)! / 2);
    const q = nearestOnPolyline(west.centerline, p).point;
    // Eastbound's right is south (+y), westbound's north (-y).
    const eastLeft = p.y + east.lateralOffsetM - 5.25;
    const westLeft = q.y - west.lateralOffsetM + 5.25;
    expect(eastLeft - westLeft).toBeGreaterThan(MEDIAN_M - 0.05);
  });
});
