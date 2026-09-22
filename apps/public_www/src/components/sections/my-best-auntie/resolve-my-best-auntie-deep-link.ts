import {
  MY_BEST_AUNTIE_BOOKING_SYSTEM,
  type BookingDeepLinkQuery,
} from '@/lib/booking-deep-link';
import type { MyBestAuntieEventCohort } from '@/lib/events-data';
import { isFutureCohort } from '@/lib/my-best-auntie-cohort-calendar';

export type MyBestAuntieDeepLinkResolution =
  | { status: 'pending' }
  | { status: 'ignore' }
  | { status: 'unscoped' }
  | { status: 'tier'; serviceTier: string; cohortSlug: '' }
  | { status: 'open'; serviceTier: string; cohortSlug: string }
  | { status: 'blocked'; serviceTier: string; cohortSlug: string };

interface ResolveMyBestAuntieDeepLinkInput {
  link: BookingDeepLinkQuery;
  cohorts: MyBestAuntieEventCohort[];
  ageGroupIds: readonly string[];
  todayYmd: string;
  isLoading: boolean;
}

/**
 * Decide how a My Best Auntie booking URL should select a cohort.
 * Sold-out and past targets select the age group, leave the date on the next
 * bookable cohort, and do not auto-open. An unknown slug falls back to the
 * unscoped booking-system open.
 */
export function resolveMyBestAuntieDeepLink(
  input: ResolveMyBestAuntieDeepLinkInput,
): MyBestAuntieDeepLinkResolution {
  if (input.link.bookingSystem !== MY_BEST_AUNTIE_BOOKING_SYSTEM) {
    return { status: 'ignore' };
  }

  if (!input.link.cohortSlug) {
    if (input.link.serviceTier && input.ageGroupIds.includes(input.link.serviceTier)) {
      return { status: 'tier', serviceTier: input.link.serviceTier, cohortSlug: '' };
    }
    return { status: 'unscoped' };
  }

  const match = input.cohorts.find((cohort) => cohort.slug === input.link.cohortSlug);
  if (!match) {
    if (input.isLoading) {
      return { status: 'pending' };
    }
    return { status: 'unscoped' };
  }

  const serviceTier = input.ageGroupIds.includes(match.service_tier) ? match.service_tier : '';
  if (!serviceTier) {
    return { status: 'unscoped' };
  }

  if (!isFutureCohort(match, input.todayYmd) || match.is_fully_booked) {
    return {
      status: 'blocked',
      serviceTier,
      cohortSlug: '',
    };
  }

  return { status: 'open', serviceTier, cohortSlug: match.slug };
}

/**
 * Future cohorts for one age group, capped, with a deep-linked future cohort
 * kept visible when it sits past the cap.
 */
export function cohortsVisibleForAgeGroup(input: {
  sortedCohorts: readonly MyBestAuntieEventCohort[];
  ageGroupId: string;
  todayYmd: string;
  deepLinkedSlug: string;
  limit: number;
  sortCohorts: (
    left: MyBestAuntieEventCohort,
    right: MyBestAuntieEventCohort,
  ) => number;
}): MyBestAuntieEventCohort[] {
  const future = input.sortedCohorts.filter(
    (cohort) =>
      cohort.service_tier === input.ageGroupId && isFutureCohort(cohort, input.todayYmd),
  );
  const capped = future.slice(0, input.limit);
  if (!input.deepLinkedSlug || capped.some((cohort) => cohort.slug === input.deepLinkedSlug)) {
    return capped;
  }

  const extra = future.find((cohort) => cohort.slug === input.deepLinkedSlug);
  if (!extra) {
    return capped;
  }

  return [...capped, extra].sort(input.sortCohorts);
}
