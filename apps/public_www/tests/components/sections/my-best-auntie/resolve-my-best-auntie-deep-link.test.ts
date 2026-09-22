import { describe, expect, it } from 'vitest';

import {
  cohortsVisibleForAgeGroup,
  resolveMyBestAuntieDeepLink,
} from '@/components/sections/my-best-auntie/resolve-my-best-auntie-deep-link';
import type { MyBestAuntieEventCohort } from '@/lib/events-data';

const AGE_GROUPS = ['0-1', '1-3', '3-6'];

function cohort(
  overrides: Partial<MyBestAuntieEventCohort> & Pick<MyBestAuntieEventCohort, 'slug' | 'service_tier'>,
): MyBestAuntieEventCohort {
  return {
    title: overrides.slug,
    description: '',
    cohort: 'may-26',
    spaces_total: 8,
    spaces_left: 4,
    is_fully_booked: false,
    price: 9000,
    currency: 'HKD',
    location: 'physical',
    booking_system: 'my-best-auntie-booking',
    tags: [],
    categories: [],
    location_name: '',
    location_address: '',
    location_url: '',
    location_tbc: false,
    dates: [
      {
        part: 1,
        start_datetime: '2026-05-01T01:00:00Z',
        end_datetime: '2026-05-01T03:00:00Z',
      },
    ],
    ...overrides,
  };
}

describe('resolveMyBestAuntieDeepLink', () => {
  const cohorts = [
    cohort({ slug: 'my-best-auntie-1-3-may-26', service_tier: '1-3' }),
    cohort({
      slug: 'my-best-auntie-1-3-sold',
      service_tier: '1-3',
      is_fully_booked: true,
    }),
    cohort({
      slug: 'my-best-auntie-1-3-past',
      service_tier: '1-3',
      dates: [
        {
          part: 1,
          start_datetime: '2026-03-01T01:00:00Z',
          end_datetime: '2026-03-01T03:00:00Z',
        },
      ],
    }),
  ];

  it('opens a future bookable cohort', () => {
    expect(
      resolveMyBestAuntieDeepLink({
        link: {
          bookingSystem: 'my-best-auntie-booking',
          serviceTier: '1-3',
          cohortSlug: 'my-best-auntie-1-3-may-26',
        },
        cohorts,
        ageGroupIds: AGE_GROUPS,
        todayYmd: '2026-04-01',
        isLoading: false,
      }),
    ).toEqual({
      status: 'open',
      serviceTier: '1-3',
      cohortSlug: 'my-best-auntie-1-3-may-26',
    });
  });

  it('blocks auto-open for a sold-out cohort and leaves the date unselected', () => {
    expect(
      resolveMyBestAuntieDeepLink({
        link: {
          bookingSystem: 'my-best-auntie-booking',
          serviceTier: '1-3',
          cohortSlug: 'my-best-auntie-1-3-sold',
        },
        cohorts,
        ageGroupIds: AGE_GROUPS,
        todayYmd: '2026-04-01',
        isLoading: false,
      }),
    ).toEqual({
      status: 'blocked',
      serviceTier: '1-3',
      cohortSlug: '',
    });
  });

  it('blocks auto-open for a past cohort without selecting that date', () => {
    expect(
      resolveMyBestAuntieDeepLink({
        link: {
          bookingSystem: 'my-best-auntie-booking',
          serviceTier: '1-3',
          cohortSlug: 'my-best-auntie-1-3-past',
        },
        cohorts,
        ageGroupIds: AGE_GROUPS,
        todayYmd: '2026-04-01',
        isLoading: false,
      }),
    ).toEqual({
      status: 'blocked',
      serviceTier: '1-3',
      cohortSlug: '',
    });
  });

  it('falls back to the unscoped booking open when the slug is unknown', () => {
    expect(
      resolveMyBestAuntieDeepLink({
        link: {
          bookingSystem: 'my-best-auntie-booking',
          serviceTier: '',
          cohortSlug: 'missing-cohort',
        },
        cohorts,
        ageGroupIds: AGE_GROUPS,
        todayYmd: '2026-04-01',
        isLoading: false,
      }),
    ).toEqual({ status: 'unscoped' });
  });

  it('keeps a deep-linked future cohort past the visible cap', () => {
    const sorted = ['may', 'jun', 'jul', 'aug'].map((month, index) =>
      cohort({
        slug: `my-best-auntie-0-1-${month}`,
        service_tier: '0-1',
        dates: [
          {
            part: 1,
            start_datetime: `2026-0${index + 5}-01T01:00:00Z`,
            end_datetime: `2026-0${index + 5}-01T03:00:00Z`,
          },
        ],
      }),
    );

    const visible = cohortsVisibleForAgeGroup({
      sortedCohorts: sorted,
      ageGroupId: '0-1',
      todayYmd: '2026-04-01',
      deepLinkedSlug: 'my-best-auntie-0-1-aug',
      limit: 3,
      sortCohorts: (left, right) =>
        Date.parse(left.dates[0]?.start_datetime ?? '') -
        Date.parse(right.dates[0]?.start_datetime ?? ''),
    });

    expect(visible.map((entry) => entry.slug)).toEqual([
      'my-best-auntie-0-1-may',
      'my-best-auntie-0-1-jun',
      'my-best-auntie-0-1-jul',
      'my-best-auntie-0-1-aug',
    ]);
  });
});
