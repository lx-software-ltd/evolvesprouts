import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import enContent from '@/content/en.json';
import zhHKContent from '@/content/zh-HK.json';
import easterWorkshopLandingContent from '@/content/landing-pages/easter-2026-montessori-play-coaching-workshop.json';
import missingPieceLandingContent from '@/content/landing-pages/may-2026-the-missing-piece.json';
import { publicCalendarFixture } from '../fixtures/public-calendar';
import {
  createCrmApiClient,
  clearCrmApiGetCacheForTests,
} from '@/lib/crm-api-client';
import { formatCohortValue } from '@/lib/format';
import * as internalErrorReporting from '@/lib/internal-error-reporting';
import {
  PUBLIC_SITE_IANA_TIMEZONE,
  formatHeroFullDateLine,
} from '@/lib/site-datetime';
import {
  MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY,
  buildEventsApiPath,
  fetchEventsPayload,
  fetchLandingPageCalendarPayload,
  findLandingPageEventInPayload,
  getLandingPageBookingEventContentFromPayload,
  getLandingPageHeroEventContentFromPayload,
  getLandingPageStructuredDataContentFromPayload,
  normalizeEvents,
  normalizeMyBestAuntieCohortsFromPayload,
  resolveEventsApiUrl,
  sortPastEvents,
  sortEvents,
} from '@/lib/events-data';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.evolvesprouts.com/www');
});

function resolveDateTimeLocale(locale: 'en' | 'zh-CN' | 'zh-HK'): string {
  if (locale === 'en') {
    return 'en-GB';
  }

  return locale;
}

function formatExpectedDateLabel(
  isoDateTime: string,
  locale: 'en' | 'zh-CN' | 'zh-HK',
): string {
  return new Intl.DateTimeFormat(resolveDateTimeLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: PUBLIC_SITE_IANA_TIMEZONE,
  }).format(new Date(isoDateTime));
}

function formatExpectedTimeLabel(
  startIsoDateTime: string,
  endIsoDateTime: string,
  locale: 'en' | 'zh-CN' | 'zh-HK',
): string {
  const startDate = new Date(startIsoDateTime);
  const endDate = new Date(endIsoDateTime);
  const timeFormatter =
    locale === 'en'
      ? new Intl.DateTimeFormat(resolveDateTimeLocale(locale), {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: PUBLIC_SITE_IANA_TIMEZONE,
        })
      : new Intl.DateTimeFormat(resolveDateTimeLocale(locale), {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: PUBLIC_SITE_IANA_TIMEZONE,
        });
  const timeZoneLabel = new Intl.DateTimeFormat(resolveDateTimeLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PUBLIC_SITE_IANA_TIMEZONE,
    timeZoneName: 'short',
  })
    .formatToParts(startDate)
    .find((part) => part.type === 'timeZoneName')
    ?.value
    .trim();
  const timeRange = `${timeFormatter.format(startDate)} - ${timeFormatter.format(endDate)}`;

  return timeZoneLabel ? `${timeRange} ${timeZoneLabel}` : timeRange;
}

function formatExpectedLandingPageEyebrowDate(
  isoDateTime: string,
  locale: 'en' | 'zh-CN' | 'zh-HK',
): string | undefined {
  return formatHeroFullDateLine(isoDateTime, locale);
}

