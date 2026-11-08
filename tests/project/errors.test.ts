import { unzipSync, zipSync } from 'fflate';
import { expect, it } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { openProject } from '../../src/project/open';
import { saveProject, saveProjectJson } from '../../src/project/save';
import type { Project } from '../../src/project/types';
import { scenarioSchema } from '../../src/schema';

function demoProject(): Project {
  return { city: grid5x5(), scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] };
}

it('identifies a tampered ZIP member', async () => {
  const project = demoProject();
  const entries = unzipSync(await saveProject(project));
  project.city.name = 'Tampered';
  entries['city.json'] = new TextEncoder().encode(JSON.stringify(project.city));
  expect(await openProject(zipSync(entries))).toEqual({
    ok: false,
    file: 'city.json',
    error: expect.stringMatching(/hash mismatch/i),
  });
});

it('identifies a tampered JSON member', async () => {
  const project = demoProject();
  const saved = await saveProjectJson(project);
  const tampered = saved.replace('"nextId":' + project.city.nextId, '"nextId":99999');
  expect(tampered).not.toBe(saved);
  expect(await openProject(tampered)).toEqual({
    ok: false,
    file: 'city.json',
    error: expect.stringMatching(/hash mismatch/i),
  });
});

it('reports the first invalid connector path after verifying the hash', async () => {
  const project = demoProject();
  const place = Object.values(project.city.places)[0]!;
  place.connectors[0]!.lane = -1;
  place.connectors[0]!.positionM = -1;
  expect(await openProject(await saveProject(project))).toEqual({
    ok: false,
    file: 'city.json',
    error: expect.stringContaining(`$.places.${place.id}.connectors[0].lane`),
  });
});

it('identifies a missing scenarios file', async () => {
  const entries = unzipSync(await saveProject(demoProject()));
  delete entries['scenarios.json'];
  expect(await openProject(zipSync(entries))).toEqual({
    ok: false,
    file: 'scenarios.json',
    error: expect.stringMatching(/missing/i),
  });
});

it('opens without history and population files', async () => {
  const project = demoProject();
  const saved = await saveProject(project);
  expect(Object.keys(unzipSync(saved)).sort()).toEqual([
    'city.json',
    'manifest.json',
    'scenarios.json',
  ]);
  expect(await openProject(saved)).toEqual({ ok: true, project });
});

it('reports an unsupported city schema version from the migration entry point', async () => {
  const entries = unzipSync(await saveProject(demoProject()));
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const city = JSON.parse(decoder.decode(entries['city.json']!));
  city.schemaVersion = 4;
  const bytes = encoder.encode(JSON.stringify(city));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const manifest = JSON.parse(decoder.decode(entries['manifest.json']!));
  manifest.files['city.json'] = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  entries['city.json'] = bytes;
  entries['manifest.json'] = encoder.encode(JSON.stringify(manifest));
  expect(await openProject(zipSync(entries))).toEqual({
    ok: false,
    file: 'city.json',
    error: expect.stringMatching(/schema version/i),
  });
});
