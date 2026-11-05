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
  },
});
