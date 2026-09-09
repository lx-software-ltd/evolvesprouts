import { describe, expect, it } from 'vitest';

import {
  buildLocalizedPublicPageUrl,
  buildSitePageUrl,
  buildTrainingFormOrPollPageUrl,
  normalizePublicSitePathInput,
  normalizePublicSiteSrcValue,
  sanitizePublicSiteSrcQueryInput,
} from '@/lib/public-site-page-urls';

describe('normalizePublicSitePathInput', () => {
  it('normalizes home', () => {
    expect(normalizePublicSitePathInput('')).toEqual({ path: '/', error: '' });
    expect(normalizePublicSitePathInput('   ')).toEqual({ path: '/', error: '' });
    expect(normalizePublicSitePathInput('/')).toEqual({ path: '/', error: '' });
  });

  it('normalizes paths with trailing slash and lowercases segments', () => {
    expect(normalizePublicSitePathInput('/about-us')).toEqual({ path: '/about-us/', error: '' });
    expect(normalizePublicSitePathInput('about-us/')).toEqual({ path: '/about-us/', error: '' });
  });

  it('rejects query strings and hashes', () => {
    expect(normalizePublicSitePathInput('/x?utm=1').error).toMatch(/query/i);
    expect(normalizePublicSitePathInput('/x#y').error).toMatch(/fragment/i);
  });

  it('rejects absolute URLs', () => {
    expect(normalizePublicSitePathInput('https://evil.com/x').error).toBeTruthy();
    expect(normalizePublicSitePathInput('//evil.com/x').error).toBeTruthy();
  });

  it('rejects path traversal', () => {
    expect(normalizePublicSitePathInput('/../x').error).toBeTruthy();
  });

  it('rejects uppercase segments', () => {
    expect(normalizePublicSitePathInput('/About-Us').error).toBeTruthy();
  });
});

describe('normalizePublicSiteSrcValue', () => {
  it('returns kebab-case slugs and empty for invalid', () => {
    expect(normalizePublicSiteSrcValue('  QR_Poster  ')).toBe('qr-poster');
    expect(normalizePublicSiteSrcValue('a--b')).toBe('a-b');
    expect(normalizePublicSiteSrcValue('')).toBe('');
    expect(normalizePublicSiteSrcValue('-')).toBe('');
    expect(normalizePublicSiteSrcValue('Bad_Slug')).toBe('bad-slug');
  });
});

describe('sanitizePublicSiteSrcQueryInput', () => {
  it('lowercases and maps invalid characters to hyphens', () => {
    expect(sanitizePublicSiteSrcQueryInput('Foo Bar')).toBe('foo-bar');
    expect(sanitizePublicSiteSrcQueryInput('a--')).toBe('a-');
  });
});

describe('buildSitePageUrl', () => {
  it('builds home and inner paths with trailing slash (no locale)', () => {
    expect(
      buildSitePageUrl({
        baseUrl: 'https://training.example.com',
        path: '/',
      }),
    ).toBe('https://training.example.com/');

    expect(
      buildSitePageUrl({
        baseUrl: 'https://training.example.com',
        path: '/polls/workshop-food-jun-26/',
      }),
    ).toBe('https://training.example.com/polls/workshop-food-jun-26/');
  });

  it('returns empty for invalid base', () => {
    expect(
      buildSitePageUrl({
        baseUrl: '',
        path: '/',
      }),
    ).toBe('');
  });
});

describe('buildTrainingFormOrPollPageUrl', () => {
  it('builds form and poll URLs with a trailing slash', () => {
    expect(
      buildTrainingFormOrPollPageUrl({
        baseUrl: 'https://training.example.com',
        noun: 'form',
        slug: 'workshop-feedback',
      }),
    ).toBe('https://training.example.com/forms/workshop-feedback/');

    expect(
      buildTrainingFormOrPollPageUrl({
        baseUrl: 'https://training.example.com/',
        noun: 'poll',
        slug: 'workshop-food-jun-26',
      }),
    ).toBe('https://training.example.com/polls/workshop-food-jun-26/');
  });

  it('returns empty for missing base URL or invalid slug', () => {
    expect(
      buildTrainingFormOrPollPageUrl({
        baseUrl: '',
        noun: 'form',
        slug: 'workshop-feedback',
      }),
    ).toBe('');
    expect(
      buildTrainingFormOrPollPageUrl({
        baseUrl: 'https://training.example.com',
        noun: 'poll',
        slug: 'Not Valid',
      }),
    ).toBe('');
    expect(
      buildTrainingFormOrPollPageUrl({
        baseUrl: 'https://training.example.com',
        noun: 'form',
        slug: '',
      }),
    ).toBe('');
  });

  it('appends a contact query on personalised form URLs', () => {
    expect(
      buildTrainingFormOrPollPageUrl({
        baseUrl: 'https://training.example.com',
        noun: 'form',
        slug: 'family-check-in',
        contactId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toBe(
      'https://training.example.com/forms/family-check-in/?contact=11111111-1111-4111-8111-111111111111',
    );
    expect(
      buildTrainingFormOrPollPageUrl({
        baseUrl: 'https://training.example.com',
        noun: 'form',
        slug: 'family-check-in',
        contactId: 'not-a-uuid',
      }),
    ).toBe('');
  });
});

describe('buildLocalizedPublicPageUrl', () => {
  it('builds locale home and inner paths with trailing slash', () => {
    expect(
      buildLocalizedPublicPageUrl({
        baseUrl: 'https://www.example.com',
        locale: 'en',
        path: '/',
      }),
    ).toBe('https://www.example.com/en/');

    expect(
      buildLocalizedPublicPageUrl({
        baseUrl: 'https://www.example.com',
        locale: 'zh-CN',
        path: '/about-us/',
      }),
    ).toBe('https://www.example.com/zh-CN/about-us/');
  });

  it('returns empty for invalid base or locale', () => {
    expect(
      buildLocalizedPublicPageUrl({
        baseUrl: '',
        locale: 'en',
        path: '/',
      }),
    ).toBe('');
    expect(
      buildLocalizedPublicPageUrl({
        baseUrl: 'https://www.example.com',
        locale: 'xx',
        path: '/',
      }),
    ).toBe('');
  });
});
