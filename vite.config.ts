import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.CITYFLOWS_BASE_PATH ?? '/',
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
    // Real-city imports (corridors, relaxation, junction polygons) take 5 to 25 s per test on
    // CI; the 5 s default timed out six of them on every push since TASK-085.
    testTimeout: 60_000,
  },
});
