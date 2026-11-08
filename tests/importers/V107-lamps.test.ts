import { expect, test } from 'vitest';
import { importContext } from '../../src/importers/osm/context';
import { buildQuery } from '../../src/importers/overpass';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { scenarioSchema } from '../../src/schema';
import { saveProject, saveProjectJson } from '../../src/project/save';
import { openProject } from '../../src/project/open';

test('V107 imports bounded lamps with metric height and mounting, separately from trees', () => {
  const features = importContext(
    {
      node: [
        {
          id: 1,
          lon: 0,
          lat: 0,
          tag: { highway: 'street_lamp', height: '20 ft', lamp_mount: 'pole', support: 'wall' },
        },
        {
          id: 2,
          lon: 0,
          lat: 0,
          tag: { highway: 'street_lamp', height: 'unknown', support: 'wall' },
        },
        { id: 3, lon: 0, lat: 0, tag: { highway: 'street_lamp' } },
      ],
      way: [],
      relation: [],
    },
    new Map([
      [1, { x: 5, y: 5 }],
      [2, { x: 10, y: 10 }],
      [3, { x: 30, y: 10 }],
    ]),
    { min: { x: 0, y: 0 }, max: { x: 20, y: 20 } },
  );
  expect(features).toEqual([
    { kind: 'point', class: 'street_lamp', pos: { x: 5, y: 5 }, heightM: 6.096, sub: 'pole' },
    { kind: 'point', class: 'street_lamp', pos: { x: 10, y: 10 }, sub: 'wall' },
  ]);
  expect(buildQuery([11.5, 48.1, 11.51, 48.11])).toContain(
    'node[highway=street_lamp](48.1,11.5,48.11,11.51);',
  );
  expect(buildQuery([11.5, 48.1, 11.51, 48.11], false)).not.toContain('street_lamp');
});

test.each([saveProject, saveProjectJson])(
  'V107 lamp points and legacy projects round trip (%#)',
  async (save) => {
    const city = grid5x5();
    const project = { city, scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] };
    expect(await openProject(await save(project))).toEqual({ ok: true, project });
    city.context = {
      features: [
        { kind: 'point', class: 'street_lamp', pos: { x: 40, y: 40 }, heightM: 7, sub: 'pole' },
      ],
    };
    expect(await openProject(await save(project))).toEqual({ ok: true, project });
  },
);
