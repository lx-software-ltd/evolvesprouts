import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SUPPORTED_LOCALES } from '@/content';
import {
  buildLandingPagePath,
  getAllLandingPageSlugs,
  getLandingPageContent,
  isValidLandingPageSlug,
} from '@/lib/landing-pages';
import { RESERVED_PATH_SEGMENTS, ROUTES } from '@/lib/routes';

describe('landing-pages registry', () => {
  it('returns at least one registered slug', () => {
    const slugs = getAllLandingPageSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.every((slug) => typeof slug === 'string' && slug.length > 0)).toBe(
      true,
    );
  });

  it('validates registered and unknown slugs', () => {
    const [firstSlug] = getAllLandingPageSlugs();
    if (!firstSlug) {
      throw new Error('Expected at least one landing page slug.');
    }

    expect(isValidLandingPageSlug(firstSlug)).toBe(true);
    expect(isValidLandingPageSlug('not-a-real-landing-page')).toBe(false);
  });

  it('resolves locale content for valid slugs and null for unknown slugs', () => {
    const [firstSlug] = getAllLandingPageSlugs();
    if (!firstSlug) {
      throw new Error('Expected at least one landing page slug.');
    }

    for (const locale of SUPPORTED_LOCALES) {
      const content = getLandingPageContent(firstSlug, locale);
      expect(content).not.toBeNull();
      expect(content?.meta.title).toBeTruthy();
    }

    expect(getLandingPageContent('unknown-slug', 'en')).toBeNull();
  });

  it('builds slash-prefixed landing page paths', () => {
    const [firstSlug] = getAllLandingPageSlugs();
    if (!firstSlug) {
      throw new Error('Expected at least one landing page slug.');
    }

    expect(buildLandingPagePath(firstSlug)).toBe(`/${firstSlug}`);
  });

  it('does not collide with reserved path segments (routes + filesystem roots)', () => {
    for (const slug of getAllLandingPageSlugs()) {
      expect(RESERVED_PATH_SEGMENTS.has(slug)).toBe(false);
    }
  });

  it('covers ROUTES first segments via RESERVED_PATH_SEGMENTS or landing-page slugs', () => {
    const landingSlugs = new Set<string>(getAllLandingPageSlugs());
    for (const routePath of Object.values(ROUTES)) {
      const segment = routePath.replace(/^\/+|\/+$/g, '').split('/')[0] ?? '';
      if (segment) {
        expect(
          RESERVED_PATH_SEGMENTS.has(segment) || landingSlugs.has(segment),
        ).toBe(true);
      }
    }
  });

  it('every landing page slug has a root app redirect page using the shared factory', () => {
    const appDir = path.resolve(__dirname, '../../src/app');
    for (const slug of getAllLandingPageSlugs()) {
      const pageFile = path.join(appDir, slug, 'page.tsx');
      expect(existsSync(pageFile)).toBe(true);
      const source = readFileSync(pageFile, 'utf8');
      expect(source).toContain('createLandingPageRootRedirect');
    }
  });

  it('every root page that uses createLandingPageRootRedirect matches a registered slug', () => {
    const appDir = path.resolve(__dirname, '../../src/app');
    const registered = new Set<string>(getAllLandingPageSlugs());
    const entries = readdirSync(appDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('[') || entry.name.startsWith('(')) {
        continue;
      }
      const pageFile = path.join(appDir, entry.name, 'page.tsx');
      if (!existsSync(pageFile)) {
        continue;
      }
      const source = readFileSync(pageFile, 'utf8');
      if (source.includes('createLandingPageRootRedirect')) {
        expect(registered.has(entry.name)).toBe(true);
      }
    }
  });

  it('matches landing-pages-manifest slug list (same source as deploy calendar probe)', () => {
    const landingPagesTs = readFileSync(
      path.resolve(__dirname, '../../src/lib/landing-pages.ts'),
      'utf8',
    );
    const landingPagesMatch = landingPagesTs.match(
      /const\s+LANDING_PAGES\s*=\s*\{([\s\S]*?)\}\s*satisfies/,
    );
    expect(landingPagesMatch).not.toBeNull();
    const manifestSlugs = [...landingPagesMatch![1].matchAll(/^\s*'([^']+)'\s*:/gm)].map(
      (entry) => entry[1],
    );
    const registrySlugs = [...getAllLandingPageSlugs()].sort();
    expect([...manifestSlugs].sort()).toEqual(registrySlugs);
  });

  it('book-a-free-call JSON defines introCall; other sample landing pages omit it', () => {
    const dir = path.resolve(__dirname, '../../src/content/landing-pages');
    const freeCallPath = path.join(dir, 'book-a-free-call.json');
    expect(existsSync(freeCallPath)).toBe(true);
    const freeCall = JSON.parse(readFileSync(freeCallPath, 'utf8')) as Record<
      string,
      { introCall?: unknown }
    >;
    for (const locale of SUPPORTED_LOCALES) {
      expect(freeCall[locale]?.introCall, locale).toBeDefined();
    }
    const otherFiles = [
      'easter-2026-montessori-play-coaching-workshop.json',
      'may-2026-the-missing-piece.json',
      'nov-2026-mealtimes-workshop.json',
    ];
    for (const fileName of otherFiles) {
      const p = path.join(dir, fileName);
      if (!existsSync(p)) {
        continue;
      }
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, { introCall?: unknown }>;
      for (const locale of SUPPORTED_LOCALES) {
        expect(raw[locale]?.introCall, `${fileName} ${locale}`).toBeUndefined();
      }
    }
  });

  it('every static root app segment with page.tsx is reserved or a registered landing slug', () => {
    const appDir = path.resolve(__dirname, '../../src/app');
    const landingSlugSet = new Set<string>(getAllLandingPageSlugs());
    const entries = readdirSync(appDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('[') || entry.name.startsWith('(')) {
        continue;
      }
      const pageFile = path.join(appDir, entry.name, 'page.tsx');
      if (!existsSync(pageFile)) {
        continue;
      }
      const covered =
        RESERVED_PATH_SEGMENTS.has(entry.name) || landingSlugSet.has(entry.name);
      expect(
        covered,
        `Add "${entry.name}" to RESERVED_PATH_SEGMENTS in routes.ts or register it as a landing page slug.`,
      ).toBe(true);
    }
  });
});