describe('events-data', () => {
  it('resolves CRM events endpoint from base URL', () => {
    expect(resolveEventsApiUrl('https://api.evolvesprouts.com/www')).toBe(
      'https://api.evolvesprouts.com/www/v1/calendar/public',
    );
    expect(resolveEventsApiUrl('https://api.evolvesprouts.com/www/')).toBe(
      'https://api.evolvesprouts.com/www/v1/calendar/public',
    );
    expect(resolveEventsApiUrl('api.evolvesprouts.com/www/')).toBe('');
    expect(resolveEventsApiUrl('   ')).toBe('');
  });

  it('normalizes calendar events payload from CRM API', () => {
    const payload = {
      status: 'success',
      data: [
        {
          title: 'TEST Creative Writing Masterclass',
          description:
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
          tags: {
            '7': 'Fully Booked',
            '265': 'TEST Beginner Friendly',
            '268': 'TEST In-Person',
            '269': 'TEST Limited Seats',
          },
          categories: {
            '264': 'TEST Creative Arts',
          },
          partners: ['partner-one'],
          location: 'physical',
          address:
            'Room 1, 1/F, Example Hall, 1 Sample Street, Hong Kong',
          address_url:
            'https://www.google.com/maps/search/?api=1&query=Room+1%2C+1%2FF%2C+Example+Hall%2C+1+Sample+Street%2C+Hong+Kong',
          dates: [
            {
              start_datetime: '2025-12-05T10:00:00Z',
              end_datetime: '2025-12-05T13:00:00Z',
            },
          ],
          is_fully_booked: true,
          price: 9000,
          currency: 'HKD',
        },
        {
          title: 'TEST Data Science Intensive Touch',
          description:
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.',
          tags: {
            '266': 'TEST Advanced Level',
            '268': 'TEST In-Person',
          },
          categories: {
            '261': 'TEST Workshop Category',
          },
          location: 'virtual',
          address: 'Virtual Meeting',
          address_url: 'https://meet.example.com/data-science',
          dates: [
            {
              start_datetime: '2025-12-15T09:00:00Z',
              end_datetime: '2025-12-15T12:00:00Z',
            },
          ],
          is_fully_booked: false,
          price: 0,
          currency: 'HKD',
        },
      ],
    };

    const events = normalizeEvents(payload, enContent.events);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: 'TEST Creative Writing Masterclass',
      status: 'fully_booked',
      dateLabel: formatExpectedDateLabel('2025-12-05T10:00:00Z', 'en'),
      timeLabel: formatExpectedTimeLabel('2025-12-05T10:00:00Z', '2025-12-05T13:00:00Z', 'en'),
      locationName:
        'Room 1, 1/F, Example Hall, 1 Sample Street, Hong Kong',
      directionHref:
        'https://www.google.com/maps/search/?api=1&query=Room+1%2C+1%2FF%2C+Example+Hall%2C+1+Sample+Street%2C+Hong+Kong',
      ctaHref: '',
      ctaLabel: enContent.events.card.ctaLabel,
      costLabel: 'HK$9,000',
      isFreeCost: false,
      timestamp: Date.parse('2025-12-05T10:00:00Z'),
    });
    expect(events[0]?.tags).toEqual([
      'Fully Booked',
      'TEST Beginner Friendly',
      'TEST In-Person',
      'TEST Limited Seats',
      'TEST Creative Arts',
    ]);
    expect(events[0]?.partners).toEqual(['partner-one']);

    expect(events[1]).toMatchObject({
      title: 'TEST Data Science Intensive Touch',
      status: 'open',
      dateLabel: formatExpectedDateLabel('2025-12-15T09:00:00Z', 'en'),
      timeLabel: formatExpectedTimeLabel('2025-12-15T09:00:00Z', '2025-12-15T12:00:00Z', 'en'),
      locationName: 'Virtual Meeting',
      ctaHref: '',
      ctaLabel: enContent.events.card.ctaLabel,
      costLabel: enContent.events.card.freeLabel,
      isFreeCost: true,
      timestamp: Date.parse('2025-12-15T09:00:00Z'),
    });
    expect(events[1]?.directionHref).toBeUndefined();
    expect(events[1]?.tags).toEqual([
      'TEST Advanced Level',
      'TEST In-Person',
      'TEST Workshop Category',
    ]);
    expect(events[1]?.partners).toBeUndefined();
  });

  it('uses external_url as the event card CTA when available', () => {
    const payload = {
      data: [
        {
          title: 'External CTA event',
          location: 'physical',
          address: 'Example Hall, Hong Kong',
          address_url: 'https://maps.google.com/?q=Example+Hall+Hong+Kong',
          external_url: 'https://booking.example.com/events/example-hall-session',
          dates: [
            {
              start_datetime: '2026-01-20T09:00:00Z',
              end_datetime: '2026-01-20T11:00:00Z',
            },
          ],
          is_fully_booked: false,
        },
      ],
    };

    const events = normalizeEvents(payload, enContent.events);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      directionHref: 'https://maps.google.com/?q=Example+Hall+Hong+Kong',
      ctaHref: 'https://booking.example.com/events/example-hall-session',
    });
  });

  it('uses my-best-auntie booking system CTA route when booking_system is set', () => {
    const payload = {
      data: [
        {
          slug: 'my-best-auntie-booking-event-1',
          title: 'My Best Auntie booking event',
          booking_system: 'my-best-auntie-booking',
          service_tier: '1-3',
          cohort: '04-26',
          spaces_total: 8,
          spaces_left: 5,
          price: 9000,
          currency: 'HKD',
          location: 'physical',
          address: 'Example Hall, Hong Kong',
          address_url: 'https://maps.google.com/?q=Example+Hall+Hong+Kong',
          external_url: 'https://booking.example.com/events/should-not-be-used',
          dates: [
            {
              part: 1,
              start_datetime: '2026-01-22T09:00:00Z',
              end_datetime: '2026-01-22T11:00:00Z',
            },
          ],
          is_fully_booked: false,
        },
      ],
    };

    const events = normalizeEvents(payload, enContent.events, 'zh-HK');

    expect(events).toHaveLength(1);
    expect(events[0]?.ctaHref).toBe(
      '/zh-HK/services/my-best-auntie-training-course?booking_system=my-best-auntie-booking#my-best-auntie-booking',
    );
    expect(events[0]?.bookingModalPayload?.variant).toBe('my-best-auntie');
    if (events[0]?.bookingModalPayload?.variant === 'my-best-auntie') {
      expect(events[0].bookingModalPayload.selectedCohort.slug).toBe(
        'my-best-auntie-booking-event-1',
      );
      expect(events[0].bookingModalPayload.selectedCohort.dates[0]?.part).toBe(1);
    }
  });

  it('resolves my-best-auntie cohort slug from slug field', () => {
    const payload = {
      data: [
        {
          slug: 'mba-cohort-apr-26',
          title: 'My Best Auntie 1-3',
          booking_system: 'my-best-auntie-booking',
          service_tier: '1-3',
          cohort: 'apr-26',
          spaces_total: 8,
          spaces_left: 8,
          price: 9000,
          currency: 'HKD',
          location: 'physical',
          location_name: 'Evolve Sprouts',
          location_address: '507, 5/F',
          location_url: 'https://www.google.com/maps/dir/?api=1&destination=22.286209%2C114.148303',
          dates: [
            {
              part: 1,
              start_datetime: '2026-04-18T09:00:00+00:00',
              end_datetime: '2026-04-18T11:00:00+00:00',
            },
          ],
          is_fully_booked: false,
        },
      ],
    };

    const events = normalizeEvents(payload, enContent.events, 'en');

    expect(events).toHaveLength(1);
    expect(events[0]?.bookingModalPayload?.variant).toBe('my-best-auntie');
    if (events[0]?.bookingModalPayload?.variant === 'my-best-auntie') {
      expect(events[0].bookingModalPayload.selectedCohort.slug).toBe('mba-cohort-apr-26');
    }
  });

  it('normalizes event-booking records with in-page modal payload', () => {
    const payload = {
      data: [
        {
          id: 'event-booking-demo',
          slug: 'event-booking-demo',
          service_key: 'event-booking-demo',
          title: 'Event booking demo',
          description: 'Simple booking modal flow',
          booking_system: 'event-booking',
          address: 'Example Hall, Hong Kong',
          address_url: 'https://maps.google.com/?q=Example+Hall+Hong+Kong',
          dates: [
            {
              id: 'session-1',
              start_datetime: '2026-04-06T02:00:00Z',
              end_datetime: '2026-04-06T03:00:00Z',
            },
          ],
          price: 350,
          currency: 'HKD',
          is_fully_booked: false,
        },
      ],
    };

    const events = normalizeEvents(payload, enContent.events, 'en');

    expect(events).toHaveLength(1);
    expect(events[0]?.ctaHref).toBe('/en/events?booking_system=event-booking');
    expect(events[0]?.bookingModalPayload).toMatchObject({
      variant: 'event',
      bookingSystem: 'event-booking',
      serviceKey: 'event-booking-demo',
      instanceSlug: 'event-booking-demo',
      title: 'Event booking demo',
      subtitle: 'Simple booking modal flow',
      originalAmount: 350,
      locationAddress: 'Example Hall, Hong Kong',
      directionHref: 'https://maps.google.com/?q=Example+Hall+Hong+Kong',
      selectedDateStartTime: '2026-04-06T02:00:00Z',
    });
  });

  it('merges landing page bookingTopicsField onto event-booking modal payload when slug matches', () => {
    const payload = {
      data: [
        {
          id: 'easter-workshop',
          title: 'Easter Workshop',
          description: 'Workshop description',
          booking_system: 'event-booking',
          slug: 'easter-2026-montessori-play-coaching-workshop',
          location_name: 'Venue',
          location_address: '123 Road',
          location_url: 'https://maps.google.com/?q=test',
          dates: [
            {
              id: 'session-1',
              start_datetime: '2026-04-06T02:00:00Z',
              end_datetime: '2026-04-06T03:00:00Z',
            },
          ],
          price: 350,
          currency: 'HKD',
          is_fully_booked: false,
        },
      ],
    };

    const eventsEn = normalizeEvents(payload, enContent.events, 'en');
    expect(eventsEn[0]?.bookingModalPayload?.variant).toBe('event');
    expect(eventsEn[0]?.bookingModalPayload).toMatchObject({
      topicsFieldConfig: easterWorkshopLandingContent.en.cta.bookingTopicsField,
    });

    const eventsZh = normalizeEvents(payload, enContent.events, 'zh-CN');
    expect(eventsZh[0]?.bookingModalPayload).toMatchObject({
      topicsFieldConfig: easterWorkshopLandingContent['zh-CN'].cta.bookingTopicsField,
    });
  });

  it('does not use alternate CTA candidate keys without external_url', () => {
    const payload = {
      data: [
        {
          title: 'Alternate CTA fields event',
          ctaUrl: 'https://booking.example.com/from-cta-url',
          bookingUrl: 'https://booking.example.com/from-booking-url',
          href: 'https://booking.example.com/from-href',
          dates: [
            {
              start_datetime: '2026-01-21T09:00:00Z',
              end_datetime: '2026-01-21T11:00:00Z',
            },
          ],
          is_fully_booked: false,
        },
      ],
    };

    const events = normalizeEvents(payload, enContent.events);

    expect(events).toHaveLength(1);
    expect(events[0]?.ctaHref).toBe('');
  });

  it('formats event dates and times using locale-aware labels', () => {
    const payload = {
      data: [
        {
          title: 'Locale-aware event',
          dates: [
            {
              start_datetime: '2025-12-05T10:00:00Z',
              end_datetime: '2025-12-05T13:00:00Z',
            },
          ],
          price: 0,
        },
      ],
    };

    const events = normalizeEvents(payload, zhHKContent.events, 'zh-HK');
    expect(events[0]).toMatchObject({
      dateLabel: formatExpectedDateLabel('2025-12-05T10:00:00Z', 'zh-HK'),
      timeLabel: formatExpectedTimeLabel('2025-12-05T10:00:00Z', '2025-12-05T13:00:00Z', 'zh-HK'),
      costLabel: zhHKContent.events.card.freeLabel,
      isFreeCost: true,
    });
  });

  it('normalizes snake_case location labels for display', () => {
    const payload = {
      data: [
        {
          title: 'Location formatting event',
          location: 'in_person',
          dates: [
            {
              start_datetime: '2025-12-05T10:00:00Z',
            },
          ],
        },
      ],
    };

    const events = normalizeEvents(payload, enContent.events);
    expect(events[0]).toMatchObject({
      locationName: enContent.events.card.emptyLocationLabel,
      isLocationTbc: true,
    });
    expect(events[0]?.directionHref).toBeUndefined();
  });

  it('treats an empty physical venue as to be confirmed even when location_tbc is false', () => {
    const payload = {
      data: [
        {
          title: 'Empty venue event',
          location: 'physical',
          location_tbc: false,
          location_name: null,
          location_address: null,
          location_url: '',
          dates: [
            {
              start_datetime: '2026-10-10T01:00:00Z',
            },
          ],
        },
      ],
    };

    const events = normalizeEvents(payload, enContent.events);
    expect(events[0]).toMatchObject({
      locationName: enContent.common.locationToBeConfirmedLabel,
      isLocationTbc: true,
    });
    expect(events[0]?.locationAddress).toBeUndefined();
    expect(events[0]?.directionHref).toBeUndefined();
  });

  it('treats location_tbc as to be confirmed even when a leftover venue name is present', () => {
    const payload = {
      data: [
        {
          title: 'TBC venue event',
          location: 'physical',
          location_tbc: true,
          location_name: 'Evolve Sprouts',
          location_address: '507, 5/F',
          location_url: 'https://www.google.com/maps/dir/?api=1&destination=22.3%2C114.1',
          dates: [
            {
              start_datetime: '2026-10-10T01:00:00Z',
            },
          ],
        },
      ],
    };

    const events = normalizeEvents(payload, enContent.events);
    expect(events[0]).toMatchObject({
      locationName: enContent.common.locationToBeConfirmedLabel,
      isLocationTbc: true,
    });
    expect(events[0]?.locationAddress).toBeUndefined();
    expect(events[0]?.directionHref).toBeUndefined();
  });

  it('normalizes MBA cohorts with location_tbc and no venue as to be confirmed', () => {
    const payload = {
      events: [
        {
          slug: 'my-best-auntie-1-3-oct-26',
          service_type: 'training_course',
          booking_system: 'my-best-auntie-booking',
          service_tier: '1-3',
          cohort: 'oct-26',
          title: 'My Best Auntie 1-3 - Oct 26',
          location: 'physical',
          location_tbc: true,
          location_name: null,
          location_address: null,
          location_url: '',
          dates: [
            {
              part: 1,
              start_datetime: '2026-10-10T01:00:00Z',
              end_datetime: '2026-10-10T03:00:00Z',
            },
          ],
          price: 9000,
          currency: 'HKD',
        },
      ],
    };

    const cohorts = normalizeMyBestAuntieCohortsFromPayload(payload);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]).toMatchObject({
      slug: 'my-best-auntie-1-3-oct-26',
      location_tbc: true,
      location_name: '',
      location_address: '',
      location_url: '',
    });
  });

  it('preserves hyphenated numeric range tags from events payload', () => {
    const payload = {
      data: [
        {
          title: 'Range tag event',
          tags: ['1-4', 'Parent + Child'],
          categories: ['Workshop'],
          dates: [
            {
              start_datetime: '2026-04-06T02:00:00Z',
              end_datetime: '2026-04-06T03:00:00Z',
            },
          ],
        },
      ],
    };

    const events = normalizeEvents(payload, enContent.events);
    expect(events).toHaveLength(1);
    expect(events[0]?.tags).toEqual(['1-4', 'Parent + Child', 'Workshop']);
  });

  it('public calendar fixture rows include service_key (API wire contract)', () => {
    for (const row of publicCalendarFixture.data) {
      expect(row).toHaveProperty('service_key');
    }
  });

  it('resolves event booking modal serviceKey from calendar service_key and empty when omitted', () => {
    const withKey = getLandingPageBookingEventContentFromPayload(
      {
        status: 'success',
        data: [
          {
            title: 'Keyed event',
            service_type: 'event',
            service_key: 'my-key',
            slug: 'keyed-event-slug',
            booking_system: 'event-booking',
            dates: [
              {
                start_datetime: '2026-08-01T10:00:00Z',
                end_datetime: '2026-08-01T11:00:00Z',
                part: 1,
              },
            ],
            location: 'virtual',
          },
        ],
      },
      'keyed-event-slug',
      'en',
    );
    expect(withKey?.bookingPayload?.variant).toBe('event');
    expect(withKey?.bookingPayload?.serviceKey).toBe('my-key');

    const withoutKey = getLandingPageBookingEventContentFromPayload(
      {
        status: 'success',
        data: [
          {
            title: 'No key event',
            service_type: 'event',
            slug: 'no-key-event-slug',
            booking_system: 'event-booking',
            dates: [
              {
                start_datetime: '2026-08-02T10:00:00Z',
                end_datetime: '2026-08-02T11:00:00Z',
                part: 1,
              },
            ],
            location: 'virtual',
          },
        ],
      },
      'no-key-event-slug',
      'en',
    );
    expect(withoutKey?.bookingPayload?.serviceKey).toBe('');
  });

  it('resolves landing page hero content from calendar payload using slug', () => {
    const heroEventContent = getLandingPageHeroEventContentFromPayload(
      publicCalendarFixture,
      'easter-2026-montessori-play-coaching-workshop',
    );

    expect(heroEventContent).not.toBeNull();
    expect(heroEventContent).toMatchObject({
      title: 'Easter 2026 Montessori Play Coaching Workshop',
      startDateTime: '2026-04-06T02:00:00Z',
      endDateTime: '2026-04-06T03:00:00Z',
      locationLabel: 'Hong Kong',
      partners: ['happy-baton', 'baumhaus'],
      categoryChips: ['Workshop'],
    });
  });

  it('title-cases landing page hero category chips and splits hyphenated CRM categories', () => {
    const heroEventContent = getLandingPageHeroEventContentFromPayload(
      {
        status: 'success',
        data: [
          {
            slug: 'test-landing-category-chip-labels',
            title: 'Test Event',
            categories: ['workshop', 'training-course', '1-4'],
            dates: [
              {
                start_datetime: '2026-01-01T12:00:00Z',
                end_datetime: '2026-01-01T13:00:00Z',
              },
            ],
          },
        ],
      },
      'test-landing-category-chip-labels',
    );

    expect(heroEventContent).not.toBeNull();
    expect(heroEventContent?.categoryChips).toEqual([
      'Workshop',
      'Training Course',
      '1-4',
    ]);
  });

  it('resolves landing page booking payload from calendar payload using slug', () => {
    const bookingEventContent = getLandingPageBookingEventContentFromPayload(
      publicCalendarFixture,
      'easter-2026-montessori-play-coaching-workshop',
      'en',
    );

    expect(bookingEventContent).not.toBeNull();
    expect(bookingEventContent).toMatchObject({
      status: 'open',
      spacesLeft: 5,
      eyebrowDateLabel: formatExpectedLandingPageEyebrowDate('2026-04-06T02:00:00Z', 'en'),
      ctaPriceLabel: 'HK$350',
      bookingPayload: {
        variant: 'event',
        serviceKey: 'easter-workshops',
        instanceSlug: 'easter-2026-montessori-play-coaching-workshop',
        title: 'Easter 2026 Montessori Play Coaching Workshop',
        locationName: 'Baumhaus',
        locationAddress: "1/F, Example Tower, 1 Sample Street, Hong Kong",
        selectedDateLabel: '06 Apr 2026',
        selectedDateStartTime: '2026-04-06T02:00:00Z',
      },
    });
  });

  it('resolves landing page structured data content from calendar payload using slug', () => {
    const structuredDataContent = getLandingPageStructuredDataContentFromPayload(
      publicCalendarFixture,
      'easter-2026-montessori-play-coaching-workshop',
    );

    expect(structuredDataContent).not.toBeNull();
    expect(structuredDataContent).toMatchObject({
      eventName: 'Easter 2026 Montessori Play Coaching Workshop',
      description:
        'A practical Montessori-inspired play coaching workshop for children ages 1-4, with parent and child participation (helpers warmly welcome).',
      startDate: '2026-04-06T02:00:00.000Z',
      endDate: '2026-04-06T03:00:00.000Z',
      locationName: 'Baumhaus',
      locationAddress: "1/F, Example Tower, 1 Sample Street, Hong Kong",
      offerPrice: '350',
      offerCurrency: 'HKD',
      offerAvailability: 'InStock',
    });
  });

  it('resolves May 2026 The Missing Piece landing page content from calendar payload', () => {
    const heroEventContent = getLandingPageHeroEventContentFromPayload(
      publicCalendarFixture,
      'may-2026-the-missing-piece',
    );

    expect(heroEventContent).not.toBeNull();
    expect(heroEventContent).toMatchObject({
      title: 'The Missing Piece',
      startDateTime: '2026-05-16T01:00:00Z',
      endDateTime: '2026-05-16T02:00:00Z',
      locationLabel: 'Hong Kong',
      partners: ['little-hk'],
      categoryChips: ['Workshop'],
    });

    const bookingEventContent = getLandingPageBookingEventContentFromPayload(
      publicCalendarFixture,
      'may-2026-the-missing-piece',
      'en',
    );

    expect(bookingEventContent).not.toBeNull();
    expect(bookingEventContent).toMatchObject({
      status: 'open',
      spacesLeft: 8,
      eyebrowDateLabel: formatExpectedLandingPageEyebrowDate('2026-05-16T01:00:00Z', 'en'),
      ctaPriceLabel: 'HK$150',
      bookingPayload: {
        variant: 'event',
        serviceKey: 'missing-piece-series',
        instanceSlug: 'may-2026-the-missing-piece',
        title: 'The Missing Piece',
        locationName: 'Acorn Playhouse',
        locationAddress: '1/F, 1 Sample Street, Hong Kong',
        selectedDateLabel: '16 May 2026',
        selectedDateStartTime: '2026-05-16T01:00:00Z',
      },
    });
    expect(bookingEventContent?.bookingPayload).toMatchObject({
      topicsFieldConfig: missingPieceLandingContent.en.cta.bookingTopicsField,
    });

    const structuredDataContent = getLandingPageStructuredDataContentFromPayload(
      publicCalendarFixture,
      'may-2026-the-missing-piece',
    );

    expect(structuredDataContent).not.toBeNull();
    expect(structuredDataContent).toMatchObject({
      eventName: 'The Missing Piece',
      description:
        'A hands-on workshop for families with children aged 0–2: the right toys, simple play-space tweaks, and practical tools your helper can use right away. Hosted with Little HK at Acorn Playhouse.',
      startDate: '2026-05-16T01:00:00.000Z',
      endDate: '2026-05-16T02:00:00.000Z',
      locationName: 'Acorn Playhouse',
      locationAddress: '1/F, 1 Sample Street, Hong Kong',
      offerPrice: '150',
      offerCurrency: 'HKD',
      offerAvailability: 'InStock',
    });
  });

  it('returns null when landing page slug has no matching event', () => {
    expect(
      getLandingPageHeroEventContentFromPayload(publicCalendarFixture, 'unknown-landing-page-slug'),
    ).toBeNull();
    expect(
      getLandingPageBookingEventContentFromPayload(
        publicCalendarFixture,
        'unknown-landing-page-slug',
      ),
    ).toBeNull();
    expect(
      getLandingPageStructuredDataContentFromPayload(
        publicCalendarFixture,
        'unknown-landing-page-slug',
      ),
    ).toBeNull();
  });

  it('finds landing page event record in payload', () => {
    const record = findLandingPageEventInPayload(
      publicCalendarFixture,
      'easter-2026-montessori-play-coaching-workshop',
    );
    expect(record).not.toBeNull();
    expect((record as { title?: string }).title).toBe(
      'Easter 2026 Montessori Play Coaching Workshop',
    );
  });

  it('normalizes My Best Auntie training_course cohorts with alpha cohort labels', () => {
    const cohorts = normalizeMyBestAuntieCohortsFromPayload(publicCalendarFixture);
    expect(cohorts).toHaveLength(2);
    const apr = cohorts.find((c) => c.cohort === 'apr-26');
    expect(apr).toBeDefined();
    expect(apr?.service_tier).toBe('1-3');
    expect(apr?.slug).toBe('my-best-auntie-1-3-apr-26');
    expect(apr?.dates).toHaveLength(3);
    expect(apr?.dates[0]?.part).toBe(1);
    expect(formatCohortValue(apr!.cohort, 'en')).toBe('Apr, 2026');
  });

  it('builds filtered calendar API path with service_key and service_type', () => {
    expect(
      buildEventsApiPath({
        serviceKey: MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY,
        serviceType: 'training_course',
      }),
    ).toBe(
      `/v1/calendar/public?service_type=training_course&service_key=${MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY}`,
    );
  });

  it('returns upcoming events in chronological order and limits past events to most recent 5', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:00:00Z'));

    const sourceEvents = [
      {
        id: 'future-b',
        title: 'Future B',
        ctaHref: '',
        ctaLabel: 'Reserve',
        isVirtualEvent: false,
        tags: [],
        status: 'open' as const,
        timestamp: Date.parse('2026-04-20T10:00:00Z'),
      },
      {
        id: 'future-a',
        title: 'Future A',
        ctaHref: '',
        ctaLabel: 'Reserve',
        isVirtualEvent: false,
        tags: [],
        status: 'open' as const,
        timestamp: Date.parse('2026-04-11T10:00:00Z'),
      },
      {
        id: 'past-a',
        title: 'Past A',
        ctaHref: '',
        ctaLabel: 'Reserve',
        isVirtualEvent: false,
        tags: [],
        status: 'fully_booked' as const,
        timestamp: Date.parse('2026-04-08T10:00:00Z'),
      },
      {
        id: 'past-b',
        title: 'Past B',
        ctaHref: '',
        ctaLabel: 'Reserve',
        isVirtualEvent: false,
        tags: [],
        status: 'open' as const,
        timestamp: Date.parse('2026-04-05T10:00:00Z'),
      },
      {
        id: 'past-c',
        title: 'Past C',
        ctaHref: '',
        ctaLabel: 'Reserve',
        isVirtualEvent: false,
        tags: [],
        status: 'open' as const,
        timestamp: Date.parse('2026-04-04T10:00:00Z'),
      },
      {
        id: 'past-d',
        title: 'Past D',
        ctaHref: '',
        ctaLabel: 'Reserve',
        isVirtualEvent: false,
        tags: [],
        status: 'open' as const,
        timestamp: Date.parse('2026-04-03T10:00:00Z'),
      },
      {
        id: 'past-e',
        title: 'Past E',
        ctaHref: '',
        ctaLabel: 'Reserve',
        isVirtualEvent: false,
        tags: [],
        status: 'open' as const,
        timestamp: Date.parse('2026-04-02T10:00:00Z'),
      },
      {
        id: 'past-f',
        title: 'Past F',
        ctaHref: '',
        ctaLabel: 'Reserve',
        isVirtualEvent: false,
        tags: [],
        status: 'open' as const,
        timestamp: Date.parse('2026-04-01T10:00:00Z'),
      },
      {
        id: 'past-g',
        title: 'Past G',
        ctaHref: '',
        ctaLabel: 'Reserve',
        isVirtualEvent: false,
        tags: [],
        status: 'open' as const,
        timestamp: Date.parse('2026-03-31T10:00:00Z'),
      },
      {
        id: 'unknown',
        title: 'Unknown Date',
        ctaHref: '',
        ctaLabel: 'Reserve',
        isVirtualEvent: false,
        tags: [],
        status: 'open' as const,
        timestamp: null,
      },
    ];

    const upcomingEvents = sortEvents(sourceEvents);
    expect(upcomingEvents.map((event) => event.id)).toEqual([
      'future-a',
      'future-b',
      'unknown',
    ]);

    const pastEvents = sortPastEvents(sourceEvents);
    expect(pastEvents.map((event) => event.id)).toEqual([
      'past-a',
      'past-b',
      'past-c',
      'past-d',
      'past-e',
    ]);

    vi.useRealTimers();
  });

  it('fetches events payload with x-api-key', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          data: [],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const crmApiClient = createCrmApiClient({
      baseUrl: 'https://api.evolvesprouts.com/www',
      apiKey: 'public-crm-key',
    });
    if (!crmApiClient) {
      throw new Error('Expected CRM API client configuration to be valid');
    }

    const payload = await fetchEventsPayload(
      crmApiClient,
      new AbortController().signal,
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.evolvesprouts.com/www/v1/calendar/public',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'x-api-key': 'public-crm-key',
        }),
      }),
    );
    expect(payload).toEqual({
      status: 'success',
      data: [],
    });
  });

  it('fetches calendar with service_key and service_type query params', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const crmApiClient = createCrmApiClient({
      baseUrl: 'https://api.evolvesprouts.com/www',
      apiKey: 'public-crm-key',
    });
    if (!crmApiClient) {
      throw new Error('Expected CRM API client configuration to be valid');
    }

    await fetchEventsPayload(crmApiClient, new AbortController().signal, {
      serviceKey: MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY,
      serviceType: 'training_course',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.evolvesprouts.com/www/v1/calendar/public?service_type=training_course&service_key=${MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY}`,
      expect.anything(),
    );
  });

  it('throws when CRM client is missing', async () => {
    await expect(
      fetchEventsPayload(null, new AbortController().signal),
    ).rejects.toThrow('CRM API client is not configured');
  });

  it('rejects invalid CRM API client configuration', () => {
    expect(
      createCrmApiClient({
        baseUrl: 'https://api.evolvesprouts.com/www',
        apiKey: '   ',
      }),
    ).toBeNull();
  });

  describe('fetchLandingPageCalendarPayload', () => {
    beforeEach(() => {
      clearCrmApiGetCacheForTests();
      vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.evolvesprouts.com/www');
      vi.stubEnv('NEXT_PUBLIC_WWW_CRM_API_KEY', 'public-crm-key');
    });

    it('returns payload after one attempt and uses slug in request URL', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(publicCalendarFixture), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const slug = 'easter-2026-montessori-play-coaching-workshop';
      const { payload, lastError } = await fetchLandingPageCalendarPayload({
        slug,
        attempts: 1,
        timeoutMs: 5000,
      });

      expect(lastError).toBeNull();
      expect(findLandingPageEventInPayload(payload, slug)).not.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        `/v1/calendar/public?slug=${encodeURIComponent(slug)}`,
      );
    });

    it('uses distinct cache keys per slug', async () => {
      const fetchSpy = vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'success',
              data: [
                {
                  title: 'A',
                  slug: url.includes('slug-a') ? 'slug-a' : 'slug-b',
                  booking_system: 'event-booking',
                  dates: [
                    {
                      start_datetime: '2026-01-01T00:00:00Z',
                      end_datetime: '2026-01-01T01:00:00Z',
                      part: 1,
                    },
                  ],
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      );
      vi.stubGlobal('fetch', fetchSpy);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await fetchLandingPageCalendarPayload({ slug: 'slug-a', attempts: 1, timeoutMs: 5000 });
      await fetchLandingPageCalendarPayload({ slug: 'slug-b', attempts: 1, timeoutMs: 5000 });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('times out on attempt 1 and succeeds on attempt 2', async () => {
      const fetchSpy = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(publicCalendarFixture), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      vi.stubGlobal('fetch', fetchSpy);
      const reportSpy = vi
        .spyOn(internalErrorReporting, 'reportInternalError')
        .mockImplementation(() => {});

      const slug = 'easter-2026-montessori-play-coaching-workshop';
      const { payload, lastError } = await fetchLandingPageCalendarPayload({
        slug,
        attempts: 2,
        timeoutMs: 5000,
      });

      expect(lastError).toBeNull();
      expect(findLandingPageEventInPayload(payload, slug)).not.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(reportSpy).toHaveBeenCalledTimes(1);
      expect(reportSpy.mock.calls[0]?.[0]).toMatchObject({
        metadata: { slug, attempt: 1, reason: 'timeout' },
      });
    });

    it('returns null payload after all attempts fail with AbortError and reports each attempt', async () => {
      const fetchSpy = vi.fn().mockRejectedValue(
        Object.assign(new Error('Aborted'), { name: 'AbortError' }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const reportSpy = vi
        .spyOn(internalErrorReporting, 'reportInternalError')
        .mockImplementation(() => {});

      const slug = 'easter-2026-montessori-play-coaching-workshop';
      const { payload, lastError } = await fetchLandingPageCalendarPayload({
        slug,
        attempts: 2,
        timeoutMs: 5000,
      });

      expect(payload).toBeNull();
      expect(lastError).toMatchObject({ name: 'AbortError' });
      expect(reportSpy).toHaveBeenCalledTimes(2);
      expect(reportSpy.mock.calls[0]?.[0]).toMatchObject({
        context: 'landing-page-calendar-fetch',
        metadata: { slug, attempt: 1, reason: 'timeout' },
      });
      expect(reportSpy.mock.calls[1]?.[0]).toMatchObject({
        context: 'landing-page-calendar-fetch',
        metadata: { slug, attempt: 2, reason: 'timeout' },
      });
    });
  });
});
