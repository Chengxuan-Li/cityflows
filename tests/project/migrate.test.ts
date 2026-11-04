/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import { openProject } from '../../src/project/open';
import * as migration from '../../src/schema/migrate';

const fixturePath = (id: string) =>
  new URL(`../../fixtures/projects/${id}.cityflows.json`, import.meta.url);

it.each([
  ['grid5x5', grid5x5],
  ['town', town],
] as const)('matches the checked-in version 1 %s project', async (id, generate) => {
  const saved = await readFile(fixturePath(id), 'utf8');
  expect(await openProject(saved)).toEqual({
    ok: true,
    project: { city: generate(), scenarios: [defaultScenario(id)] },
  });
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
