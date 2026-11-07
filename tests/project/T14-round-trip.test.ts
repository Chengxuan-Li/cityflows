import { expect, it } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { compile } from '../../src/network';
import { openProject } from '../../src/project/open';
import { saveProject, saveProjectJson } from '../../src/project/save';
import type { Project } from '../../src/project/types';

it.each([
  ['ZIP', saveProject],
  ['JSON', saveProjectJson],
])('T14 round-trips an edited grid in %s', async (_format, save) => {
  const city = grid5x5();
  const road = Object.values(city.roads)[0]!;
  const patch = { set: { roads: { [road.id]: { ...road, speedLimitMps: 8 } } }, remove: {} };
  const inverse = { set: { roads: { [road.id]: road } }, remove: {} };
  city.roads[road.id] = patch.set.roads[road.id]!;
  city.version += 1;
  const [home, work] = Object.values(city.places);
  const project: Project = {
    city,
    scenarios: [defaultScenario('grid5x5')],
    population: [
      {
        id: 'person-1',
        homePlaceId: home!.id,
        workPlaceId: work!.id,
        hasCar: true,
        agenda: [{ kind: 'work', placeId: work!.id, startS: 28800, durationS: 32400 }],
      },
    ],
    history: [{ label: 'Lower speed limit', patch, inverse, version: city.version }],
    view: { camera: { x: 30, y: 60, zoom: 2 }, layers: { roads: true }, selection: [road.id] },
  };

  const opened = await openProject(await save(project));
  expect(opened).toEqual({ ok: true, project });
  if (!opened.ok) throw new Error(opened.error);
  const compiled = compile(city);
  expect(compiled.ok).toBe(true);
  expect(compile(opened.project.city)).toEqual(compiled);
});

it.each([
  ['ZIP', saveProject],
  ['JSON', saveProjectJson],
])('T44 preserves surroundings and the TASK-042 baseline in %s', async (_format, save) => {
  const city = grid5x5();
  city.context = {
    features: [
      {
        kind: 'area',
        class: 'building',
        sub: 'apartments',
        heightM: 12,
        levels: 4,
        rings: [
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 0 },
          ],
        ],
      },
      {
        kind: 'line',
        class: 'rail',
        line: [
          { x: 0, y: 0 },
          { x: 10, y: 20 },
        ],
        layer: 1,
        widthM: 2,
      },
    ],
  };
  const project: Project = {
    city,
    scenarios: [defaultScenario('grid5x5')],
    baseline: { city, scenario: defaultScenario('grid5x5') },
  };
  expect(await openProject(await save(project))).toEqual({ ok: true, project });
});

it('T44 opens an older project without surroundings', async () => {
  const project: Project = { city: grid5x5(), scenarios: [defaultScenario('grid5x5')] };
  const result = await openProject(await saveProject(project));
  expect(result).toEqual({ ok: true, project });
  if (result.ok) expect(result.project.city).not.toHaveProperty('context');
});
