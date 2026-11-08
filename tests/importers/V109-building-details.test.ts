import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { importContext } from '../../src/importers/osm/context';
import type { OsmData, OsmTags } from '../../src/importers/osm/parse';
import { compile, type Diagnostic } from '../../src/network';
import { openProject } from '../../src/project/open';
import { saveProject, saveProjectJson } from '../../src/project/save';
import { citySchema, scenarioSchema } from '../../src/schema';
import { tierCities, unitTest } from '../tier';

const positions = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 20, y: 0 }],
  [3, { x: 20, y: 10 }],
  [4, { x: 0, y: 10 }],
]);
const bounds = { min: { x: -1, y: -1 }, max: { x: 21, y: 11 } };
const building = (tag: OsmTags): OsmData => ({
  node: [],
  relation: [],
  way: [{ id: 1, nd: [1, 2, 3, 4, 1], tag: { building: 'yes', ...tag } }],
});

unitTest(
  'V109 imports roof details from building ways and multipolygons without changing rings',
  () => {
    const tags = {
      height: '40 ft',
      'building:levels': '4',
      'roof:shape': 'gabled',
      'roof:height': '2 m',
      'roof:levels': '1',
      'roof:colour': ' DarkRed ',
      'roof:material': ' TILE ',
      'roof:orientation': 'across',
      'roof:direction': '270',
      'building:colour': '#AbC',
      'building:material': ' Brick ',
      min_height: '1.5',
      'building:min_level': '2',
    };
    const way = building(tags);
    const relation: OsmData = {
      ...way,
      way: way.way.map((w) => ({ ...w, tag: {} })),
      relation: [
        {
          id: 2,
          tag: { ...tags, building: 'yes', type: 'multipolygon' },
          member: [{ type: 'way', ref: 1, role: 'outer' }],
        },
      ],
    };
    const original = structuredClone(positions);
    for (const data of [way, relation]) {
      const actual = importContext(data, positions, bounds);
      expect(actual[0]).toMatchObject({
        heightM: 12.192,
        levels: 4,
        minHeightM: 1.5,
        colour: '#aabbcc',
        material: 'brick',
        roof: {
          shape: 'gabled',
          heightM: 2,
          levels: 1,
          colour: '#8b0000',
          material: 'tile',
          orientation: 'across',
          directionDeg: 270,
        },
      });
      expect(actual[0]?.kind === 'area' && actual[0].rings).toEqual(
        importContext(building({}), positions, bounds).map((f) => f.kind === 'area' && f.rings)[0],
      );
    }
    expect(positions).toEqual(original);
  },
);

unitTest('V109 maps unknown roof shapes and reports grouped counts for imported buildings', () => {
  const data = building({});
  data.way = ['quadruple_saltbox', 'saltbox', 'butterfly', 'butterfly', 'hipped'].map(
    (shape, id) => ({ ...data.way[0]!, id, tag: { building: 'yes', 'roof:shape': shape } }),
  );
  const diagnostics: Diagnostic[] = [];
  expect(
    importContext(data, positions, bounds, diagnostics).map(
      (f) => f.kind === 'area' && f.roof?.shape,
    ),
  ).toEqual(['hipped', 'gabled', 'flat', 'flat', 'hipped']);
  expect(diagnostics).toHaveLength(3);
  expect(diagnostics.map((d) => d.message).join(' ')).toMatch(/2.*butterfly.*flat/);
  expect(diagnostics.every((d) => d.code === 'osm_unsupported_tag')).toBe(true);
});

unitTest('V109 retains canopy clearance and omits invalid or non-building details', () => {
  const canopies = [
    [{ building: 'roof' }, 3],
    [{ building: 'roof', 'building:min_level': '2' }, 6],
    [{ building: 'roof', min_height: '0', 'building:min_level': '2' }, 0],
  ] as const;
  for (const [tags, clearance] of canopies) {
    expect(importContext(building(tags), positions, bounds)[0]).toMatchObject({
      sub: 'roof',
      minHeightM: clearance,
    });
  }
  const invalid = importContext(
    building({
      'roof:height': '-2',
      'roof:levels': 'oops',
      'roof:colour': 'unknown',
      'roof:orientation': 'diagonal',
      'roof:direction': 'oops',
      'building:colour': '#12345',
      min_height: '-1',
    }),
    positions,
    bounds,
  )[0];
  expect(invalid).not.toHaveProperty('colour');
  expect(invalid).not.toHaveProperty('roof');
  expect(invalid).not.toHaveProperty('minHeightM');
  const unknownNames = importContext(
    building({ 'roof:colour': 'constructor', 'building:colour': '__proto__' }),
    positions,
    bounds,
  )[0];
  expect(unknownNames).not.toHaveProperty('roof');
  expect(unknownNames).not.toHaveProperty('colour');
  expect(importContext(building({ 'roof:colour': '#AbCdEf' }), positions, bounds)[0]).toMatchObject(
    { roof: { shape: 'flat', colour: '#abcdef' } },
  );
  expect(importContext(building({ 'roof:direction': 'NNE' }), positions, bounds)[0]).toMatchObject({
    roof: { shape: 'flat', directionDeg: 22.5 },
  });
  expect(
    importContext(
      building({
        building: 'no',
        natural: 'water',
        'roof:shape': 'gabled',
        'building:colour': 'red',
      }),
      positions,
      bounds,
    )[0],
  ).not.toHaveProperty('roof');
});

