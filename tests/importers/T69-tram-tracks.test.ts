import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import type { City } from '../../src/schema';
import { osm } from './junction-group-osm';

// TASK-135 (T69): the form of each tram track from its tags, its highway's tags or its geometry.

const line = (y: number): [number, number][] => [
  [-200, y],
  [0, y],
  [200, y],
];
/** A four-lane two-way street along y = 0 (about 14 m wide), a second street along y = -80 that
 * carries `embedded_rails=tram`, a railway, and tram ways inside and outside the streets. */
const trams: [number, number, Record<string, string>][] = [
  [10, 2, {}],
  [11, 40, {}],
  [12, 80, { embedded: 'yes' }],
  [13, -2, { embedded: 'no' }],
  [14, 120, { surface: 'grass' }],
  [15, 140, { 'railway:track_ballast': 'no' }],
  [16, 160, { embedded: 'no', surface: 'paving_stones' }],
  [17, 180, { surface: 'asphalt' }],
  [18, -78, {}],
  [19, 200, { 'railway:track_ballast': 'yes' }],
];
const xml = osm([
  {
    id: 1,
    tags: { highway: 'secondary', lanes: '4', name: 'Main' },
    points: [
      [-250, 0],
      [0, 0],
      [250, 0],
    ],
  },
  {
    id: 2,
    tags: { highway: 'secondary', lanes: '4', name: 'Second', embedded_rails: 'tram' },
    points: [
      [-250, -80],
      [0, -80],
      [250, -80],
    ],
  },
  { id: 3, tags: { railway: 'rail' }, points: line(-40) },
  ...trams.map(([id, y, tags]) => ({ id, tags: { railway: 'tram', ...tags }, points: line(y) })),
]);

