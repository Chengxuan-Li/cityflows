import { osm } from './junction-group-osm';
export function crossingOsm() {
  return osm(
    [
      {
        id: 1,
        tags: { highway: 'residential', name: 'Rail road' },
        points: [
          [-200, -120],
          [0, -120],
          [200, -120],
        ],
      },
      {
        id: 2,
        tags: { railway: 'rail', electrified: 'no' },
        points: [
          [0, -240],
          [0, -120],
          [0, -20],
        ],
      },
      {
        id: 3,
        tags: { highway: 'residential', name: 'Tram road' },
        points: [
          [-200, 80],
          [80, 80],
          [200, 80],
        ],
      },
      {
        id: 4,
        tags: { railway: 'tram', electrified: 'no' },
        points: [
          [80, -20],
          [80, 80],
          [80, 220],
        ],
      },
      {
        id: 5,
        tags: { highway: 'footway' },
        points: [
          [-160, 180],
          [-80, 180],
          [-20, 180],
        ],
      },
      {
        id: 6,
        tags: { railway: 'rail' },
        points: [
          [-80, 130],
          [-80, 180],
          [-80, 240],
        ],
      },
      {
        id: 7,
        tags: { railway: 'rail', bridge: 'yes', layer: '1' },
        points: [
          [160, -240],
          [160, 240],
        ],
      },
    ],
    {
      '0,-120': {
        railway: 'level_crossing',
        'crossing:barrier': 'half',
        'crossing:light': 'yes',
        'crossing:bell': 'yes',
      },
      '80,80': { railway: 'tram_level_crossing', 'crossing:barrier': 'no' },
      '-80,180': { railway: 'crossing' },
    },
  );
}
