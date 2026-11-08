// TASK-104: appended lot aisles and their junction mouths; T49 proves main hashes with aisles removed.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { importContext } from '../../src/importers/osm/context';
import type { OsmData, OsmTags } from '../../src/importers/osm/parse';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { town } from '../../src/fixtures/town';
import { compile } from '../../src/network';
import { lonLatToLocal } from '../../src/geo/projection';
import { tierCities, unitTest } from '../tier';

const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value, (_, v: unknown) => (v instanceof Map ? [...v] : v)))
    .digest('hex');

test.each(tierCities(['munich-donnersberger', 'sindelfingen-a81']))(
  'T44 %s: context leaves the canonical network and compilation unchanged',
  (name) => {
    const xml = readFileSync('fixtures/osm/' + name + '.osm', 'utf8');
    const off = importOsmCached(xml, { importerVersion: '1', context: false, terrain: false });
    const on = importOsmCached(xml, { importerVersion: '1', terrain: false });
    expect(off.ok && on.ok).toBe(true);
    if (!off.ok || !on.ok) throw new Error('Import failed');
    expect(off.city).not.toHaveProperty('context');
    const baseline =
      name === 'munich-donnersberger'
        ? // TASK-101: imported road access/bus reservations and compiled access/zone arrays;
          // merged with TASK-100's `van`.
          [
            'bc20fb6fdedbc6648393b63bc6ceed3c1212ad8711c59912393e34d5c7b7452e',
            '558861f3a8c1891ce416cbc00ab29e87f04fc307bbaab1fb16cbeec7cd881778',
          ]
        : [
            '517440c07e61532e35658b73c704a625f8c34d9d1da145863ae4998062fc921b',
            'cb217fb864cde5765d8948cdbffb28ea73a23929b9eb0ecc3b4d30334623c626',
          ];
    expect(hash(off.city)).toBe(baseline[0]);
    expect(hash(compile(off.city))).toBe(baseline[1]);
    expect(on.city.context?.features.length).toBeGreaterThan(0);
    const { context, ...network } = on.city;
    expect(JSON.stringify(network)).toBe(JSON.stringify(off.city));
    expect(hash(compile(on.city))).toBe(hash(compile(off.city)));
    const counts: Record<string, number> = {};
    const geo = on.city.geo!;
    const [w, s, e, n] = geo.bbox;
    const min = lonLatToLocal(geo, { lon: w, lat: n });
    const max = lonLatToLocal(geo, { lon: e, lat: s });
    for (const feature of context!.features) {
      counts[feature.class] = (counts[feature.class] ?? 0) + 1;
      const lines =
        feature.kind === 'area'
          ? feature.rings
          : feature.kind === 'line'
            ? [feature.line]
            : [[feature.pos]];
      for (const line of lines) {
        expect(line.length).toBeGreaterThanOrEqual(
          feature.kind === 'area' ? 4 : feature.kind === 'line' ? 2 : 1,
        );
        if (feature.kind === 'area') expect(line[0]).toEqual(line.at(-1));
        for (const p of line) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
          expect(p.x).toBeGreaterThanOrEqual(min.x);
          expect(p.x).toBeLessThanOrEqual(max.x);
          expect(p.y).toBeGreaterThanOrEqual(min.y);
          expect(p.y).toBeLessThanOrEqual(max.y);
          expect(p.x * 10).toBeCloseTo(Math.round(p.x * 10), 8);
          expect(p.y * 10).toBeCloseTo(Math.round(p.y * 10), 8);
        }
      }
    }
    const expected =
      name === 'munich-donnersberger'
        ? {
            building: 1406,
            water: 1,
            green: 115,
            landuse: 61,
            parking: 57,
            rail: 0,
            tram: 0,
            waterway: 0,
          }
        : {
            building: 150,
            water: 0,
            green: 59,
            landuse: 10,
            parking: 2,
            rail: 0,
            tram: 0,
            waterway: 0,
          };
    for (const [kind, count] of Object.entries(expected)) {
      expect(counts[kind] ?? 0).toBeGreaterThanOrEqual(count * 0.9);
      expect(counts[kind] ?? 0).toBeLessThanOrEqual(count * 1.1);
    }
    const bytes = Buffer.byteLength(JSON.stringify(context));
    const baseBytes = Buffer.byteLength(JSON.stringify(off.city));
    console.info(name, { counts, bytes, baseBytes, ratio: bytes / baseBytes });
    if (/munich/.test(name)) expect(bytes).toBeLessThanOrEqual(baseBytes * 0.4);
  },
);

