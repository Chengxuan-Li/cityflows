import { expect, test } from 'vitest';
import { createEditor } from '../../src/editor';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { scenarioSchema } from '../../src/schema';
import { saveProject } from '../../src/project/save';
import { openProject } from '../../src/project/open';

test('T50 deleting an entrance place remains saveable and undo restores its walk access', async () => {
  const city = grid5x5(),
    place = Object.values(city.places)[0]!;
  city.walk = {
    nodes: {
      'wn:9999': {
        id: 'wn:9999',
        pos: { x: 12, y: -10 },
        layer: 0,
        entrance: { placeId: place.id },
        provenance: { source: 'osm' },
      },
    },
    links: {},
  };
  city.nextId = 10000;
  const editor = createEditor(city);
  expect(editor.apply({ kind: 'deletePlace', placeId: place.id }).ok).toBe(true);
  const project = {
    city: editor.city,
    scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))],
    history: editor.history,
  };
  expect(await openProject(await saveProject(project))).toEqual({ ok: true, project });
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.compiled.walk.places.has(place.id)).toBe(true);
  expect(editor.redo()?.ok).toBe(true);
  expect(editor.compiled.walk.places.has(place.id)).toBe(false);
});
