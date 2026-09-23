import { afterEach, describe, expect, it, vi } from 'vitest';

import enContent from '@/content/en.json';
import { publicCalendarFixture } from '../fixtures/public-calendar';
import type { EventCardData } from '@/lib/events-data';
import {
  getLandingPageStructuredDataContentFromPayload,
  normalizeMyBestAuntieCohortsFromPayload,
} from '@/lib/events-data';
import { ROUTES } from '@/lib/routes';
import {
  buildBreadcrumbSchema,
  buildCourseSchema,
  buildEventSchemas,
  buildFaqPageSchema,
  buildLandingPageEventSchema,
  buildLocalBusinessSchema,
  buildOrganizationSchema,
} from '@/lib/structured-data';

const ENV_KEYS = [
  'NEXT_PUBLIC_INSTAGRAM_URL',
  'NEXT_PUBLIC_LINKEDIN_URL',
  'NEXT_PUBLIC_WHATSAPP_URL',
  'NEXT_PUBLIC_BUSINESS_ADDRESS',
  'NEXT_PUBLIC_BUSINESS_PHONE_NUMBER',
] as const;

const originalEnvValues = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

afterEach(() => {
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    const originalValue = originalEnvValues[key];
    if (typeof originalValue === 'string') {
      process.env[key] = originalValue;
    } else {
      delete process.env[key];
    }
  }
});

