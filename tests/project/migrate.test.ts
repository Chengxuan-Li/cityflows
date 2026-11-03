/// <reference types="node" />
import { readFile, writeFile } from 'node:fs/promises';
import { env } from 'node:process';
import { format } from 'prettier';
import { expect, it, vi } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { openProject } from '../../src/project/open';
import { saveProjectJson } from '../../src/project/save';
import * as migration from '../../src/schema/migrate';

const fixture = new URL('../../fixtures/projects/grid5x5.cityflows.json', import.meta.url);

// Regenerate with UPDATE_FIXTURES=1 npm test -- tests/project/migrate.test.ts
// In PowerShell, set $env:UPDATE_FIXTURES = '1' before running the test.
it('matches the checked-in demo project', async () => {
  const project = { city: grid5x5(), scenarios: [defaultScenario('grid5x5')] };
  const saved = await saveProjectJson(project, {
    projectId: 'grid5x5',
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
    const saved = await readFile(fixture, 'utf8');
    expect(await openProject(saved)).toEqual({
      ok: true,
      project: { city: grid5x5(), scenarios: [defaultScenario('grid5x5')] },
    });
    expect(migrate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ schemaVersion: 1 }));
  } finally {
    migrate.mockRestore();
  }
});
