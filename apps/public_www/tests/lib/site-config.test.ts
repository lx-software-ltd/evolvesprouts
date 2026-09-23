import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildUtmHref,
  buildWhatsappPrefilledHref,
  resolvePublicSiteConfig,
} from '@/lib/site-config';

const ENV_KEYS = [
  'NEXT_PUBLIC_EMAIL',
  'NEXT_PUBLIC_WHATSAPP_URL',
  'NEXT_PUBLIC_INSTAGRAM_URL',
  'NEXT_PUBLIC_LINKEDIN_URL',
  'NEXT_PUBLIC_FOUNDER_NAME',
] as const;
const originalEnvValues = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

afterEach(() => {
  vi.unstubAllEnvs();
  for (const key of ENV_KEYS) {
    const originalValue = originalEnvValues[key];
    if (typeof originalValue === 'string') {
      process.env[key] = originalValue;
    } else {
      delete process.env[key];
    }
  }
});

describe('site-config', () => {
  it('builds a direct wa.me/<phone> href when base URL is a short link and phone is provided', () => {
    const href = buildWhatsappPrefilledHref(
      'https://wa.me/message/ABCDEFG?src=qr',
      "Hi, I'd like to book a free session!",
      '+852 9876 5432',
    );

    const parsed = new URL(href);
    expect(parsed.pathname).toBe('/85298765432');
    expect(parsed.searchParams.get('text')).toBe(
      "Hi, I'd like to book a free session!",
    );
  });

  it('returns the short link URL unchanged when no phone number is provided', () => {
    const href = buildWhatsappPrefilledHref(
      'https://wa.me/message/ABCDEFG?src=qr',
      "Hi, I'd like to book a free session!",
    );

    const parsed = new URL(href);
    expect(parsed.pathname).toBe('/message/ABCDEFG');
    expect(parsed.searchParams.get('src')).toBe('qr');
    expect(parsed.searchParams.has('text')).toBe(false);
  });

  it('appends text param to direct wa.me/<phone> URLs without needing a separate phone number', () => {
    const href = buildWhatsappPrefilledHref(
      'https://wa.me/85298765432',
      'Hello!',
    );

    const parsed = new URL(href);
    expect(parsed.pathname).toBe('/85298765432');
    expect(parsed.searchParams.get('text')).toBe('Hello!');
  });

  it('returns an empty value when the base WhatsApp URL is invalid', () => {
    expect(buildWhatsappPrefilledHref('/contact-us', 'hello')).toBe('');
  });

  it('returns the founder name from NEXT_PUBLIC_FOUNDER_NAME', () => {
    process.env.NEXT_PUBLIC_EMAIL = 'hello@example.com';
    process.env.NEXT_PUBLIC_FOUNDER_NAME = 'Founder Example';

    const siteConfig = resolvePublicSiteConfig();
    expect(siteConfig.founderName).toBe('Founder Example');
  });

  it('returns configured contact email when NEXT_PUBLIC_EMAIL is valid', () => {
    process.env.NEXT_PUBLIC_EMAIL = 'hello@example.com';

    const siteConfig = resolvePublicSiteConfig();
    expect(siteConfig.contactEmail).toBe('hello@example.com');
  });

  it('throws when NEXT_PUBLIC_EMAIL is invalid', () => {
    process.env.NEXT_PUBLIC_EMAIL = 'not-an-email';

    expect(() => resolvePublicSiteConfig()).toThrow(
      'NEXT_PUBLIC_EMAIL must be configured with a valid email address.',
    );
  });

  it('throws when NEXT_PUBLIC_EMAIL is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_EMAIL', '');

    expect(() => resolvePublicSiteConfig()).toThrow(/NEXT_PUBLIC_EMAIL/);
  });

  it('normalizes schemeless social URLs by prepending https', () => {
    process.env.NEXT_PUBLIC_WHATSAPP_URL = 'wa.me/message/ZQHVW4DEORD5A1?src=qr';
    process.env.NEXT_PUBLIC_INSTAGRAM_URL = 'instagram.com/evolvesprouts';
    process.env.NEXT_PUBLIC_LINKEDIN_URL = 'www.linkedin.com/company/evolve-sprouts';

    const siteConfig = resolvePublicSiteConfig();
    expect(siteConfig.whatsappUrl).toBe('https://wa.me/message/ZQHVW4DEORD5A1?src=qr');
    expect(siteConfig.instagramUrl).toBe('https://instagram.com/evolvesprouts');
    expect(siteConfig.linkedinUrl).toBe('https://www.linkedin.com/company/evolve-sprouts');
  });

  it('rejects schemeless values that are not host-like URLs', () => {
    process.env.NEXT_PUBLIC_WHATSAPP_URL = 'not-a-url';

    const siteConfig = resolvePublicSiteConfig();
    expect(siteConfig.whatsappUrl).toBeUndefined();
  });
});

describe('buildUtmHref', () => {
  it('appends UTM parameters to a valid URL', () => {
    const result = buildUtmHref('https://www.evolvesprouts.com/en/contact-us', {
      source: 'instagram',
      medium: 'social',
      campaign: 'organic',
    });

    const parsed = new URL(result);
    expect(parsed.searchParams.get('utm_source')).toBe('instagram');
    expect(parsed.searchParams.get('utm_medium')).toBe('social');
    expect(parsed.searchParams.get('utm_campaign')).toBe('organic');
  });

  it('omits optional UTM parameters when not provided', () => {
    const result = buildUtmHref('https://www.evolvesprouts.com', {
      source: 'whatsapp',
      medium: 'social',
    });

    const parsed = new URL(result);
    expect(parsed.searchParams.get('utm_source')).toBe('whatsapp');
    expect(parsed.searchParams.get('utm_medium')).toBe('social');
    expect(parsed.searchParams.has('utm_campaign')).toBe(false);
    expect(parsed.searchParams.has('utm_content')).toBe(false);
  });

  it('includes utm_content when provided', () => {
    const result = buildUtmHref('https://www.evolvesprouts.com', {
      source: 'instagram',
      medium: 'social',
      campaign: 'spring_2026',
      content: 'bio_link',
    });

    const parsed = new URL(result);
    expect(parsed.searchParams.get('utm_content')).toBe('bio_link');
  });

  it('preserves existing query parameters', () => {
    const result = buildUtmHref('https://www.evolvesprouts.com/en?ref=test', {
      source: 'linkedin',
      medium: 'social',
    });

    const parsed = new URL(result);
    expect(parsed.searchParams.get('ref')).toBe('test');
    expect(parsed.searchParams.get('utm_source')).toBe('linkedin');
  });

  it('returns the input unchanged for non-URL strings', () => {
    expect(buildUtmHref('/contact-us', { source: 'ig', medium: 'social' })).toBe('/contact-us');
    expect(buildUtmHref('#section', { source: 'ig', medium: 'social' })).toBe('#section');
    expect(buildUtmHref('', { source: 'ig', medium: 'social' })).toBe('');
  });
});