describe('structured-data builders', () => {
  it('builds organization and local business schemas with configured env values', () => {
    process.env.NEXT_PUBLIC_INSTAGRAM_URL = 'https://www.instagram.com/evolve_sprouts';
    process.env.NEXT_PUBLIC_LINKEDIN_URL = 'https://www.linkedin.com/company/evolve-sprouts';
    process.env.NEXT_PUBLIC_WHATSAPP_URL = 'https://wa.me/message/ZQHVW4DEORD5A1?src=qr';
    process.env.NEXT_PUBLIC_BUSINESS_ADDRESS = 'Mid-Levels, Hong Kong';
    process.env.NEXT_PUBLIC_BUSINESS_PHONE_NUMBER = '+852 5555 5555';

    const organizationSchema = buildOrganizationSchema({
      locale: 'en',
      content: enContent,
    });
    const localBusinessSchema = buildLocalBusinessSchema({
      locale: 'en',
      content: enContent,
    });

    expect(organizationSchema).toMatchObject({
      '@type': 'Organization',
      '@id': expect.stringContaining('#organization'),
      name: enContent.navbar.brand,
      sameAs: [
        process.env.NEXT_PUBLIC_INSTAGRAM_URL,
        process.env.NEXT_PUBLIC_LINKEDIN_URL,
        process.env.NEXT_PUBLIC_WHATSAPP_URL,
      ],
    });
    expect(localBusinessSchema).toMatchObject({
      '@type': 'LocalBusiness',
      '@id': expect.stringContaining('#local-business'),
      telephone: process.env.NEXT_PUBLIC_BUSINESS_PHONE_NUMBER,
      address: {
        '@type': 'PostalAddress',
        streetAddress: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS,
      },
      areaServed: enContent.seo.localBusinessAreaServed,
      parentOrganization: {
        '@id': expect.stringContaining('#organization'),
      },
    });
  });

  it('builds localized FAQ, course, and breadcrumb schemas', () => {
    const faqSchema = buildFaqPageSchema(enContent.faq);
    const courseSchema = buildCourseSchema({
      locale: 'zh-CN',
      content: enContent,
    });
    const breadcrumbSchema = buildBreadcrumbSchema({
      locale: 'zh-HK',
      items: [
        { name: 'Home', path: ROUTES.home },
        { name: 'About Us', path: ROUTES.about },
      ],
    });

    expect(faqSchema).toMatchObject({
      '@type': 'FAQPage',
    });
    expect(courseSchema).toMatchObject({
      '@type': 'Course',
      '@id': expect.stringContaining('#course'),
      name: enContent.seo.trainingCourse.title,
      description: enContent.seo.trainingCourse.description,
      url: expect.stringContaining('/zh-CN/services/my-best-auntie-training-course'),
      provider: {
        '@id': expect.stringContaining('#organization'),
      },
    });
    expect(breadcrumbSchema).toMatchObject({
      '@type': 'BreadcrumbList',
    });
    const breadcrumbItems = Array.isArray(breadcrumbSchema.itemListElement)
      ? breadcrumbSchema.itemListElement
      : [];
    const firstBreadcrumbItem = breadcrumbItems[0] as {
      item?: string;
    } | undefined;
    const secondBreadcrumbItem = breadcrumbItems[1] as {
      item?: string;
    } | undefined;
    expect(firstBreadcrumbItem?.item).toContain('/zh-HK');
    expect(secondBreadcrumbItem?.item).toContain('/zh-HK/about-us');
  });

  it('adds Course.offers from MBA cohorts when lowest open price is available', () => {
    vi.useFakeTimers();
    // MBA cohort JSON-LD uses `isFutureCohort` (all sessions strictly after "today" in the site TZ).
    // Pin "today" before fixture sessions so open prices stay available regardless of CI clock.
    vi.setSystemTime(new Date('2026-04-01T12:00:00.000Z'));

    const mbaCohorts = normalizeMyBestAuntieCohortsFromPayload(publicCalendarFixture);
    const courseSchema = buildCourseSchema({
      locale: 'en',
      content: enContent,
      myBestAuntieCohorts: mbaCohorts,
    });

    expect(courseSchema).toMatchObject({
      '@type': 'Course',
      offers: {
        '@type': 'Offer',
        price: '9000',
        priceCurrency: 'HKD',
        availability: 'https://schema.org/InStock',
      },
    });
  });

  it('builds event schemas only for events with timestamps', () => {
    const events: EventCardData[] = [
      {
        id: 'event-with-time',
        title: 'Montessori Workshop',
        summary: 'A practical workshop for parents.',
        dateLabel: '12 Apr 2026',
        timeLabel: '10:00 AM',
        isVirtualEvent: false,
        locationName: 'Baumhaus',
        locationAddress: '1/F, Example Tower, Hong Kong',
        ctaHref: 'https://example.com/register',
        ctaLabel: 'Reserve your spot',
        tags: ['Workshop'],
        status: 'open',
        timestamp: Date.parse('2026-04-12T10:00:00.000Z'),
        endTimestamp: Date.parse('2026-04-12T11:00:00.000Z'),
        price: 350,
        currency: 'HKD',
      },
      {
        id: 'event-without-time',
        title: 'Missing Date Event',
        summary: 'Should not render in JSON-LD.',
        dateLabel: '',
        timeLabel: '',
        isVirtualEvent: false,
        locationName: '',
        locationAddress: '',
        ctaHref: '',
        ctaLabel: '',
        tags: [],
        status: 'open',
        timestamp: null,
      },
    ];

    const eventSchemas = buildEventSchemas({
      locale: 'en',
      events,
    });

    expect(eventSchemas).toHaveLength(1);
    expect(eventSchemas[0]).toMatchObject({
      '@type': 'Event',
      '@id': expect.stringContaining('#event-'),
      name: 'Montessori Workshop',
      startDate: '2026-04-12T10:00:00.000Z',
      endDate: '2026-04-12T11:00:00.000Z',
      image: expect.stringContaining('/images/evolvesprouts-logo.svg'),
      organizer: {
        '@id': expect.stringContaining('#organization'),
      },
      performer: {
        '@id': expect.stringContaining('#organization'),
      },
      location: {
        '@type': 'Place',
        name: 'Baumhaus',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '1/F, Example Tower, Hong Kong',
          addressLocality: 'Hong Kong',
          addressCountry: 'HK',
        },
      },
      offers: {
        '@type': 'Offer',
        price: '350',
        priceCurrency: 'HKD',
        availability: 'https://schema.org/InStock',
        validFrom: '2026-04-12T10:00:00.000Z',
      },
    });
  });

  it('builds landing page event schema from events content', () => {
    const structuredDataContent = getLandingPageStructuredDataContentFromPayload(
      publicCalendarFixture,
      'easter-2026-montessori-play-coaching-workshop',
    );
    const schema = buildLandingPageEventSchema({
      locale: 'en',
      pagePath: '/easter-2026-montessori-play-coaching-workshop',
      structuredDataContent,
    });

    expect(schema).toMatchObject({
      '@type': 'Event',
      name: 'Easter 2026 Montessori Play Coaching Workshop',
      description:
        'A practical Montessori-inspired play coaching workshop for children ages 1-4, with parent and child participation (helpers warmly welcome).',
      startDate: '2026-04-06T02:00:00.000Z',
      image: expect.stringContaining('/images/evolvesprouts-logo.svg'),
      organizer: {
        '@id': expect.stringContaining('#organization'),
      },
      performer: {
        '@id': expect.stringContaining('#organization'),
      },
      location: {
        '@type': 'Place',
        name: 'Baumhaus',
        address: {
          '@type': 'PostalAddress',
          streetAddress: expect.any(String),
          addressLocality: 'Hong Kong',
          addressCountry: 'HK',
        },
      },
      offers: {
        '@type': 'Offer',
        price: '350',
        priceCurrency: 'HKD',
        availability: 'https://schema.org/InStock',
        validFrom: expect.any(String),
      },
    });
  });

  it('builds landing page event schema for May 2026 The Missing Piece', () => {
    const structuredDataContent = getLandingPageStructuredDataContentFromPayload(
      publicCalendarFixture,
      'may-2026-the-missing-piece',
    );
    const schema = buildLandingPageEventSchema({
      locale: 'en',
      pagePath: '/may-2026-the-missing-piece',
      structuredDataContent,
    });

    expect(schema).toMatchObject({
      '@type': 'Event',
      name: 'The Missing Piece',
      description:
        'A hands-on workshop for families with children aged 0–2: the right toys, simple play-space tweaks, and practical tools your helper can use right away. Hosted with Little HK at Acorn Playhouse.',
      startDate: '2026-05-16T01:00:00.000Z',
      endDate: '2026-05-16T02:00:00.000Z',
      location: {
        '@type': 'Place',
        name: 'Acorn Playhouse',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '1/F, 1 Sample Street, Hong Kong',
          addressLocality: 'Hong Kong',
          addressCountry: 'HK',
        },
      },
      offers: {
        '@type': 'Offer',
        price: '150',
        priceCurrency: 'HKD',
        availability: 'https://schema.org/InStock',
        validFrom: expect.any(String),
      },
    });
  });
});
