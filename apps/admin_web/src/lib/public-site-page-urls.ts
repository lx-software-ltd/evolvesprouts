import { normalizePublicSiteLocale, type MyBestAuntieReferralLocale } from '@/lib/referral-links';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Segments are normalized to lowercase before validation. */
const PATH_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SLUG_SEGMENT = PATH_SEGMENT;

/**
 * Sanitizes typing/paste for the `src` field: lowercase, map disallowed characters to `-`,
 * collapse repeated hyphens, trim leading hyphens only (trailing `-` is kept so users can
 * compose multi-part slugs like `a-b`).
 */
export function sanitizePublicSiteSrcQueryInput(raw: string): string {
  const lower = raw.toLowerCase();
  const replaced = lower.replace(/[^a-z0-9-]+/g, '-');
  return replaced.replace(/-+/g, '-').replace(/^-+/, '');
}

/**
 * Normalizes a single `src` query token to the same kebab-case slug rules as public path
 * segments (lowercase letters, numbers, hyphens; no leading/trailing or repeated hyphens).
 * Returns empty when nothing valid remains.
 */
export function normalizePublicSiteSrcValue(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (!lower) {
    return '';
  }
  const replaced = lower.replace(/[^a-z0-9-]+/g, '-');
  const collapsed = replaced.replace(/-+/g, '-');
  const trimmed = collapsed.replace(/^-+|-+$/g, '');
  if (!trimmed || !SLUG_SEGMENT.test(trimmed)) {
    return '';
  }
  return trimmed;
}

export interface NormalizePublicSitePathResult {
  /** Normalized path starting with `/`, ending with `/`, or `/` for site home. */
  path: string;
  error: string;
}

/**
 * Parses a public-site path for QR targets: relative path only, no query or hash,
 * no `..`, segments are lowercase kebab-safe (letters, numbers, hyphens).
 */
export function normalizePublicSitePathInput(raw: string): NormalizePublicSitePathResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { path: '/', error: '' };
  }
  if (trimmed.includes('..') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return { path: '', error: 'Path cannot contain ".." or invalid characters.' };
  }
  if (trimmed.includes('?') || trimmed.includes('#')) {
    return { path: '', error: 'Remove query strings and fragments; use the path only.' };
  }
  let pathPart = trimmed.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pathPart) || pathPart.startsWith('//')) {
    return { path: '', error: 'Enter a path only (not a full URL).' };
  }
  if (!pathPart.startsWith('/')) {
    pathPart = `/${pathPart}`;
  }
  const segments = pathPart.split('/').filter((s) => s.length > 0);
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (segment !== lower) {
      return { path: '', error: 'Use lowercase letters in path segments.' };
    }
    if (!PATH_SEGMENT.test(segment)) {
      return {
        path: '',
        error: 'Each path segment may use letters, numbers, and hyphens only.',
      };
    }
  }
  const joined = segments.length === 0 ? '/' : `/${segments.join('/')}/`;
  return { path: joined, error: '' };
}

export interface BuildLocalizedPublicPageUrlInput {
  baseUrl: string;
  locale: string;
  /** Normalized path from `normalizePublicSitePathInput` (`/` or `/about-us/`). */
  path: string;
}

/**
 * Builds an absolute URL to a locale-prefixed public page. Paths use a trailing slash
 * to match the static-export site (`next.config` trailingSlash).
 */
export interface BuildSitePageUrlInput {
  baseUrl: string;
  /** Normalized path from `normalizePublicSitePathInput` (`/` or `/about-us/`). */
  path: string;
}

/**
 * Builds an absolute URL to a site page without a locale prefix (training site).
 * Paths use a trailing slash to match static export (`trailingSlash: true`).
 */
export function buildSitePageUrl(input: BuildSitePageUrlInput): string {
  const base = trimTrailingSlashes(input.baseUrl.trim());
  if (!base) {
    return '';
  }
  const path = input.path.trim();
  if (!path.startsWith('/')) {
    return '';
  }
  const suffix = path === '/' ? '' : path.replace(/^\/+|\/+$/g, '');
  const pathPart = suffix.length === 0 ? '/' : `/${suffix}/`;
  const url = new URL(pathPart, `${base}/`);
  return url.toString();
}

export interface BuildTrainingFormOrPollPageUrlInput {
  baseUrl: string;
  noun: 'form' | 'poll';
  slug: string;
}

/**
 * Builds an absolute training-site URL for a form (`/forms/{slug}/`) or poll
 * (`/polls/{slug}/`). Returns empty when the base URL or slug is invalid.
 */
export function buildTrainingFormOrPollPageUrl(input: BuildTrainingFormOrPollPageUrlInput): string {
  const slug = input.slug.trim();
  if (!slug) {
    return '';
  }
  const prefix = input.noun === 'form' ? 'forms' : 'polls';
  const normalized = normalizePublicSitePathInput(`/${prefix}/${slug}`);
  if (normalized.error || !normalized.path) {
    return '';
  }
  return buildSitePageUrl({ baseUrl: input.baseUrl, path: normalized.path });
}

export function buildLocalizedPublicPageUrl(input: BuildLocalizedPublicPageUrlInput): string {
  const base = trimTrailingSlashes(input.baseUrl.trim());
  if (!base) {
    return '';
  }
  const locale = normalizePublicSiteLocale(input.locale) as MyBestAuntieReferralLocale | '';
  if (!locale) {
    return '';
  }
  const path = input.path.trim();
  if (!path.startsWith('/')) {
    return '';
  }
  const suffix = path === '/' ? '' : path.replace(/^\/+|\/+$/g, '');
  const pathWithLocale =
    suffix.length === 0 ? `/${locale}/` : `/${locale}/${suffix}/`;
  const url = new URL(pathWithLocale, `${base}/`);
  return url.toString();
}