unitTest.each([
  ['grid', grid5x5],
  ['town', town],
] as const)('T44 %s: compile ignores surroundings', (_name, make) => {
  const city = make();
  const before = hash(compile(city));
  city.context = {
    features: [
      {
        kind: 'area',
        class: 'building',
        rings: [
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 0 },
          ],
        ],
      },
    ],
  };
  expect(hash(compile(city))).toBe(before);
});

unitTest(
  'T44 classifies all contracted tags, excludes underground lines and keeps dimensions',
  () => {
    const tags: [OsmTags, string][] = [
      [{ building: 'yes', height: '12 m', 'building:levels': '4' }, 'building'],
      [{ building: 'no' }, ''],
      ...['water', 'wood', 'scrub', 'grassland'].map((natural): [OsmTags, string] => [
        { natural },
        natural === 'water' ? 'water' : 'green',
      ]),
      ...[
        'reservoir',
        'basin',
        'grass',
        'meadow',
        'forest',
        'recreation_ground',
        'village_green',
        'allotments',
        'cemetery',
        'residential',
        'commercial',
        'retail',
        'industrial',
        'railway',
        'construction',
      ].map((landuse): [OsmTags, string] => [
        { landuse },
        ['reservoir', 'basin'].includes(landuse)
          ? 'water'
          : [
                'residential',
                'commercial',
                'retail',
                'industrial',
                'railway',
                'construction',
              ].includes(landuse)
            ? 'landuse'
            : 'green',
      ]),
      ...['park', 'garden', 'pitch', 'playground'].map((leisure): [OsmTags, string] => [
        { leisure },
        'green',
      ]),
      [{ amenity: 'parking' }, 'parking'],
      [{ waterway: 'riverbank' }, 'water'],
      ...['rail', 'light_rail', 'subway', 'narrow_gauge', 'tram', 'abandoned', 'disused'].map(
        (railway): [OsmTags, string] => [
          { railway },
          ['abandoned', 'disused'].includes(railway) ? '' : railway === 'tram' ? 'tram' : 'rail',
        ],
      ),
      ...['river', 'stream', 'canal'].map((waterway): [OsmTags, string] => [
        { waterway },
        'waterway',
      ]),
      [{ railway: 'rail', tunnel: 'yes', layer: '-1' }, ''],
      [{ waterway: 'stream', tunnel: 'yes', layer: '-1' }, ''],
      [{ railway: 'rail', tunnel: 'yes', layer: '0', width: '2.5' }, 'rail'],
    ];
    const positions = new Map([
      [1, { x: -20, y: -20 }],
      [2, { x: 20, y: -20 }],
      [3, { x: 20, y: 20 }],
      [4, { x: -20, y: 20 }],
    ]);
    const bounds = { min: { x: -10.03, y: -10.03 }, max: { x: 10.03, y: 10.03 } };
    for (const [tag, expected] of tags) {
      const data: OsmData = {
        node: [],
        relation: [],
        way: [
          {
            id: 1,
            nd:
              tag.railway || ['river', 'stream', 'canal'].includes(tag.waterway ?? '')
                ? [1, 3]
                : [1, 2, 3, 4, 1],
            tag,
          },
        ],
      };
      const features = importContext(data, positions, bounds);
      expect(features.map((f) => f.class)).toEqual(expected ? [expected] : []);
      if (tag.height) expect(features[0]).toMatchObject({ heightM: 12, levels: 4 });
      if (tag.width) expect(features[0]).toMatchObject({ widthM: 2.5, layer: 0 });
    }
  },
);

