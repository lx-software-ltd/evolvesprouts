import { describe, expect, it } from 'vitest';

import {
  buildBookingDeepLinkUrl,
  deriveMyBestAuntieServiceTierFromSlug,
  readBookingDeepLinkFromSearch,
  resolveBookingShareCode,
  resolveMyBestAuntieInstanceTier,
} from '@/lib/booking-deep-link';

describe('booking deep link', () => {
  it('reads booking system, tier, and cohort and drops unsafe tokens', () => {
    expect(
      readBookingDeepLinkFromSearch(
        '?booking_system=my-best-auntie-booking&service_tier=1-3&cohort=my-best-auntie-1-3-apr-26',
      ),
    ).toEqual({
      bookingSystem: 'my-best-auntie-booking',
      serviceTier: '1-3',
      cohortSlug: 'my-best-auntie-1-3-apr-26',
    });

    expect(
      readBookingDeepLinkFromSearch('?service_tier=../secret&cohort=Has Space'),
    ).toEqual({
      bookingSystem: '',
      serviceTier: '',
      cohortSlug: '',
    });
  });

  it('builds a page URL that carries an applied referral or discount code', () => {
    const url = buildBookingDeepLinkUrl({
      origin: 'https://www.example.com',
      pathname: '/en/services/my-best-auntie-training-course/',
      bookingSystem: 'my-best-auntie-booking',
      serviceTier: '0-1',
      cohortSlug: 'my-best-auntie-0-1-04-26',
      hash: 'my-best-auntie-booking',
      shareCode: resolveBookingShareCode({
        prefilledCode: 'save10',
        appliedCode: '',
        appliedFromReferral: false,
      }),
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://www.example.com');
    expect(parsed.pathname).toBe('/en/services/my-best-auntie-training-course/');
    expect(parsed.searchParams.get('booking_system')).toBe('my-best-auntie-booking');
    expect(parsed.searchParams.get('service_tier')).toBe('0-1');
    expect(parsed.searchParams.get('cohort')).toBe('my-best-auntie-0-1-04-26');
    expect(parsed.searchParams.get('ref')).toBe('SAVE10');
    expect(parsed.hash).toBe('#my-best-auntie-booking');
  });

  it('uses discount when the applied code is not the referral prefill', () => {
    expect(
      resolveBookingShareCode({
        prefilledCode: 'SAVE10',
        appliedCode: 'spring',
        appliedFromReferral: false,
      }),
    ).toEqual({ paramName: 'discount', code: 'SPRING' });
  });

  it('derives an MBA tier from the instance slug when the parent tier is unset', () => {
    expect(deriveMyBestAuntieServiceTierFromSlug('my-best-auntie-3-6-jun-26')).toBe('3-6');
    expect(
      resolveMyBestAuntieInstanceTier({
        parentServiceKey: 'my-best-auntie-training-course',
        parentServiceType: 'training_course',
        parentServiceTier: null,
        slug: 'my-best-auntie-1-3-apr-26',
      }),
    ).toBe('1-3');
    expect(
      resolveMyBestAuntieInstanceTier({
        parentServiceKey: 'family-consultation',
        parentServiceType: 'consultation',
        parentServiceTier: null,
        slug: 'intro-call',
      }),
    ).toBe('');
  });
});
