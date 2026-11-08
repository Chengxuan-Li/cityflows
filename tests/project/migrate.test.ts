/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import { openProject } from '../../src/project/open';
import * as migration from '../../src/schema/migrate';
import { saveProject } from '../../src/project/save';
import { scenarioSchema } from '../../src/schema';
import { baselineSchema } from '../../src/project/scenarios';

const fixturePath = (id: string) =>
  new URL(`../../fixtures/projects/${id}.cityflows.json`, import.meta.url);

it('migrates version 2 car permissions to vans and round-trips version 3', async () => {
  const current = grid5x5();
  const old = { ...current, schemaVersion: 2 };
  const [road] = Object.values(old.roads);
  road!.lanes = [
    { widthM: 3, allowed: ['car', 'truck'] },
    { widthM: 3, allowed: ['bus'] },
  ];
  const migrated = migration.migrateCity(old);
  expect(baselineSchema.parse({ city: old, scenario: defaultScenario('grid5x5') }).city).toEqual(
    migrated,
  );
  expect(migrated.schemaVersion).toBe(3);
  expect(migrated.roads[road!.id]!.lanes.map((lane) => lane.allowed)).toEqual([
    ['car', 'van', 'truck'],
    ['bus'],
  ]);
  expect(road!.lanes[0]!.allowed).toEqual(['car', 'truck']);
  const project = { city: migrated, scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] };
  expect(await openProject(await saveProject(project))).toEqual({ ok: true, project });
});

it.each([
  ['grid5x5', grid5x5],
  ['town', town],
] as const)('matches the checked-in version 1 %s project', async (id, generate) => {
  const saved = await readFile(fixturePath(id), 'utf8');
  expect(await openProject(saved)).toEqual({
    ok: true,
    project: { city: generate(), scenarios: [scenarioSchema.parse(defaultScenario(id))] },
  });
});

it('opens the version 1 demo through the city migration entry point', async () => {
  const migrate = vi.spyOn(migration, 'migrateCity');
  try {
    const saved = await readFile(fixturePath('grid5x5'), 'utf8');
    expect(await openProject(saved)).toEqual({
      ok: true,
      project: { city: grid5x5(), scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] },
    });
    expect(migrate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ schemaVersion: 1 }));
  } finally {
    migrate.mockRestore();
  }
});
