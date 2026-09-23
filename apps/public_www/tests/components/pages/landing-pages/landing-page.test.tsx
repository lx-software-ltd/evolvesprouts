import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { LandingPage } from '@/components/pages/landing-pages/landing-page';
import enContent from '@/content/en.json';
import {
  LandingPageCalendarContext,
  type LandingPageCalendarContextValue,
  type LandingPageRehydrateRootProps,
} from '@/lib/landing-page-calendar-context';
import { buildLandingPageSharedCtaPropsFromCalendar } from '@/lib/landing-page-cta-resolve';
import * as siteConfig from '@/lib/site-config';
import easterWorkshopContent from '@/content/landing-pages/easter-2026-montessori-play-coaching-workshop.json';

const { landingPageRehydrateRootSpy } = vi.hoisted(() => ({
  landingPageRehydrateRootSpy: vi.fn(),
}));

vi.mock('@/lib/landing-page-calendar-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/landing-page-calendar-context')>();

  function MockLandingPageRehydrateRoot(props: LandingPageRehydrateRootProps) {
    const {
      locale,
      slug,
      siteContent,
      pageContent,
      initialHero,
      initialBooking,
      initialStructuredData,
      thankYouWhatsappHref,
      children,
    } = props;

    const sharedCtaProps = buildLandingPageSharedCtaPropsFromCalendar(
      locale,
      slug,
      pageContent.cta,
      siteContent,
      pageContent.meta.title,
      initialHero,
      initialBooking,
      thankYouWhatsappHref,
    );

    const value: LandingPageCalendarContextValue = {
      heroEventContent: initialHero,
      bookingEventContent: initialBooking,
      structuredDataContent: initialStructuredData,
      sharedCtaProps,
      heroAnchorCta: null,
      isRefreshing: false,
      hasRefreshError: false,
    };

    return (
      <actual.LandingPageCalendarContext.Provider value={value}>
        {children}
      </actual.LandingPageCalendarContext.Provider>
    );
  }

  landingPageRehydrateRootSpy.mockImplementation(MockLandingPageRehydrateRoot);

  return {
    ...actual,
    LandingPageRehydrateRoot: landingPageRehydrateRootSpy,
  };
});

vi.spyOn(siteConfig, 'resolvePublicSiteConfig').mockReturnValue({
  instagramUrl: undefined,
  linkedinUrl: undefined,
  whatsappUrl: 'https://wa.me/85212345678',
  contactEmail: 'hello@example.com',
  businessAddress: undefined,
  businessPhoneNumber: undefined,
});

const mockHeroEventContent = {
  title: 'Mock Event Title',
  startDateTime: '2026-04-06T02:00:00Z',
  endDateTime: '2026-04-06T03:00:00Z',
  locationLabel: 'Wan Chai',
  categoryChips: ['Workshop'],
};

const mockBookingEventContent = {
  status: 'open' as const,
  spacesLeft: 6,
  eyebrowDateLabel: 'Monday 6 April',
  bookingPayload: {
    variant: 'event' as const,
    bookingSystem: 'event-booking' as const,
    serviceKey: 'mock-event',
    instanceSlug: 'mock-event-instance',
    title: 'Mock Event Title',
    subtitle: 'Mock subtitle',
    originalAmount: 350,
    locationName: 'Mock Venue',
    locationAddress: 'Mock Address',
    directionHref: 'https://www.google.com/maps',
    dateParts: [
      {
        id: 'part-1',
        startDateTime: '2026-04-06T02:00:00Z',
        endDateTime: '2026-04-06T03:00:00Z',
        description: 'Mock subtitle',
      },
    ],
    selectedDateLabel: '06 Apr 2026',
    selectedDateStartTime: '2026-04-06T02:00:00Z',
  },
};

