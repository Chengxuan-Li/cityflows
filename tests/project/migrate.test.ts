/// <reference types="node" />
import { readFile, writeFile } from 'node:fs/promises';
import { env } from 'node:process';
import { format } from 'prettier';
import { expect, it, vi } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import { openProject } from '../../src/project/open';
import { saveProjectJson } from '../../src/project/save';
import * as migration from '../../src/schema/migrate';

const fixturePath = (id: string) =>
  new URL(`../../fixtures/projects/${id}.cityflows.json`, import.meta.url);

// Regenerate with UPDATE_FIXTURES=1 npm test -- tests/project/migrate.test.ts
// In PowerShell, set $env:UPDATE_FIXTURES = '1' before running the test.
it.each([
  ['grid5x5', grid5x5],
  ['town', town],
] as const)('matches the checked-in %s project', async (id, generate) => {
  const fixture = fixturePath(id);
  const project = { city: generate(), scenarios: [defaultScenario(id)] };
  const saved = await saveProjectJson(project, {
    projectId: id,
    savedAt: '2026-11-03T00:00:00.000Z',
  });
  const formatted = await format(saved, { parser: 'json' });
  if (env.UPDATE_FIXTURES) await writeFile(fixture, formatted);
  const checkedIn = await readFile(fixture, 'utf8');
  expect(checkedIn).toBe(formatted);
});

it('opens the version 1 demo through the city migration entry point', async () => {
  const migrate = vi.spyOn(migration, 'migrateCity');
  try {
    const saved = await readFile(fixturePath('grid5x5'), 'utf8');
    expect(await openProject(saved)).toEqual({
      ok: true,
      project: { city: grid5x5(), scenarios: [defaultScenario('grid5x5')] },
    });
    expect(migrate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ schemaVersion: 1 }));
  } finally {
    migrate.mockRestore();
  }
});
