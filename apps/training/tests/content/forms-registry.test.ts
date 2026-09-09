import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildFormPath,
  getAllFormSlugs,
  getFormContent,
  isValidFormSlug,
  resolveFormDocumentTitle,
} from '@/lib/forms';
import { trainingFormRequiresContact } from '@/lib/training-form-catalog';

describe('forms registry', () => {
  it('returns registered slugs and resolves content', () => {
    const slugs = getAllFormSlugs();
    expect(slugs).toContain('workshop-feedback');
    expect(slugs).toContain('workshop-exit-feedback');
    expect(slugs).toContain('pre-session-check-in');
    const content = getFormContent('workshop-feedback');
    expect(content?.title).toBeTruthy();
    expect(content?.slug).toBe('workshop-feedback');
    expect(content?.questions.length).toBeGreaterThan(0);
  });

  it('validates slugs', () => {
    expect(isValidFormSlug('workshop-feedback')).toBe(true);
    expect(isValidFormSlug('missing')).toBe(false);
    expect(getFormContent('missing')).toBeNull();
  });

  it('builds form paths', () => {
    expect(buildFormPath('workshop-feedback')).toBe('/forms/workshop-feedback/');
  });

  it('every content json file is registered with matching slug field', () => {
    const dir = path.resolve(__dirname, '../../src/content/forms');
    const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
    const registered = new Set<string>(getAllFormSlugs());
    for (const fileName of files) {
      const slug = fileName.replace(/\.json$/, '');
      expect(registered.has(slug)).toBe(true);
      const raw = JSON.parse(readFileSync(path.join(dir, fileName), 'utf8')) as {
        slug: string;
        requiresContact?: boolean;
      };
      expect(raw.slug).toBe(slug);
      expect(trainingFormRequiresContact(slug)).toBe(raw.requiresContact === true);
    }
  });

  it('uses pageTitle for the browser tab when set', () => {
    const form = getFormContent('pre-session-check-in');
    expect(form?.pageTitle).toBe('Pre Session Check In');
    expect(form ? resolveFormDocumentTitle(form) : '').toBe('Pre Session Check In');
    expect(form?.title).toContain('{contactFirstName}');
  });

  it('falls back to title for the browser tab when pageTitle is omitted', () => {
    const form = getFormContent('workshop-feedback');
    expect(form?.pageTitle).toBeUndefined();
    expect(form ? resolveFormDocumentTitle(form) : '').toBe('Workshop feedback');
  });

  it('uses dynamic form route page', () => {
    const appFormPage = path.resolve(__dirname, '../../src/app/forms/[slug]/page.tsx');
    expect(existsSync(appFormPage)).toBe(true);
  });
});
