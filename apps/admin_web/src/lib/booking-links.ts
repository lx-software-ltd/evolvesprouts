import {
  MY_BEST_AUNTIE_BOOKING_HASH,
  MY_BEST_AUNTIE_BOOKING_SYSTEM,
  MY_BEST_AUNTIE_TRAINING_COURSE_SERVICE_KEY,
  buildBookingDeepLinkUrl,
  normalizeBookingSlug,
  resolveMyBestAuntieInstanceTier,
} from '@shared-public-www/booking-deep-link';

import { buildLocalizedPublicPageUrl } from '@/lib/public-site-page-urls';
import { normalizePublicSiteLocale } from '@/lib/referral-links';

export interface BuildPublicBookingDeepLinkUrlInput {
  baseUrl: string;
  locale: string;
  serviceKey: string;
  serviceTier: string;
  cohortSlug: string;
}

/**
 * Locale-prefixed public course URL that opens the confirm-and-pay modal
 * on a specific age tier and cohort.
 */
export function buildPublicBookingDeepLinkUrl(input: BuildPublicBookingDeepLinkUrlInput): string {
  const locale = normalizePublicSiteLocale(input.locale);
  const serviceKey = normalizeBookingSlug(input.serviceKey);
  if (!locale || !serviceKey) {
    return '';
  }

  const pageUrl = buildLocalizedPublicPageUrl({
    baseUrl: input.baseUrl,
    locale,
    path: `/services/${serviceKey}/`,
  });
  if (!pageUrl) {
    return '';
  }

  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return '';
  }

  return buildBookingDeepLinkUrl({
    origin: parsed.origin,
    pathname: parsed.pathname,
    bookingSystem: MY_BEST_AUNTIE_BOOKING_SYSTEM,
    serviceTier: input.serviceTier,
    cohortSlug: input.cohortSlug,
    hash: MY_BEST_AUNTIE_BOOKING_HASH,
  });
}

export function buildMyBestAuntieInstanceBookingLink(input: {
  baseUrl: string;
  locale: string;
  parentServiceKey: string | null;
  parentServiceType: string | null;
  parentServiceTier: string | null;
  slug: string;
}): string {
  const serviceTier = resolveMyBestAuntieInstanceTier(input);
  const cohortSlug = normalizeBookingSlug(input.slug);
  if (!serviceTier || !cohortSlug) {
    return '';
  }
  return buildPublicBookingDeepLinkUrl({
    baseUrl: input.baseUrl,
    locale: input.locale,
    serviceKey: MY_BEST_AUNTIE_TRAINING_COURSE_SERVICE_KEY,
    serviceTier,
    cohortSlug,
  });
}
