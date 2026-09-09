import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => ({
  Lato: () => ({ variable: '--font-lato' }),
  Poppins: () => ({ variable: '--font-poppins' }),
}));

import { metadata } from '@/app/layout';

const trainingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('training root layout metadata', () => {
  it('uses the same favicon.ico as the public website', () => {
    expect(metadata.icons).toEqual({
      icon: '/favicon.ico',
      shortcut: '/favicon.ico',
    });
    expect(fs.existsSync(path.join(trainingRoot, 'public/favicon.ico'))).toBe(true);
  });
});
