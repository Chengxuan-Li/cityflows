import { expect, test } from 'vitest';
import { openFreiburg } from '../../bench/freiburg';
import { pointInPolygon, segmentDistance } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { walkGeometry } from '../../src/render/walk-geometry';
import { buildFootbridges, footbridgeSize, liftCanopies } from '../../src/render3d/footbridges';
import { cityHeights } from '../../src/render3d/heights';
import { limit } from '../timeouts';

// TASK-262: Freiburg's footbridges (the owner's bugs 5 and 7): the Hauptbahnhof's bridge over the
// platforms under its two roofs, the Karlssteg over the Leopoldring.
test(
  'V262 Freiburg footbridges stand on piers clear of carriageways, tracks and stair flights, under their canopies',
  async () => {
    const city = (await openFreiburg()).city;
    const result = compile(city);
    if (!result.ok) throw new Error('compile');
    const compiled = result.compiled;
    const heights = cityHeights(compiled, city);
    const { counts, piers } = buildFootbridges(compiled, city, heights);
    // Lead merge with TASK-261: stair ends at their landings leave fewer raised spans (76 to 72).
    // TASK-254: Freiburg rebuilt with tagged widths and `placement`: one pier fewer (72 to 71).
    expect(counts).toMatchObject({ bridges: 65, links: 230, piers: 71, canopies: 2 });
    // TASK-262b: none on a stair flight (three did after TASK-261's flights: (638, 239), (302,
    // 581), (637, 87)).
    const flights = walkGeometry(compiled, city)
      .filter((shape) => shape.link.kind === 'steps')
      .flatMap((shape) => shape.polygons);
    for (const pier of piers) {
      for (const tri of flights) expect(pointInPolygon(pier.p, [...tri, tri[0]!])).toBe(false);
      for (const road of compiled.roads)
        expect(pointInPolygon(pier.p, [...road.surface, road.surface[0]!])).toBe(false);
      for (const node of compiled.nodes)
        if (node.outline.length >= 3)
          expect(pointInPolygon(pier.p, [...node.outline, node.outline[0]!])).toBe(false);
      for (const track of compiled.rail!.tracks)
        if (!track.tunnel)
          for (let i = 1; i < track.line.length; i++)
            expect(
              segmentDistance(pier.p, track.line[i - 1]!, track.line[i]!),
            ).toBeGreaterThanOrEqual(footbridgeSize.trackClearM);
    }
    // The Hauptbahnhof's roofs (OSM 235441143, 235441144, layer 3) stand over its deck at 10 m.
    const features = liftCanopies(compiled, city, heights, city.context!.features);
    const lifted = features.filter(
      (f, i) => f !== city.context!.features[i] && f.kind === 'area' && f.sub === 'roof',
    );
    expect(lifted.map((f) => (f.kind === 'area' ? f.minHeightM : 0))).toEqual([13.14, 13.14]);
  },
  limit(120_000),
);
