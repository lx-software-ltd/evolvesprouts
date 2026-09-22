/**
 * Query contract for opening a specific public booking modal.
 * Admin builds the same URLs via `@shared-public-www/booking-deep-link`.
 */

export const BOOKING_SYSTEM_QUERY_PARAM = 'booking_system';
export const BOOKING_SERVICE_TIER_QUERY_PARAM = 'service_tier';
export const BOOKING_COHORT_QUERY_PARAM = 'cohort';
export const BOOKING_REF_QUERY_PARAM = 'ref';
export const BOOKING_DISCOUNT_QUERY_PARAM = 'discount';

export const MY_BEST_AUNTIE_BOOKING_SYSTEM = 'my-best-auntie-booking';
export const MY_BEST_AUNTIE_BOOKING_HASH = 'my-best-auntie-booking';
/** Public `services.service_key` for the My Best Auntie training course. */
export const MY_BEST_AUNTIE_TRAINING_COURSE_SERVICE_KEY =
  'my-best-auntie-training-course';

/** Age tiers embedded in MBA instance slugs when the parent service tier is unset. */
const MY_BEST_AUNTIE_SLUG_TIERS = ['0-1', '1-3', '3-6'] as const;

const BOOKING_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DISCOUNT_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface BookingDeepLinkQuery {
  bookingSystem: string;
  serviceTier: string;
  cohortSlug: string;
}

export type BookingShareCodeParam = 'ref' | 'discount';

export interface BookingShareCode {
  paramName: BookingShareCodeParam;
  code: string;
}

export interface BuildBookingDeepLinkUrlInput {
  origin: string;
  pathname: string;
  bookingSystem: string;
  serviceTier: string;
  cohortSlug: string;
  hash?: string;
  shareCode?: BookingShareCode | null;
}

function readQueryValue(params: URLSearchParams, name: string): string {
  const key = [...params.keys()].find((candidate) => candidate.toLowerCase() === name);
  if (!key) {
    return '';
  }
  return params.get(key)?.trim() ?? '';
}

/** Lowercase kebab token used for service tiers and instance slugs. Empty when invalid. */
export function normalizeBookingSlug(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value || !BOOKING_SLUG_PATTERN.test(value)) {
    return '';
  }
  return value;
}

function normalizeDiscountCode(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || !DISCOUNT_CODE_PATTERN.test(trimmed)) {
    return '';
  }
  return trimmed.toUpperCase();
}

/**
 * Read `booking_system`, `service_tier`, and `cohort` from a page query string.
 * Tier and cohort are dropped when they are not slug-safe.
 */
export function readBookingDeepLinkFromSearch(search: string): BookingDeepLinkQuery {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  return {
    bookingSystem: readQueryValue(params, BOOKING_SYSTEM_QUERY_PARAM),
    serviceTier: normalizeBookingSlug(readQueryValue(params, BOOKING_SERVICE_TIER_QUERY_PARAM)),
    cohortSlug: normalizeBookingSlug(readQueryValue(params, BOOKING_COHORT_QUERY_PARAM)),
  };
}

/**
 * Code to put on a copied booking link.
 * A successfully applied code wins. Otherwise a prefilled referral code is kept
 * so copying before validation finishes still carries the link the visitor opened.
 */
export function resolveBookingShareCode(input: {
  prefilledCode: string;
  appliedCode: string;
  appliedFromReferral: boolean;
}): BookingShareCode | null {
  const applied = normalizeDiscountCode(input.appliedCode);
  const prefilled = normalizeDiscountCode(input.prefilledCode);
  if (applied) {
    const sameAsPrefill = prefilled !== '' && prefilled === applied;
    return {
      code: applied,
      paramName: input.appliedFromReferral || sameAsPrefill ? 'ref' : 'discount',
    };
  }
  if (prefilled) {
    return { code: prefilled, paramName: 'ref' };
  }
  return null;
}

/**
 * Infer an MBA age tier from an instance slug when the parent service has no tier.
 * Mirrors backend `_derive_training_service_tier_from_instance_slug`.
 */
export function deriveMyBestAuntieServiceTierFromSlug(instanceSlug: string): string {
  const slug = instanceSlug.trim().toLowerCase();
  const prefix = 'my-best-auntie-';
  if (!slug.startsWith(prefix)) {
    return '';
  }
  const rest = slug.slice(prefix.length);
  for (const tier of MY_BEST_AUNTIE_SLUG_TIERS) {
    if (rest.startsWith(`${tier}-`)) {
      return tier;
    }
  }
  return '';
}

export function resolveMyBestAuntieInstanceTier(input: {
  parentServiceKey: string | null;
  parentServiceType: string | null;
  parentServiceTier: string | null;
  slug: string;
}): string {
  if (input.parentServiceType !== 'training_course') {
    return '';
  }
  const serviceKey = (input.parentServiceKey ?? '').trim().toLowerCase();
  if (serviceKey !== MY_BEST_AUNTIE_TRAINING_COURSE_SERVICE_KEY) {
    return '';
  }
  const fromParent = normalizeBookingSlug(input.parentServiceTier);
  if (fromParent) {
    return fromParent;
  }
  return deriveMyBestAuntieServiceTierFromSlug(input.slug);
}

/** Absolute booking URL for the page the visitor is already on. */
export function buildBookingDeepLinkUrl(input: BuildBookingDeepLinkUrlInput): string {
  const origin = input.origin.trim().replace(/\/+$/, '');
  const bookingSystem = input.bookingSystem.trim();
  const serviceTier = normalizeBookingSlug(input.serviceTier);
  const cohortSlug = normalizeBookingSlug(input.cohortSlug);
  if (!origin || !bookingSystem || !serviceTier || !cohortSlug) {
    return '';
  }

  let pathname = input.pathname.trim() || '/';
  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  let url: URL;
  try {
    url = new URL(pathname, `${origin}/`);
  } catch {
    return '';
  }

  url.searchParams.set(BOOKING_SYSTEM_QUERY_PARAM, bookingSystem);
  url.searchParams.set(BOOKING_SERVICE_TIER_QUERY_PARAM, serviceTier);
  url.searchParams.set(BOOKING_COHORT_QUERY_PARAM, cohortSlug);

  const shareCode = input.shareCode ?? null;
  if (shareCode) {
    const code = normalizeDiscountCode(shareCode.code);
    if (code) {
      const paramName =
        shareCode.paramName === 'discount'
          ? BOOKING_DISCOUNT_QUERY_PARAM
          : BOOKING_REF_QUERY_PARAM;
      url.searchParams.set(paramName, code);
    }
  }

  const hash = (input.hash ?? '').replace(/^#/, '').trim();
  if (hash) {
    url.hash = hash;
  }

  return url.toString();
}
