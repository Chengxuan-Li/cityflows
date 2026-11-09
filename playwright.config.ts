import { defineConfig } from '@playwright/test';

const port = Number(process.env.CITYFLOWS_TEST_PORT ?? 4173);
const productionPort = Number(process.env.CITYFLOWS_PRODUCTION_TEST_PORT ?? port + 1);

// CI runs four e2e jobs balanced by measured duration (lead, 2026-11-07): `--shard` splits the
// sorted file list by count, which gave the last shard every heavy 3D case (20 to 27 minutes
// against 5 to 10). The matrix sets CITYFLOWS_E2E_GROUP; `rest` runs every file not named
// here, so a new spec file is never skipped. Unset, every test runs.
const groups: Record<string, string[]> = {
  a: ['V106-vegetation', 'view3d', 'T19-live-town', 'vehicle-classes'],
  b: [
    'T16-performance',
    'V105-terrain',
    'qa-mobile',
    'crossings',
    'gate4-layers',
    'qa-munich',
    'gate3-bypass',
  ],
  c: [
    'V97-grade-shadows',
    'T44-context',
    'gate3-places',
    'gate2-import',
    'demo-d-import-edit-share',
    'demo-c-bypass',
  ],
};
const group = process.env.CITYFLOWS_E2E_GROUP;
if (group && group !== 'rest' && !groups[group]) throw new Error(`Unknown e2e group ${group}`);
const files = (names: string[]) => names.map((name) => `**/${name}.spec.ts`);
const named = files(Object.values(groups).flat());
const production = '**/qa-production.spec.ts';

export default defineConfig({
  testDir: 'tests/e2e',
  // Idle maps no longer redraw on CI's software GPU; ordinary cases share the local limit.
  timeout: 60_000,
  // CI's runner imports a real extract and redraws its junction polygons past the 5 s default.
  expect: { timeout: 20_000 },
  // Scenarios that step whole mornings starve parallel pages of the shared GPU process.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // CI's default dot reporter hides per-test durations; list shows which case slows a group.
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  webServer: [
    {
      command: `npm run build -- --mode test && npm run preview -- --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
      timeout: 420_000,
    },
    {
      command: `npm run build -- --mode production --outDir node_modules/.cache/qa-production && npm run preview -- --outDir node_modules/.cache/qa-production --port ${productionPort} --strictPort`,
      env: { CITYFLOWS_BASE_PATH: '/cityflows/' },
      url: `http://localhost:${productionPort}/cityflows/`,
      reuseExistingServer: false,
      timeout: 420_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      ...(group && group !== 'rest' ? { testMatch: files(groups[group]!) } : {}),
      testIgnore: group === 'rest' ? [production, ...named] : production,
      use: { browserName: 'chromium' },
    },
    {
      name: 'production',
      testMatch: !group || group === 'rest' ? production : [],
      use: { browserName: 'chromium', baseURL: `http://localhost:${productionPort}/cityflows/` },
    },
  ],
});
