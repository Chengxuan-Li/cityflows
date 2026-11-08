import { expect, test } from 'vitest';
import { importContext } from '../../src/importers/osm/context';
import { buildQuery } from '../../src/importers/overpass';
import { citySchema, scenarioSchema } from '../../src/schema';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { saveProject, saveProjectJson } from '../../src/project/save';
import { openProject } from '../../src/project/open';

test('V106 rejects sub-2m row spacing at project boundaries and ignores it on OSM import', () => {
  const row = {
    kind: 'line',
    class: 'tree_row',
    line: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ],
    spacingM: 0.000001,
  };
  expect(citySchema.safeParse({ ...grid5x5(), context: { features: [row] } }).success).toBe(false);
  const features = importContext(
    {
      node: [],
      relation: [],
      way: [{ id: 1, nd: [1, 2], tag: { natural: 'tree_row', spacing: '0.000001' } }],
    },
    new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 1000, y: 0 }],
    ]),
    { min: { x: 0, y: 0 }, max: { x: 1000, y: 1000 } },
  );
  expect(features[0]).not.toHaveProperty('spacingM');
});

test('V106 retains park paths as clipped display surfaces so vegetation can keep them clear', () => {
  const features = importContext(
    {
      node: [],
      relation: [],
      way: [
        { id: 1, nd: [1, 2], tag: { highway: 'footway', width: '2' } },
        { id: 2, nd: [3, 4, 5, 6, 3], tag: { leisure: 'park' } },
      ],
    },
    new Map([
      [1, { x: -10, y: 10 }],
      [2, { x: 30, y: 10 }],
      [3, { x: 0, y: 0 }],
      [4, { x: 20, y: 0 }],
      [5, { x: 20, y: 20 }],
      [6, { x: 0, y: 20 }],
    ]),
    { min: { x: 0, y: 0 }, max: { x: 20, y: 20 } },
  );
  expect(features).toHaveLength(2);
  expect(features[1]).toMatchObject({ kind: 'area', class: 'landuse', sub: 'path' });
  if (features[1]?.kind === 'area') {
    expect(features[1].rings[0]!.every((p) => p.x >= 0 && p.x <= 20 && p.y >= 9 && p.y <= 11)).toBe(
      true,
    );
  }
});

test('V106 imports bounded tree nodes, dimensions and clipped rows without moving source geometry', () => {
  const positions = new Map([
    [1, { x: 5, y: 5 }],
    [2, { x: -10, y: 10 }],
    [3, { x: 30, y: 10 }],
  ]);
  const before = structuredClone(positions);
  const features = importContext(
    {
      node: [
        {
          id: 1,
          lon: 0,
          lat: 0,
          tag: { natural: 'tree', height: '30 ft', diameter_crown: '4', leaf_type: 'needleleaved' },
        },
        { id: 2, lon: 0, lat: 0, tag: { natural: 'tree' } },
      ],
      way: [{ id: 1, nd: [2, 3], tag: { natural: 'tree_row' } }],
      relation: [],
    },
    positions,
    { min: { x: 0, y: 0 }, max: { x: 20, y: 20 } },
  );
  expect(features).toEqual([
    {
      kind: 'point',
      class: 'tree',
      pos: { x: 5, y: 5 },
      heightM: 9.144,
      crownM: 4,
      sub: 'needleleaved',
    },
    {
      kind: 'line',
      class: 'tree_row',
      line: [
        { x: 0, y: 10 },
        { x: 20, y: 10 },
      ],
    },
  ]);
  expect(positions).toEqual(before);
  expect(buildQuery([11.5, 48.1, 11.51, 48.11])).toContain(
    'node[natural=tree](48.1,11.5,48.11,11.51)',
  );
  expect(buildQuery([11.5, 48.1, 11.51, 48.11])).toContain(
    'way[natural=tree_row](48.1,11.5,48.11,11.51)',
  );
  expect(buildQuery([11.5, 48.1, 11.51, 48.11], false)).not.toContain('natural');
});

test.each([saveProject, saveProjectJson])(
  'V106 tree context survives save/open and legacy cities still load (%#)',
  async (save) => {
    const city = grid5x5();
    const project = { city, scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] };
    expect(await openProject(await save(project))).toEqual({ ok: true, project });
    const parsed = citySchema.safeParse({
      ...city,
      context: {
        features: [
          {
            kind: 'point',
            class: 'tree',
            pos: { x: 40, y: 40 },
            heightM: 12,
            crownM: 5,
            sub: 'broadleaved',
          },
          {
            kind: 'line',
            class: 'tree_row',
            line: [
              { x: 0, y: 0 },
              { x: 30, y: 0 },
            ],
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const withTrees = { ...project, city: parsed.data };
    expect(await openProject(await save(withTrees))).toEqual({ ok: true, project: withTrees });
  },
);