function load(source = xml) {
  const result = importOsm(source, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result.city;
}
const byWay = (city: City, osmId: number) =>
  Object.values(city.rail!.tracks).filter((t) => t.osmId === osmId);

test('T69 tagged forms import as tagged, untagged trams follow the road, railways carry no form', () => {
  const city = load();
  const expected: Record<number, [string, boolean]> = {
    10: ['embedded', true],
    11: ['ballast', true],
    12: ['embedded', false],
    13: ['ballast', false],
    14: ['grass', false],
    15: ['grass', false],
    16: ['paved', false],
    17: ['paved', true],
    18: ['embedded', false],
    19: ['ballast', false],
  };
  for (const [id, [form, inferred]] of Object.entries(expected)) {
    const tracks = byWay(city, Number(id));
    expect(tracks.length).toBeGreaterThan(0);
    for (const t of tracks) {
      expect({ way: id, form: t.form }).toEqual({ way: id, form });
      expect({ way: id, inferred: !!t.provenance?.inferred?.includes('form') }).toEqual({
        way: id,
        inferred,
      });
    }
  }
  for (const t of byWay(city, 3)) {
    expect(t.kind).toBe('rail');
    expect('form' in t || 'provenance' in t).toBe(false);
  }
});

test('T69 the railway imports as it does without trams, and the same import gives the same city', () => {
  const city = load();
  const withoutTrams = load(
    osm([
      {
        id: 1,
        tags: { highway: 'secondary', lanes: '4', name: 'Main' },
        points: [
          [-250, 0],
          [0, 0],
          [250, 0],
        ],
      },
      { id: 3, tags: { railway: 'rail' }, points: line(-40) },
    ]),
  );
  // Everything but the allocated ids.
  const shape = (c: City) =>
    byWay(c, 3).map((t) => ({ ...t, id: undefined, from: undefined, to: undefined }));
  expect(shape(city)).toEqual(shape(withoutTrams));
  const hash = (c: City) => createHash('sha256').update(JSON.stringify(c)).digest('hex');
  expect(hash(load())).toBe(hash(city));
});

// TASK-220 (TASK-216 D8): more tags and the inference beside one-lane carriageways and on grass.
test('T220 forms from paving surfaces, embedded values, tram streets, grass strips and one-lane carriageways', () => {
  const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
  const city = load(
    osm([
      // A one-way one-lane residential street (drawn 3 m wide) at y = 0, and a two-lane one at y = 60.
      {
        id: 1,
        tags: { highway: 'residential', lanes: '1', oneway: 'yes' },
        points: [
          [-250, 0],
          [250, 0],
        ],
      },
      {
        id: 2,
        tags: { highway: 'secondary', lanes: '2', oneway: 'yes' },
        points: [
          [-250, 60],
          [250, 60],
        ],
      },
      // A pedestrian street carrying the rails in its lanes, and a tram mapped on a service way.
      {
        id: 3,
        tags: { highway: 'pedestrian', 'railway:lanes:forward': 'tram|no', surface: 'sett' },
        points: [
          [-250, -100],
          [250, -100],
        ],
      },
      // A 6 m grass strip along y = 150 and a 60 m lawn around y = 210 (not a strip).
      { id: 4, tags: { landuse: 'grass' }, points: square(-220, 147, 220, 153) },
      { id: 5, tags: { leisure: 'park', landuse: 'grass' }, points: square(-220, 180, 220, 240) },
      ...(
        [
          [20, 3.2, {}], // beside the one-lane street, outside its 3 m: embedded (inferred)
          [21, 65.2, {}], // as far beside the two-lane street (7 m): ballast (inferred)
          [22, -98, { surface: 'cobblestone' }], // in the tram street: embedded
          [23, 100, { surface: 'cobblestone' }], // alone, cobbled: paved (inferred)
          [24, 120, { embedded: 'pavement' }],
          [25, 150, {}], // on the grass strip: grass (inferred)
          [26, 210, {}], // across the lawn: ballast (inferred)
          [27, 260, { surface: 'gravel' }],
          [28, 150.5, { surface: 'paving_stones' }], // tagged paving wins over the strip
        ] as [number, number, Record<string, string>][]
      ).map(([id, y, tags]) => ({ id, tags: { railway: 'tram', ...tags }, points: line(y) })),
      {
        id: 29,
        tags: { railway: 'tram', highway: 'service' },
        points: [
          [-200, -130],
          [200, -130],
        ],
      },
    ]),
  );
  const expected: Record<number, [string, boolean]> = {
    20: ['embedded', true],
    21: ['ballast', true],
    22: ['embedded', false],
    23: ['paved', true],
    24: ['embedded', false],
    25: ['grass', true],
    26: ['ballast', true],
    27: ['ballast', false],
    28: ['paved', true],
    29: ['embedded', false],
  };
  for (const [id, [form, inferred]] of Object.entries(expected))
    for (const t of byWay(city, Number(id)))
      expect({
        way: id,
        form: t.form,
        inferred: !!t.provenance?.inferred?.includes('form'),
      }).toEqual({ way: id, form, inferred });
});

// TASK-232 (TASK-224 D8b): rule 7 measured to the street band's outer edge, the carriageway's
// street parking and the mapped street areas (`area:highway`) beside it, so Fahnenbergplatz's
// stop tracks behind their platforms count as in the street; a median track stays an own bed.
test('T232 track behind a one-lane street parking strip or `area:highway` platform is embedded', () => {
  const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
  const street = (id: number, y: number, tags: Record<string, string> = {}) => ({
    id,
    tags: { highway: 'residential', lanes: '1', oneway: 'yes', ...tags },
    points: [
      [-250, y],
      [250, y],
    ] as [number, number][],
  });
  const city = load(
    osm([
      // Eastbound one-lane streets (3 m drawn, so 1.5 m each side of the line; right is +y).
      // Angled bays (4.5 m) on the right of way 1: its band reaches y = -144.
      street(1, -150, { 'parking:right': 'lane', 'parking:right:orientation': 'diagonal' }),
      // A stop platform 1 m off way 2, mapped as part of the street, and one mapped as a rail
      // platform only beside way 3 (a median stop like Munich's Marsstraße).
      street(2, -50),
      {
        id: 4,
        tags: { 'area:highway': 'platform', highway: 'platform', public_transport: 'platform' },
        points: square(-200, -47.5, 200, -44.5),
      },
      street(3, 50),
      {
        id: 5,
        tags: { railway: 'platform', public_transport: 'platform', area: 'yes' },
        points: square(-200, 52.5, 200, 55.5),
      },
      // A two-lane carriageway with the same street platform: no tolerance (TASK-220).
      street(6, 150, { highway: 'secondary', lanes: '2' }),
      {
        id: 7,
        tags: { 'area:highway': 'platform', highway: 'platform', public_transport: 'platform' },
        points: square(-200, 155.5, 200, 158.5),
      },
      ...(
        [
          [20, -142], // 2 m beyond the bays, 6.5 m off the carriageway: embedded
          [21, -158], // as far off the side without parking: ballast
          [22, -43], // 1.5 m beyond the street platform, 5.5 m off the carriageway: embedded
          [23, 57], // the same beyond the rail-only platform: ballast
          [24, 160], // beyond the two-lane street's platform: ballast
        ] as [number, number][]
      ).map(([id, y]) => ({ id, tags: { railway: 'tram' }, points: line(y) })),
    ]),
  );
  const strips = Object.values(city.parking ?? {}).filter((p) => p.strip?.roadId);
  expect(strips.length).toBeGreaterThan(0);
  const expected: Record<number, string> = {
    20: 'embedded',
    21: 'ballast',
    22: 'embedded',
    23: 'ballast',
    24: 'ballast',
  };
  for (const [id, form] of Object.entries(expected))
    for (const t of byWay(city, Number(id)))
      expect({ way: id, form: t.form, inferred: t.provenance?.inferred }).toEqual({
        way: id,
        form,
        inferred: ['form'],
      });
});

// TASK-256 (TASK-232's `rt:12944`): a short section where the street track leaves for its own bed
// keeps the street's paving up to the next bed.
test('T256 a short ballast section between a street track and another bed is embedded', () => {
  const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
  // Per street (one-way, one lane, drawn 3 m wide): a track beside it to x = 0 (embedded), one
  // turning off it to y + 8 over `run` m of x (ballast alone), and one on a grass strip.
  type Way = { id: number; tags: Record<string, string>; points: [number, number][] };
  const layout = (y: number, run: number, first: number): Way[] => [
    {
      id: first,
      tags: { highway: 'residential', lanes: '1', oneway: 'yes' },
      points: [
        [-250, y],
        [250, y],
      ] as [number, number][],
    },
    { id: first + 1, tags: { landuse: 'grass' }, points: square(run + 2.5, y + 5, 220, y + 11) },
    ...(
      [
        [
          [-200, y + 3.2],
          [0, y + 3.2],
        ],
        [
          [0, y + 3.2],
          [run, y + 8],
        ],
        [
          [run, y + 8],
          [200, y + 8],
        ],
      ] as [number, number][][]
    ).map((points, k) => ({ id: first + 2 + k, tags: { railway: 'tram' }, points })),
  ];
  const city = load(osm([...layout(0, 10, 10), ...layout(100, 24.5, 20)]));
  const form = (way: number) => byWay(city, way).map((t) => t.form);
  // 11 m from the street track to the grass strip: embedded; 25 m: an own bed (ballast).
  expect([form(12), form(13), form(14)]).toEqual([['embedded'], ['embedded'], ['grass']]);
  expect([form(22), form(23), form(24)]).toEqual([['embedded'], ['ballast'], ['grass']]);
  for (const t of byWay(city, 13)) expect(t.provenance?.inferred).toEqual(['form']);
});
