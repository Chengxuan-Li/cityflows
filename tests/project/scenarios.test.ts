import { expect, test } from 'vitest';
import { createEditor } from '../../src/editor';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { saveBaseline, restoreBaseline } from '../../src/project/scenarios';
import { saveProject, saveProjectJson } from '../../src/project/save';
import { openProject } from '../../src/project/open';
import { sha256 } from '../../src/project/hash';
import { scenarioSchema } from '../../src/schema';

test('baseline round-trips with its scenario in ZIP and JSON; restore is undoable', async () => {
  const city = grid5x5();
  const project = { city, scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] };
  const baseline = saveBaseline(city, project.scenarios[0]!);
  const editor = createEditor({ ...city, name: 'Variant grid' });
  const road = Object.values(city.roads)[0]!;
  editor.apply({ kind: 'setRoadAttributes', roadId: road.id, speedLimitMps: 3 });
  expect(editor.apply({ kind: 'splitRoad', roadId: road.id, atM: 60 }).ok).toBe(true);
  const variant = editor.city;
  for (const bytes of [
    await saveProject({ ...project, city: variant, baseline }),
    await saveProjectJson({ ...project, city: variant, baseline }),
  ]) {
    const opened = await openProject(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.project.baseline).toEqual(baseline);
    expect(opened.project.city).toEqual(variant);
  }
  expect(restoreBaseline(editor, baseline).ok).toBe(true);
  expect(editor.city.roads).toEqual(city.roads);
  expect(editor.city.nodes).toEqual(city.nodes);
  expect(editor.city.places).toEqual(city.places);
  expect(editor.city.nextId).toBe(createEditor(city).city.nextId);
  expect(editor.city.name).toBe(city.name);
  expect(editor.city.version).toBe(variant.version + 1);
  editor.undo();
  expect(editor.city.roads).toEqual(variant.roads);
  expect(editor.city.name).toBe('Variant grid');
  expect(editor.city.nextId).toBe(variant.nextId);
  editor.redo();
  expect(editor.city.roads).toEqual(city.roads);
  const legacy = await openProject(await saveProject(project));
  expect(legacy.ok && legacy.project.baseline).toBeUndefined();
});

test('baseline is hash-verified and validated at the project boundary', async () => {
  const city = grid5x5();
  const scenario = defaultScenario('grid5x5');
  const document = JSON.parse(
    await saveProjectJson({ city, scenarios: [scenario], baseline: saveBaseline(city, scenario) }),
  ) as {
    baseline: { scenario: { endS: number } };
    manifest: { files: Record<string, string> };
  };
  document.baseline.scenario.endS = -1;
  expect(await openProject(JSON.stringify(document))).toMatchObject({
    ok: false,
    file: 'baseline.json',
    error: 'SHA-256 hash mismatch',
  });
  document.manifest.files['baseline.json'] = await sha256(
    new TextEncoder().encode(JSON.stringify(document.baseline)),
  );
  expect(await openProject(JSON.stringify(document))).toMatchObject({
    ok: false,
    file: 'baseline.json',
    error: expect.stringContaining('scenario'),
  });
});
