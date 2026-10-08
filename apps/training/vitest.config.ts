import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const filePath = fileURLToPath(import.meta.url);
const rootDirectory = path.dirname(filePath);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDirectory, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text', 'lcov'],
      // Ratchet with at least two points under the measured suite.
      // Statements measured 66.74, so the floor is 64.
      thresholds: {
        statements: 64,
        branches: 57,
        functions: 71,
        lines: 65,
      },
    },
  },
});
