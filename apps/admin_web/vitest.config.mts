import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [
    react(),
    svgr({
      include: '**/*.svg',
      svgrOptions: {
        dimensions: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared-config': path.resolve(__dirname, '../../shared/config'),
      '@shared-public-www': path.resolve(__dirname, '../public_www/src/lib'),
      '@shared-training': path.resolve(__dirname, '../training/src/lib'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text', 'lcov'],
      // Ratchet with at least two points under the measured suite.
      // Branches measured 62.94, so the floor is 60.
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 66,
        lines: 70,
      },
    },
  },
});
