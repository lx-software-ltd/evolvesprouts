/* eslint-disable @next/next/no-img-element */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildHelperTrainingHeroChips,
  HelperTrainingLandingPage,
} from '@/components/pages/landing-pages/helper-training-hong-kong';
import enContent from '@/content/en.json';
import helperTraining from '@/content/landing-pages/helper-training-hong-kong.json';
import { trackAnalyticsEvent } from '@/lib/analytics';
import type { MyBestAuntieEventCohort } from '@/lib/events-data';
import { getLandingPageContent } from '@/lib/landing-pages';
import trainingCoursesFixture from '../../../fixtures/my-best-auntie-training-courses.json';

vi.mock('@/components/sections/my-best-auntie/use-my-best-auntie-cohorts', () => ({
  useMyBestAuntieCohorts: ({ initialCohorts }: { initialCohorts: MyBestAuntieEventCohort[] }) => ({
    cohorts: initialCohorts,
    isLoading: false,
    hasRequestError: false,
  }),
}));

vi.mock('next/image', () => ({
  default: ({
    alt,
    fill: _fill,
    priority: _priority,
    ...props
  }: {
    alt?: string;
    fill?: boolean;
    priority?: boolean;
  } & Record<string, unknown>) => <img alt={alt ?? ''} {...props} />,
}));

vi.mock('@/lib/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  trackEcommerceEvent: vi.fn(),
  trackPublicFormOutcome: vi.fn(),
}));

vi.mock('@/lib/meta-pixel', () => ({
  trackMetaPixelEvent: vi.fn(),
}));

const mockedTrackAnalyticsEvent = vi.mocked(trackAnalyticsEvent);

const pageContent = getLandingPageContent('helper-training-hong-kong', 'en');
if (!pageContent) {
  throw new Error('missing helper-training-hong-kong content');
}
const cohorts = trainingCoursesFixture.data as MyBestAuntieEventCohort[];

beforeAll(() => {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window.HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-04-01T00:00:00Z'));
  vi.stubEnv('NEXT_PUBLIC_WHATSAPP_URL', 'https://wa.me/85290000000');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  mockedTrackAnalyticsEvent.mockReset();
});

function renderPage(initialCohorts: MyBestAuntieEventCohort[] = cohorts) {
  return render(
    <HelperTrainingLandingPage
      locale='en'
      pagePath='/helper-training-hong-kong'
      siteContent={enContent}
      pageContent={pageContent!}
      cohorts={initialCohorts}
    />,
  );
}

describe('buildHelperTrainingHeroChips', () => {
  it('prepends CRM-derived price and next-cohort chips before the static JSON chips', () => {
    const chips = buildHelperTrainingHeroChips(pageContent!, cohorts, 'en');

    expect(chips.slice(0, 2)).toEqual([
      { type: 'price', label: 'From HK$9,000' },
      { type: 'cohort', label: 'Next cohort: Apr, 2026' },
    ]);
    expect(chips.slice(2)).toEqual(helperTraining.en.hero.quickFactChips);
  });

  it('falls back to static chips only when no open cohort exists', () => {
    expect(buildHelperTrainingHeroChips(pageContent!, [], 'en')).toEqual(
      helperTraining.en.hero.quickFactChips,
    );
    const soldOut = cohorts.map((cohort) => ({ ...cohort, is_fully_booked: true }));
    expect(buildHelperTrainingHeroChips(pageContent!, soldOut, 'en')).toEqual(
      helperTraining.en.hero.quickFactChips,
    );
  });
});

describe('HelperTrainingLandingPage', () => {
  it('shows price, next cohort and a WhatsApp CTA in the hero, above the booking section', () => {
    renderPage();

    const hero = document.getElementById('landing-page-hero');
    expect(hero).not.toBeNull();
    const heroChips = within(hero as HTMLElement).getByTestId('landing-page-hero-chips');
    expect(heroChips).toHaveTextContent('From HK$9,000');
    expect(heroChips).toHaveTextContent('Next cohort: Apr, 2026');
    expect(heroChips).toHaveTextContent('9 weeks');

    const primaryCta = within(hero as HTMLElement).getByRole('link', {
      name: helperTraining.en.hero.ctaAnchorLabel,
    });
    expect(primaryCta).toHaveAttribute('href', '#my-best-auntie-booking');

    const whatsappCta = within(hero as HTMLElement).getByTestId('landing-page-hero-whatsapp-cta');
    expect(whatsappCta).toHaveTextContent(helperTraining.en.courseBooking.whatsappCtaLabel);
    const whatsappUrl = new URL(whatsappCta.getAttribute('href') ?? '');
    expect(whatsappUrl.origin + whatsappUrl.pathname).toBe('https://wa.me/85290000000');
    expect(whatsappUrl.searchParams.get('text')).toBe(
      helperTraining.en.courseBooking.whatsappPrefillMessage,
    );

    const bookingSection = document.getElementById('my-best-auntie-booking');
    expect(bookingSection).not.toBeNull();
    expect(hero!.compareDocumentPosition(bookingSection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      within(bookingSection as HTMLElement).getByRole('button', {
        name: enContent.myBestAuntie.booking.confirmAndPayLabel,
      }),
    ).toBeInTheDocument();
  });

  it('tracks a whatsapp_click from the hero CTA', () => {
    renderPage();

    fireEvent.click(screen.getByTestId('landing-page-hero-whatsapp-cta'));

    expect(mockedTrackAnalyticsEvent).toHaveBeenCalledWith(
      'whatsapp_click',
      expect.objectContaining({
        sectionId: 'landing-page-hero',
        ctaLocation: 'landing_page',
      }),
    );
  });

  it('orders sections: hero → booking → what is included → good to know → testimonials → coach → faq', () => {
    renderPage();

    const ordered = [
      document.getElementById('landing-page-hero'),
      document.getElementById('my-best-auntie-booking'),
      screen.getByRole('heading', { name: helperTraining.en.description.title }),
      screen.getByRole('heading', { name: helperTraining.en.details.title }),
      screen.getByRole('heading', { name: enContent.testimonials.title }),
      document.querySelector('[data-figma-node="about-us-founder-coach"]'),
      screen.getByRole('heading', { name: helperTraining.en.faq.title }),
    ];

    for (const [index, node] of ordered.entries()) {
      expect(node, `section ${index}`).not.toBeNull();
      const next = ordered[index + 1];
      if (next) {
        expect(node!.compareDocumentPosition(next)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      }
    }

    expect(document.getElementById('landing-page-cta')).toBeNull();
    expect(document.getElementById('landing-page-outline')).toBeNull();
  });

  it('still renders the hero and booking section when the CRM returns no cohorts', () => {
    renderPage([]);

    const heroChips = screen.getByTestId('landing-page-hero-chips');
    expect(heroChips).not.toHaveTextContent('From HK$');
    expect(heroChips).toHaveTextContent('9 weeks');
    expect(document.getElementById('my-best-auntie-booking')).not.toBeNull();
    expect(
      screen.getByText(enContent.myBestAuntie.booking.noCohortsLabel),
    ).toBeInTheDocument();
  });
});