unitTest.each([saveProject, saveProjectJson])(
  'V109 building details survive project save/open and old features still load (%#)',
  async (save) => {
    const city = grid5x5();
    const before = compile(city);
    city.context = {
      features: importContext(
        building({
          'roof:shape': 'gabled',
          'roof:height': '3',
          'roof:levels': '1',
          'roof:colour': 'silver',
          'roof:material': 'metal',
          'roof:orientation': 'along',
          'roof:direction': '90',
          'building:colour': 'beige',
          'building:material': 'plaster',
          min_height: '0',
        }),
        positions,
        bounds,
      ),
    };
    const project = { city, scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] };
    expect(citySchema.parse(city)).toEqual(city);
    expect(await openProject(await save(project))).toEqual({ ok: true, project });
    expect(compile(city)).toEqual(before);
    city.context = { features: importContext(building({}), positions, bounds) };
    expect(await openProject(await save(project))).toEqual({ ok: true, project });
  },
);

test.each(tierCities(['munich-donnersberger', 'sindelfingen-a81']))(
  'V109 %s imports the bundled roof mix',
  (name) => {
    const result = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: '1',
      terrain: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Import failed');
    const counts: Record<string, number> = {};
    let canopies = 0;
    for (const f of result.city.context!.features) {
      if (f.kind !== 'area' || f.class !== 'building') continue;
      if (f.roof) counts[f.roof.shape] = (counts[f.roof.shape] ?? 0) + 1;
      if (f.sub === 'roof') {
        canopies++;
        expect(f.minHeightM).toBeGreaterThanOrEqual(0);
      }
    }
    const expected = name.startsWith('munich')
      ? // Flat also includes 58 buildings with other roof tags but no shape and three
        // unsupported shapes; seven quadruple_saltbox roofs join the hipped group.
        {
          gabled: 170,
          flat: 153,
          hipped: 34,
          mansard: 26,
          gambrel: 22,
          skillion: 6,
          round: 3,
          'half-hipped': 2,
        }
      : { flat: 16 };
    for (const [shape, count] of Object.entries(expected)) {
      expect(counts[shape]).toBeGreaterThanOrEqual(count * 0.9);
      expect(counts[shape]).toBeLessThanOrEqual(count * 1.1);
    }
    if (name.startsWith('sindelfingen')) expect(canopies).toBe(15);
    else
      expect(result.diagnostics.some((d) => /7.*quadruple_saltbox.*hipped/.test(d.message))).toBe(
        true,
      );
    console.info('V109 imported roofs', name, { counts, canopies });
  },
);

unitTest(
  'V109 project boundary preserves complete building metadata and rejects invalid dimensions',
  () => {
    const city = grid5x5();
    const feature = {
      kind: 'area',
      class: 'building',
      rings: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 10 },
          { x: 0, y: 0 },
        ],
      ],
      colour: '#aabbcc',
      material: 'brick',
      minHeightM: 0,
      roof: {
        shape: 'gabled',
        heightM: 3,
        levels: 1,
        colour: '#8b0000',
        material: 'tile',
        orientation: 'along',
        directionDeg: 90,
      },
    };
    expect(
      citySchema.parse({ ...city, context: { features: [feature] } }).context?.features[0],
    ).toEqual(feature);
    for (const bad of [
      { minHeightM: -1 },
      { colour: 'red' },
      { roof: { shape: 'unsupported' } },
      { roof: { shape: 'gabled', heightM: -1 } },
      { roof: { shape: 'gabled', directionDeg: 360 } },
    ]) {
      expect(
        citySchema.safeParse({ ...city, context: { features: [{ ...feature, ...bad }] } }).success,
      ).toBe(false);
    }
  },
);
