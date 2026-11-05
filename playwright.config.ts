import { defineConfig } from '@playwright/test';

const port = Number(process.env.CITYFLOWS_TEST_PORT ?? 4173);
const productionPort = port + 1;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  // Scenarios that step whole mornings starve parallel pages of the shared GPU process.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  webServer: [
    {
      command: `npm run build -- --mode test && npm run preview -- --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run build -- --mode production --outDir node_modules/.cache/qa-production && npm run preview -- --outDir node_modules/.cache/qa-production --port ${productionPort} --strictPort`,
      env: { CITYFLOWS_BASE_PATH: '/cityflows/' },
      url: `http://localhost:${productionPort}/cityflows/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'chromium', testIgnore: '**/qa-production.spec.ts', use: { browserName: 'chromium' } },
    {
      name: 'production',
      testMatch: '**/qa-production.spec.ts',
      use: { browserName: 'chromium', baseURL: `http://localhost:${productionPort}/cityflows/` },
    },
  ],
});
