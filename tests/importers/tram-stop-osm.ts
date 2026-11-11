import { osm } from './junction-group-osm';

// TASK-137: synthetic OSM with tram stops, shared by T73's importer and render tests.

export const line = (y: number, x0 = -250, x1 = 250): [number, number][] => [
  [x0, y],
  [0, y],
  [x1, y],
];
export const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];
export const stopTags = (name: string, extra: Record<string, string> = {}) => ({
  railway: 'tram_stop',
  public_transport: 'stop_position',
  tram: 'yes',
  name,
  ...extra,
});
export const platform = (name: string, extra: Record<string, string> = {}) => ({
  public_transport: 'platform',
  railway: 'platform',
  tram: 'yes',
  name,
  ...extra,
});

/**
 * A four-lane street "Main" along y = 0 (about 14 m wide), and tram ways on their own beds:
 * - Alpha, one stop position on each of two tracks (y = 40 and 45) and a mapped platform beside
 *   each, outside the pair;
 * - Beta, a stop position on a track (y = 100) with a platform node 3 m north of it, and
 *   `route_ref`;
 * - Gamma, a stop position on a track (y = -9) just north of Main, with neither (Main's carriageway
 *   lies 2 m south of the track's axis, so only the north side is free);
 * - Delta, one stop position on each of two tracks 6 m apart (y = 160 and 166);
 * - Epsilon, a stop position on a track (y = 220) with a mapped platform that has no `tram` tag,
 *   `railway=platform` beside it, and `shelter=no`.
 */
export function synthetic() {
  const trams: {
    id: number;
    y: number;
    stopX: number;
    name: string;
    tags?: Record<string, string>;
  }[] = [
    {
      id: 11,
      y: 40,
      stopX: 0,
      name: 'Alpha',
      tags: { description: 'Alpha, Stop Tram 5/9/N5 Richtung West' },
    },
    {
      id: 12,
      y: 45,
      stopX: 0,
      name: 'Alpha',
      tags: { description: 'Alpha, Stop Tram 5/9/N5 Richtung East' },
    },
    {
      id: 13,
      y: 100,
      stopX: 150,
      name: 'Beta',
      tags: { route_ref: '7;S1', description: 'Tram 3' },
    },
    { id: 14, y: -9, stopX: -150, name: 'Gamma' },
    { id: 15, y: 160, stopX: 0, name: 'Delta' },
    { id: 16, y: 166, stopX: 0, name: 'Delta' },
    { id: 17, y: 220, stopX: 0, name: 'Epsilon' },
  ];
  const tagged: Record<string, Record<string, string>> = {};
  const ways: Parameters<typeof osm>[0] = [
    {
      id: 1,
      tags: { highway: 'secondary', lanes: '4', name: 'Main' },
      points: [
        [-250, 0],
        [0, 0],
        [250, 0],
      ],
    },
  ];
  for (const t of trams) {
    const key = `${t.stopX},${t.y}`;
    tagged[key] = stopTags(t.name, t.tags);
    ways.push({
      id: t.id,
      tags: { railway: 'tram' },
      points: [
        [-250, t.y],
        [t.stopX, t.y],
        [250, t.y],
      ],
    });
  }
  ways.push(
    { id: 21, tags: platform('Alpha'), points: rect(-15, 36.1, 15, 38.6) },
    { id: 22, tags: platform('Alpha', { shelter: 'yes' }), points: rect(-15, 46.4, 15, 49) },
    {
      id: 23,
      tags: { highway: 'footway' },
      points: [
        [150, 97],
        [152, 97],
      ],
    },
    {
      id: 24,
      tags: { railway: 'platform', name: 'Epsilon', shelter: 'no', bench: 'yes' },
      points: rect(-12, 216.1, 12, 218.6),
    },
  );
  tagged['150,97'] = { public_transport: 'platform', tram: 'yes', name: 'Beta' };
  return osm(ways, tagged);
}
