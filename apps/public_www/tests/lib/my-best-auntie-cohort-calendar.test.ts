import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MyBestAuntieEventCohort } from '@/lib/events-data';
import {
  formatYmdInPublicSiteTimeZone,
  getPrimarySessionSortValue,
  isFutureCohort,
} from '@/lib/my-best-auntie-cohort-calendar';
import { resolveMyBestAuntieHeroCohortSummary } from '@/lib/my-best-auntie-cohort-summary';

function cohortFixture(
  overrides: Partial<MyBestAuntieEventCohort> & Pick<MyBestAuntieEventCohort, 'slug' | 'cohort' | 'dates'>,
): MyBestAuntieEventCohort {
  return {
    service_tier: '1-3',
    title: '',
    description: '',
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
    location_tbc: true,
    ...overrides,
  };
}

describe('isFutureCohort', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false when any session is on or before today in site timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T12:00:00Z'));

    const cohort = cohortFixture({
      slug: 'past-first',
      cohort: 'apr-26',
      dates: [
        { part: 1, start_datetime: '2026-04-19T01:00:00Z', end_datetime: '2026-04-19T03:00:00Z' },
        { part: 2, start_datetime: '2026-05-10T01:00:00Z', end_datetime: '2026-05-10T03:00:00Z' },
      ],
    });
    const todayYmd = formatYmdInPublicSiteTimeZone(new Date());
    expect(isFutureCohort(cohort, todayYmd)).toBe(false);
  });

  it('returns true when every session is strictly after today in site timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T12:00:00Z'));

    const cohort = cohortFixture({
      slug: 'all-future',
      cohort: 'apr-26',
      dates: [
        { part: 1, start_datetime: '2026-04-19T01:00:00Z', end_datetime: '2026-04-19T03:00:00Z' },
        { part: 2, start_datetime: '2026-05-10T01:00:00Z', end_datetime: '2026-05-10T03:00:00Z' },
      ],
    });
    const todayYmd = formatYmdInPublicSiteTimeZone(new Date());
    expect(isFutureCohort(cohort, todayYmd)).toBe(true);
  });

  it('returns false when a later session is in the past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00Z'));

    const cohort = cohortFixture({
      slug: 'mixed',
      cohort: 'apr-26',
      dates: [
        { part: 1, start_datetime: '2026-05-17T01:00:00Z', end_datetime: '2026-05-17T03:00:00Z' },
        { part: 2, start_datetime: '2026-05-10T01:00:00Z', end_datetime: '2026-05-10T03:00:00Z' },
      ],
    });
    const todayYmd = formatYmdInPublicSiteTimeZone(new Date());
    expect(isFutureCohort(cohort, todayYmd)).toBe(false);
  });

  it('returns false for empty dates or invalid datetime strings', () => {
    const todayYmd = '2026-04-20';
    expect(
      isFutureCohort(
        cohortFixture({ slug: 'no-dates', cohort: 'apr-26', dates: [] }),
        todayYmd,
      ),
    ).toBe(false);
    expect(
      isFutureCohort(
        cohortFixture({
          slug: 'bad-date',
          cohort: 'apr-26',
          dates: [{ part: 1, start_datetime: 'not-a-date', end_datetime: 'not-a-date' }],
        }),
        todayYmd,
      ),
    ).toBe(false);
  });
});

describe('getPrimarySessionSortValue', () => {
  it('returns Infinity when first session datetime is missing or invalid', () => {
    expect(
      getPrimarySessionSortValue(
        cohortFixture({ slug: 'a', cohort: 'apr-26', dates: [] }),
      ),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(
      getPrimarySessionSortValue(
        cohortFixture({
          slug: 'b',
          cohort: 'apr-26',
          dates: [{ part: 1, start_datetime: '', end_datetime: '' }],
        }),
      ),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('resolveMyBestAuntieHeroCohortSummary', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('excludes cohorts whose first session is already past in site timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T12:00:00Z'));

    const pastFirst = cohortFixture({
      slug: 'past',
      cohort: 'apr-26',
      price: 5000,
      dates: [{ part: 1, start_datetime: '2026-04-19T01:00:00Z', end_datetime: '2026-04-19T03:00:00Z' }],
    });
    const future = cohortFixture({
      slug: 'future',
      cohort: 'may-26',
      price: 9000,
      dates: [{ part: 1, start_datetime: '2026-05-17T01:00:00Z', end_datetime: '2026-05-17T03:00:00Z' }],
    });

    const summary = resolveMyBestAuntieHeroCohortSummary([pastFirst, future], 'en');
    expect(summary.nextCohortLabel).toBe('May, 2026');
    expect(summary.lowestPrice).toBe(9000);
  });
});
