import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const contentDir = path.resolve(__dirname, '../../src/content');

const localeFiles = ['en.json', 'zh-CN.json', 'zh-HK.json'] as const;

const REQUIRED_NON_EMPTY_COPY_KEYS = [
  'common.accessibility.carouselRoleDescription',
  'common.locationToBeConfirmedLabel',
  'common.shell.skipToMainContentLabel',
  'common.shell.environmentBadgeLabel',
  'resources.formFirstNameLabel',
  'resources.formEmailLabel',
  'resources.ctaLabel',
] as const;

function readStringAtPath(source: Record<string, unknown>, keyPath: string): string | undefined {
  const pathSegments = keyPath.split('.');
  let currentValue: unknown = source;

  for (const segment of pathSegments) {
    if (!currentValue || typeof currentValue !== 'object' || Array.isArray(currentValue)) {
      return undefined;
    }
    currentValue = (currentValue as Record<string, unknown>)[segment];
  }

  return typeof currentValue === 'string' ? currentValue : undefined;
}

describe('required locale copy keys', () => {
  it.each(localeFiles)('%s has required non-empty strings', (filename) => {
    const raw = readFileSync(path.join(contentDir, filename), 'utf-8');
    const content = JSON.parse(raw) as Record<string, unknown>;

    for (const keyPath of REQUIRED_NON_EMPTY_COPY_KEYS) {
      const value = readStringAtPath(content, keyPath);
      expect(value, `${filename}:${keyPath}`).toBeTruthy();
      expect(value?.trim(), `${filename}:${keyPath}`).not.toBe('');
    }
  });
});
