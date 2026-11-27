// TASK-136: crossing metadata/facilities change whole-network pins; T75 strips them and retains the previous bytes.
// TASK-127: compiled rail gains boundary flags; T62 still pins unchanged lanes/movements.
// TASK-124: re-pin repaired/split connector data and exit warnings; T61 pins unchanged car geometry and strips.
// TASK-126: whole-city/compile pins include rail and station metadata; T62 keeps main lane/movement hashes.
// TASK-104: appended lot aisles and their junction mouths; T49 proves main hashes with aisles removed.
import { vehicleJson } from '../vehicle-json';
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

const hash = (value: unknown) => createHash('sha256').update(vehicleJson(value)).digest('hex');

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
          // TASK-104: lot facilities, appended aisles and compiled `lots` (T49 strips them).
          // TASK-102: garage facilities, inferred garages and their compiled entries.
          [
            // TASK-103: saved strips and inferred lot entries; compiled visible spaces.
            // T49 retains the original main hashes with appended parking removed.
            // TASK-131 keeps OSM geometry (no node merges, junction groups): city and compile
            // hashes of both cities no longer equal main's.
            // Munich re-pinned for 06dae00 (median crossings offset by half their lane block)
            // and e4654d8 (merging lanes kept on a group's inner roads).
            // TASK-135: Munich's 54 tram tracks gain `form` and `provenance`; with them stripped (the
            // import without assignTramForms) every pin equals c3a6ec2's.
            // TASK-132: building passages (Munich 18 tracks, Sindelfingen 3) gain `covered`; with it
            // stripped every pin equals 2df05a1's.
            // TASK-137: Munich gains 14 `rail.tramStops` (ids ts:10812 to ts:10825 move `nextId`);
            // with those removed and `nextId` 14 lower, the city hash is c227f80f… (lead: re-pinned with
            // TASK-132's `covered` too), and the
            // compile hash is unchanged.
            // TASK-180: generated signal programs are fixed-time again (no `actuated`, as before TASK-170).
            // TASK-190: no bay under 4.5 m of a ramp: Munich pk:2050 and pk:2056 lose 2 + 4 bays, so their capacities and every
            // later parking space and connector index move; with the bays restored every pin equals 9680f36's.
            // TASK-194: generated signal programs are actuated (`actuated: true`).
            // TASK-214: lanes through splits and merges (Munich: r:589, r:728, the n:27 and n:194 ramps).
            // TASK-220: 16 of Munich's 54 tram tracks change `form` (10 grass, 6 embedded); with every
            // tram `form` stripped the city equals b3bcde6's.
            // TASK-233: Munich's 10 Trappentreustraße roads are shared lanes (sharedLane inferred, no centre line).
            // TASK-271: Munich's 14 passage roads and 77 passage walk links at grade.
            // TASK-290: Munich's mapped garage entrance moves c:1911 from r:1071 to r:1070.
            'a2e06370cf98fc75825ad8c06d4dfc3435eb2fa55401b24d2ebb7e457e4284b4',
            // TASK-152, TASK-156 and TASK-164 append 87 + 22 + 17 Munich bay departure connectors (lane connector lists too); with them
            // removed every pin equals 3e9951a's.
            // TASK-175: compiled nodes, roads and lanes gain `grade`; with it stripped every pin equals 6ea2994's.
            // TASK-180: generated signal programs are fixed-time again (no `actuated`, as before TASK-170).
            // TASK-190: no bay under 4.5 m of a ramp: Munich pk:2050 and pk:2056 lose 2 + 4 bays, so their capacities and every
            // later parking space and connector index move; with the bays restored every pin equals 9680f36's.
            // TASK-194: generated signal programs are actuated (`actuated: true`).
            // TASK-214: lanes through splits and merges (Munich: r:589, r:728, the n:27 and n:194 ramps).
            // TASK-220: 16 of Munich's 54 tram tracks change `form` (10 grass, 6 embedded); with every
            // tram `form` stripped the city equals b3bcde6's.
            // TASK-233: Munich's 10 Trappentreustraße roads are shared lanes (sharedLane inferred, no centre line).
            // TASK-235 (TASK-221): lane transitions carried through plain nodes (Munich: the n:194 ramp, r:259).
            // TASK-271: Munich's 14 passage roads and 77 passage walk links at grade.
            // TASK-290: Munich's compiled garage connector c:1911 moves from r:1071 to r:1070.
            // TASK-294: four public roads only Munich's private r:1109 reaches are a pocket (zone ids).
            'f70841fe1adcf1f747263c8b99952482c3f17dd0bba768803f96f311df80a41b',
          ]
        : [
            // TASK-180: generated signal programs are fixed-time again (no `actuated`, as before TASK-170).
            // TASK-194: generated signal programs are actuated (`actuated: true`).
            // TASK-214: lanes through splits and merges (Sindelfingen geometry moves by millimetres).
            // TASK-233: 8 Sindelfingen roads are shared lanes (sharedLane inferred, no centre line).
            // TASK-271: Sindelfingen's 48 passage roads at grade; a works block splits in two.
            // TASK-290: Sindelfingen's mapped garage entrance moves c:1449 from r:97 to r:954.
            // TASK-351: Entenseestraße's loop joins the circulation core; p:1408, p:1410 move onto it.
            'bc761873313cb016c4f56f14e6d19252c907b54fd66d12d59769e5fe0c99193c',
            // TASK-136/151: Sindelfingen's 18 crossing facilities gain `spans`, `stops` and `railSpans`; without them it equals main's pin.
            // TASK-175: compiled nodes, roads and lanes gain `grade`; with it stripped every pin equals 6ea2994's.
            // TASK-180: generated signal programs are fixed-time again (no `actuated`, as before TASK-170).
            // TASK-194: generated signal programs are actuated (`actuated: true`).
            // TASK-214: lanes through splits and merges (Sindelfingen geometry moves by millimetres).
            // TASK-233: 8 Sindelfingen roads are shared lanes (sharedLane inferred, no centre line).
            // TASK-235 (TASK-221): lane transitions carried through plain nodes (Sindelfingen geometry moves by millimetres).
            // TASK-271: Sindelfingen's 48 passage roads at grade; a works block splits in two.
            // TASK-290: Sindelfingen's compiled garage connector c:1449 moves from r:97 to r:954.
            // TASK-294: lot pk:1490, reached only through the works' private roads, gains its bay departures.
            // TASK-348: Sindelfingen's signalised crossings n:422 and n:733 laid out as plain nodes.
            // TASK-351: Entenseestraße's loop joins the circulation core; p:1408, p:1410 move onto it.
            // TASK-348 + TASK-351: both on main (crossings laid out as plain nodes; the new circulation core).
            '2abb5c641d1414e595d9ef53a3d56934e7ff1561335bdb2f2ff82d878b1703b2',
          ];
    // TASK-372's German country metadata and V114's display setting leave this network unchanged.
    const { markingTheme, country, ...originalCity } = off.city;
    expect([markingTheme, country]).toEqual(['de', 'de']);
    expect(hash(originalCity)).toBe(baseline[0]);
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
