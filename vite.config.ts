import { globSync, readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Test tiers (TASK-090): `npm test` (unit) runs the unit tests, the synthetic cities and
// Sindelfingen; `test:city` Munich's geometry and import; `test:traffic` the Munich mornings.
// A file that imports `tests/tier.ts` runs in both the unit and the city tier, each with its own
// cities (`tierCities`, `cityTest`, `unitTest`); a `*.city.test.ts` file only in the city tier.
const tiered = globSync('tests/**/*.test.ts')
  .map((file) => file.replaceAll('\\', '/'))
  .filter((file) => /from '\.\.\/tier'/.test(readFileSync(file, 'utf8')));

export default defineConfig({
  base: process.env.CITYFLOWS_BASE_PATH ?? '/',
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    // Real-city imports (corridors, relaxation, junction polygons) take 5 to 25 s per test on
    // CI; the 5 s default timed out six of them on every push since TASK-085.
    testTimeout: 60_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['tests/e2e/**', 'tests/traffic/**', 'tests/**/*.city.test.ts'],
          provide: { munich: false },
        },
      },
      {
        extends: true,
        test: {
          name: 'city',
          include: [...tiered, 'tests/**/*.city.test.ts'],
          provide: { munich: true },
        },
      },
      { extends: true, test: { name: 'traffic', include: ['tests/traffic/**/*.test.ts'] } },
    ],
  },
});