vi.mock('@/components/shared/page-layout', () => ({
  PageLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));
vi.mock('@/components/sections/landing-pages/landing-page-hero', () => ({
  LandingPageHero: ({
    title,
    eventContent,
  }: {
    title: string;
    eventContent: { locationLabel?: string; categoryChips: string[] } | null;
  }) => (
    <section data-testid='landing-page-hero'>
      {title} ({eventContent?.locationLabel ?? 'no-location'}) [{eventContent?.categoryChips.length ?? 0}]
    </section>
  ),
}));
vi.mock('@/components/sections/landing-pages/landing-page-outline', () => ({
  LandingPageOutline: ({
    content,
  }: {
    content: { title: string };
  }) => (
    <section
      data-testid='landing-page-outline'
      data-shared-cta='yes'
      data-shared-cta-slug='easter-2026-montessori-play-coaching-workshop'
    >
      {content.title}
    </section>
  ),
}));
vi.mock('@/components/sections/landing-pages/landing-page-description', () => ({
  LandingPageDescription: ({
    content,
  }: {
    content: { title: string };
  }) => (
    <section
      data-testid='landing-page-description'
      data-shared-cta='yes'
      data-shared-cta-slug='easter-2026-montessori-play-coaching-workshop'
    >
      {content.title}
    </section>
  ),
}));
vi.mock('@/components/sections/landing-pages/landing-page-details', () => ({
  LandingPageDetails: ({
    content,
  }: {
    content: { title: string };
  }) => (
    <section
      data-testid='landing-page-details'
      data-shared-cta='yes'
      data-shared-cta-slug='easter-2026-montessori-play-coaching-workshop'
    >
      {content.title}
    </section>
  ),
}));
vi.mock('@/components/sections/testimonials', () => ({
  Testimonials: ({ content }: { content: { title: string } }) => (
    <section data-testid='testimonials'>{content.title}</section>
  ),
}));
vi.mock('@/components/sections/landing-pages/landing-page-faq', () => ({
  LandingPageFaq: ({ content }: { content: { title: string } }) => (
    <section data-testid='landing-page-faq'>{content.title}</section>
  ),
}));
vi.mock('@/components/sections/landing-pages/landing-page-cta', () => ({
  LandingPageCta: ({
    content,
    commonContent,
    locale,
    slug,
    eyebrow,
  }: {
    content: { title: string };
    commonContent: { defaultCtaLabel: string };
    locale: string;
    slug: string;
    eyebrow?: string;
  }) => (
    <section data-testid='landing-page-cta'>
      {content.title} ({locale}) [{slug}] <span>{commonContent.defaultCtaLabel}</span>
      <span data-testid='landing-page-cta-eyebrow'>{eyebrow ?? ''}</span>
    </section>
  ),
}));
vi.mock('@/components/sections/about-us-founder-coach', () => ({
  AboutUsFounderCoach: ({ content }: { content: { title: string } }) => (
    <section data-testid='about-us-founder-coach'>{content.title}</section>
  ),
}));

describe('LandingPage composition', () => {
  it('resolves public site config on the server and passes thankYouWhatsappHref to LandingPageRehydrateRoot', () => {
    render(
      <LandingPage
        locale='zh-HK'
        slug='easter-2026-montessori-play-coaching-workshop'
        pagePath='/easter-2026-montessori-play-coaching-workshop'
        siteContent={enContent}
        pageContent={easterWorkshopContent.en}
        heroEventContent={mockHeroEventContent}
        bookingEventContent={mockBookingEventContent}
        structuredDataContent={null}
      />,
    );

    expect(siteConfig.resolvePublicSiteConfig).toHaveBeenCalled();
    const firstCallProps = landingPageRehydrateRootSpy.mock.calls[0]?.[0];
    expect(firstCallProps).toMatchObject({
      thankYouWhatsappHref: 'https://wa.me/85212345678',
    });
  });

  it('assembles all landing page sections in order', () => {
    render(
      <LandingPage
        locale='zh-HK'
        slug='easter-2026-montessori-play-coaching-workshop'
        pagePath='/easter-2026-montessori-play-coaching-workshop'
        siteContent={enContent}
        pageContent={easterWorkshopContent.en}
        heroEventContent={mockHeroEventContent}
        bookingEventContent={mockBookingEventContent}
        structuredDataContent={null}
      />,
    );

    expect(screen.getByTestId('page-layout')).toBeInTheDocument();
    expect(screen.getByTestId('landing-page-hero')).toBeInTheDocument();
    expect(screen.getByTestId('landing-page-outline')).toBeInTheDocument();
    expect(screen.getByTestId('landing-page-description')).toBeInTheDocument();
    expect(screen.getByTestId('landing-page-details')).toBeInTheDocument();
    expect(screen.getByTestId('landing-page-cta')).toBeInTheDocument();
    expect(screen.getByTestId('testimonials')).toBeInTheDocument();
    expect(screen.getByTestId('about-us-founder-coach')).toBeInTheDocument();
    expect(screen.getByTestId('landing-page-faq')).toBeInTheDocument();
    expect(screen.getByTestId('landing-page-outline')).toHaveAttribute(
      'data-shared-cta',
      'yes',
    );
    expect(screen.getByTestId('landing-page-description')).toHaveAttribute(
      'data-shared-cta',
      'yes',
    );
    expect(screen.getByTestId('landing-page-details')).toHaveAttribute(
      'data-shared-cta',
      'yes',
    );
    expect(screen.getByTestId('landing-page-outline')).toHaveAttribute(
      'data-shared-cta-slug',
      'easter-2026-montessori-play-coaching-workshop',
    );
    expect(screen.getByTestId('landing-page-description')).toHaveAttribute(
      'data-shared-cta-slug',
      'easter-2026-montessori-play-coaching-workshop',
    );
    expect(screen.getByTestId('landing-page-details')).toHaveAttribute(
      'data-shared-cta-slug',
      'easter-2026-montessori-play-coaching-workshop',
    );

    expect(screen.getByTestId('page-layout').firstElementChild).toHaveAttribute(
      'data-testid',
      'landing-page-hero',
    );
    expect(
      screen.getByTestId('landing-page-hero').compareDocumentPosition(
        screen.getByTestId('landing-page-outline'),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByTestId('landing-page-outline').compareDocumentPosition(
        screen.getByTestId('landing-page-description'),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByTestId('landing-page-description').compareDocumentPosition(
        screen.getByTestId('landing-page-details'),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByTestId('landing-page-details').compareDocumentPosition(
        screen.getByTestId('testimonials'),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByTestId('testimonials').compareDocumentPosition(
        screen.getByTestId('landing-page-cta'),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByTestId('landing-page-cta').compareDocumentPosition(
        screen.getByTestId('about-us-founder-coach'),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByTestId('about-us-founder-coach').compareDocumentPosition(
        screen.getByTestId('landing-page-faq'),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByTestId('landing-page-hero')).toHaveTextContent(
      'Mock Event Title (Wan Chai) [1]',
    );
    expect(screen.getByTestId('landing-page-cta')).toHaveTextContent(
      `${easterWorkshopContent.en.cta.title} (zh-HK) [easter-2026-montessori-play-coaching-workshop]`,
    );
    expect(screen.getByTestId('landing-page-cta-eyebrow')).toHaveTextContent(
      '⚡ 6 spots left - Monday 6 April',
    );
  });
});