unitTest(
  'T44 shares multipolygon assembly, retains courtyards, drops tiny geometry and breaks missing-node lines',
  () => {
    const positions = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 20, y: 0 }],
      [3, { x: 20, y: 20 }],
      [4, { x: 0, y: 20 }],
      [5, { x: 5, y: 5 }],
      [6, { x: 15, y: 5 }],
      [7, { x: 15, y: 15 }],
      [8, { x: 5, y: 15 }],
      [9, { x: 1, y: 1 }],
      [10, { x: 2, y: 1 }],
      [11, { x: 2, y: 2 }],
    ]);
    const data: OsmData = {
      node: [],
      way: [
        { id: 1, nd: [1, 2, 3], tag: {} },
        { id: 2, nd: [1, 4, 3], tag: {} },
        { id: 3, nd: [5, 6, 7, 8, 5], tag: {} },
        { id: 4, nd: [9, 10, 11, 9], tag: { building: 'yes' } },
        { id: 5, nd: [1, 2, 999, 3, 4], tag: { railway: 'rail' } },
        { id: 6, nd: [9, 10], tag: { waterway: 'stream' } },
      ],
      relation: [
        {
          id: 1,
          tag: { type: 'multipolygon', building: 'yes' },
          member: [
            { type: 'way', ref: 1, role: 'outer' },
            { type: 'way', ref: 2, role: 'outer' },
            { type: 'way', ref: 3, role: 'inner' },
          ],
        },
      ],
    };
    const features = importContext(data, positions, { min: { x: 0, y: 0 }, max: { x: 20, y: 20 } });
    expect(features).toHaveLength(3);
    expect(features[0]).toMatchObject({
      kind: 'area',
      class: 'building',
      rings: expect.any(Array),
    });
    if (features[0]!.kind === 'area') expect(features[0]!.rings).toHaveLength(2);
    expect(features.slice(1)).toEqual([
      {
        kind: 'line',
        class: 'rail',
        line: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
      },
      {
        kind: 'line',
        class: 'rail',
        line: [
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
      },
    ]);
  },
);

unitTest.each([0, 1, 2, 3, 4, 5, 6, 7])(
  'T44 concave multipolygon holes retain roles at starting vertex %i',
  (start) => {
    const outer = [
      [0, 0],
      [100, 0],
      [100, 20],
      [20, 20],
      [20, 80],
      [100, 80],
      [100, 100],
      [0, 100],
    ];
    const inner = [
      [5, 5],
      [95, 5],
      [95, 15],
      [10, 15],
      [10, 85],
      [95, 85],
      [95, 95],
      [5, 95],
    ];
    const positions = new Map([...outer, ...inner].map(([x, y], i) => [i + 1, { x: x!, y: y! }]));
    const outerIds = [1, 2, 3, 4, 5, 6, 7, 8];
    const data: OsmData = {
      node: [],
      way: [
        {
          id: 1,
          nd: [...outerIds.slice(start), ...outerIds.slice(0, start), outerIds[start]!],
          tag: {},
        },
        { id: 2, nd: [9, 10, 11, 12, 13, 14, 15, 16, 9], tag: {} },
      ],
      relation: [
        {
          id: 1,
          tag: { type: 'multipolygon', building: 'yes' },
          member: [
            { type: 'way', ref: 1, role: 'outer' },
            { type: 'way', ref: 2, role: 'inner' },
          ],
        },
      ],
    };
    const features = importContext(data, positions, {
      min: { x: 0, y: 0 },
      max: { x: 100, y: 100 },
    });
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ kind: 'area', rings: expect.any(Array) });
    if (features[0]!.kind === 'area') expect(features[0]!.rings).toHaveLength(2);
  },
);
