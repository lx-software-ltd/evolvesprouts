import { describe, expect, it } from 'vitest';

import { buildMyBestAuntieInstanceBookingLink } from '@/lib/booking-links';

describe('buildMyBestAuntieInstanceBookingLink', () => {
  it('builds a locale-prefixed confirm-and-pay URL for an MBA training instance', () => {
    const url = buildMyBestAuntieInstanceBookingLink({
      baseUrl: 'https://www.example.com',
      locale: 'zh-HK',
      parentServiceKey: 'my-best-auntie-training-course',
      parentServiceType: 'training_course',
      parentServiceTier: '0-1',
      slug: 'my-best-auntie-0-1-04-26',
    });

    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/zh-HK/services/my-best-auntie-training-course/');
    expect(parsed.searchParams.get('booking_system')).toBe('my-best-auntie-booking');
    expect(parsed.searchParams.get('service_tier')).toBe('0-1');
    expect(parsed.searchParams.get('cohort')).toBe('my-best-auntie-0-1-04-26');
    expect(parsed.hash).toBe('#my-best-auntie-booking');
  });

  it('returns an empty string for a non-MBA instance', () => {
    expect(
      buildMyBestAuntieInstanceBookingLink({
        baseUrl: 'https://www.example.com',
        locale: 'en',
        parentServiceKey: 'family-consultation',
        parentServiceType: 'consultation',
        parentServiceTier: null,
        slug: 'intro',
      }),
    ).toBe('');
  });
});
