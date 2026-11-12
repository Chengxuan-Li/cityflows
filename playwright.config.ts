import { defineConfig } from '@playwright/test';

const port = Number(process.env.CITYFLOWS_TEST_PORT ?? 4173);
const productionPort = Number(process.env.CITYFLOWS_PRODUCTION_TEST_PORT ?? port + 1);

// The full suite runs as five CI jobs balanced by measured duration (lead, 2026-11-07, rebalanced
// 2026-11-10 from CI times): `--shard` splits the sorted file list by count, which gave the last
// shard every heavy 3D case. The matrix sets CITYFLOWS_E2E_GROUP; `rest` runs every file not
// named here, so a new spec file is never skipped. Unset, every test runs.
const groups: Record<string, string[]> = {
  a: [
    'V106-vegetation',
    'view3d',
    'T19-live-town',
    'vehicle-classes',
    'T49-lots',
    'V107-street',
    'V114-themes',
    'T47-road-access',
  ],
  b: [
    'T16-performance',
    'V105-terrain',
    'qa-mobile',
    'crossings',
    'gate4-layers',
    'qa-munich',
    'gate3-bypass',
    'T63-parking-claims',
  ],
  c: [
    'V97-grade-shadows',
    'demo-d-import-edit-share',
    'gate3-places',
    'T44-context',
    'gate2-import',
    'demo-c-bypass',
    'V115-redraw',
    'T54-parking-motion',
    'V109-buildings',
  ],
  // Lead, 2026-11-10: T52 alone took 14 min on checkpoint-2026-11-10 (8 min before TASK-124/126).
  d: ['T52-parking-cities'],
  // Rail (TASK-126, TASK-127, TASK-133, TASK-134, TASK-137): Munich imports with long frame-time
  // samples.
  e: [
    'T62-rail-stations',
    'T64-trains',
    'T70-station-furniture',
    'T73-tram-stops',
    'T74-overhead-lines',
  ],
};
// The light set (lead, 2026-11-10): editor, run and person flows on the small synthetic cities,
// no Munich import or 3D, about 5 minutes on CI. Every push and merge runs it; the full suite
// runs at checkpoints. `npm run test:e2e:light` selects it.
const light = [
  'gate1-edit',
  'gate1-run',
  'gate1-save',
  'gate2-edit',
  'gate2-batch',
  'gate3-paint',
  'gate4-signals',
  'gate4-compare',
  'gate5-controls',
  'demo-a-commute',
  'demo-b-airport',
  'demo-onboarding',
  'qa-exports',
  'T48-parking',
  'T52-visible-parking',
  'T53-pedestrians',
  'T57-person-trips',
];
const group =
  process.env.CITYFLOWS_E2E_GROUP ??
  (process.env.npm_lifecycle_event === 'test:e2e:light' ? 'light' : undefined);
if (group && group !== 'rest' && group !== 'light' && !groups[group])
  throw new Error(`Unknown e2e group ${group}`);
const files = (names: string[]) => names.map((name) => `**/${name}.spec.ts`);
const named = files(Object.values(groups).flat());
const production = '**/qa-production.spec.ts';
const withProduction = !group || group === 'rest';

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
    ...(withProduction
      ? [
          {
            command: `npm run build -- --mode production --outDir node_modules/.cache/qa-production && npm run preview -- --outDir node_modules/.cache/qa-production --port ${productionPort} --strictPort`,
            env: { CITYFLOWS_BASE_PATH: '/cityflows/' },
            url: `http://localhost:${productionPort}/cityflows/`,
            reuseExistingServer: false,
            timeout: 420_000,
          },
        ]
      : []),
  ],
  projects: [
    {
      name: 'chromium',
      ...(group && group !== 'rest'
        ? { testMatch: files(group === 'light' ? light : groups[group]!) }
        : {}),
      testIgnore: group === 'rest' ? [production, ...named] : production,
      use: { browserName: 'chromium' },
    },
    {
      name: 'production',
      testMatch: withProduction ? production : [],
      use: { browserName: 'chromium', baseURL: `http://localhost:${productionPort}/cityflows/` },
    },
  ],
});
