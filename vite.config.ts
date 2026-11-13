import { globSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Test tiers (TASK-090): `npm test` (unit) runs the unit tests, the synthetic cities and
// Sindelfingen; `test:city` Munich's geometry and import; `test:traffic` the Munich mornings.
// A file that imports `tests/tier.ts` runs in both the unit and the city tier, each with its own
// cities (`tierCities`, `cityTest`, `unitTest`); a `*.city.test.ts` file only in the city tier.
const tiered = globSync('tests/**/*.test.ts')
  .map((file) => file.replaceAll('\\', '/'))
  .filter((file) => /from '\.\.\/tier'/.test(readFileSync(file, 'utf8')));

// The per-test limit; tests/timeouts.ts scales every limit written in a test file by the same ratio.
const timeoutMs = Number(process.env.CITYFLOWS_TEST_TIMEOUT_MS ?? 60_000);

// Test files run on at most eight workers (four for the Munich tier, whose files each compile a
// whole city); vitest's default is one fewer than the cores. On a shared machine every extra
// worker is starved by the other runs and a Munich test then outlasts its limit. CI has four
// cores and is unaffected. CITYFLOWS_TEST_WORKERS=1 runs the files one at a time.
const workers = Number(
  process.env.CITYFLOWS_TEST_WORKERS ?? Math.min(8, Math.max(1, availableParallelism() - 1)),
);

export default defineConfig({
  base: process.env.CITYFLOWS_BASE_PATH ?? '/',
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    // Real-city imports (corridors, relaxation, junction polygons) take 5 to 25 s per test on
    // CI; the 5 s default timed out six of them on every push since TASK-085.
    // Shared-host validation may extend wall time without changing assertions or CI defaults.
    testTimeout: timeoutMs,
    hookTimeout: (timeoutMs / 60_000) * 10_000,
    maxWorkers: workers,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          globalSetup: 'tests/warm-cache.ts',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['tests/e2e/**', 'tests/traffic/**', 'tests/**/*.city.test.ts'],
          provide: { munich: false },
        },
      },
      {
        extends: true,
        test: {
          name: 'city',
          maxWorkers: Math.min(workers, 4),
          globalSetup: 'tests/warm-cache.ts',
          include: [...tiered, 'tests/**/*.city.test.ts'],
          provide: { munich: true },
        },
      },
      {
        extends: true,
        test: {
          name: 'traffic',
          globalSetup: 'tests/warm-cache.ts',
          include: ['tests/traffic/**/*.test.ts'],
        },
      },
    ],
  },
});
