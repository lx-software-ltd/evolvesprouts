import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BookFreeCallLandingPage } from '@/components/pages/landing-pages/book-a-free-call';
import { getContent } from '@/content';
import enContent from '@/content/en.json';
import bookAFreeCall from '@/content/landing-pages/book-a-free-call.json';
import * as eventsData from '@/lib/events-data';
import { getLandingPageContent } from '@/lib/landing-pages';

vi.mock('@/lib/public-calendar-availability-api', () => ({
  CALENDAR_PUBLIC_CLIENT_FETCH_TIMEOUT_MS: 30000,
  fetchIntroCallSlots: vi.fn().mockResolvedValue({ slots: [], fetchFailed: false }),
}));

vi.mock('@/lib/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  trackPublicFormOutcome: vi.fn(),
  trackEcommerceEvent: vi.fn(),
}));

vi.mock('@/lib/meta-pixel', () => ({
  trackMetaPixelEvent: vi.fn(),
}));

vi.mock('@/components/shared/turnstile-captcha', () => ({
  TurnstileCaptcha: ({
    onTokenChange,
  }: {
    onTokenChange: (token: string | null) => void;
  }) => (
    <div data-testid='mock-turnstile-captcha'>
      <button
        data-testid='mock-turnstile-captcha-solve'
        type='button'
        onClick={() => {
          onTokenChange('mock-turnstile-token');
        }}
      >
        Solve CAPTCHA
      </button>
    </div>
  ),
}));

const pageContent = getLandingPageContent('book-a-free-call', 'en');
if (!pageContent) {
  throw new Error('missing book-a-free-call content');
}

describe('BookFreeCallLandingPage', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.evolvesprouts.com/www');
    vi.stubEnv('NEXT_PUBLIC_WWW_CRM_API_KEY', 'public-crm-key');
    vi.stubEnv('NEXT_PUBLIC_WHATSAPP_URL', 'https://wa.me/85290000000');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'test-turnstile-site-key');
  });

  it('does not trigger calendar payload fetch for this slug', () => {
    const spy = vi.spyOn(eventsData, 'fetchEventsPayload');

    render(
      <BookFreeCallLandingPage
        locale='en'
        pagePath='/book-a-free-call'
        siteContent={enContent}
        pageContent={pageContent}
      />,
    );

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('lays out sections: hero → before you book → pick a time → faq, with no description/testimonials/coach', () => {
    render(
      <BookFreeCallLandingPage
        locale='en'
        pagePath='/book-a-free-call'
        siteContent={enContent}
        pageContent={pageContent}
      />,
    );

    const beforeYouBookHeading = screen.getByRole('heading', {
      name: bookAFreeCall.en.details.title,
    });
    const beforeYouBookSection = beforeYouBookHeading.closest('section');
    expect(beforeYouBookSection).not.toBeNull();
    expect(beforeYouBookSection).toHaveClass('es-book-a-free-call-good-to-know-section');

    const bookingRegion = screen.getByRole('region', {
      name: bookAFreeCall.en.introCall.bookingSectionTitle,
    });
    expect(bookingRegion).toHaveClass('es-book-a-free-call-booking-section');

    const faqHeading = screen.getByRole('heading', {
      name: bookAFreeCall.en.faq.title,
    });

    expect(
      beforeYouBookHeading.compareDocumentPosition(bookingRegion),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      bookingRegion.compareDocumentPosition(faqHeading),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    expect(
      screen.queryByRole('heading', { name: bookAFreeCall.en.description.title }),
    ).toBeNull();
    expect(
      screen.queryByRole('heading', { name: enContent.testimonials.title }),
    ).toBeNull();
    expect(
      screen.queryByRole('heading', { name: enContent.aboutUs.coaches.founder.title }),
    ).toBeNull();
    expect(document.querySelector('[data-figma-node="about-us-founder-coach"]')).toBeNull();

    expect(document.getElementById('landing-page-cta')).toBeNull();
  });

  it('renders hero anchor and inline section CTAs to the booking hash', () => {
    const siteContent = getContent('en');
    render(
      <BookFreeCallLandingPage
        locale='en'
        pagePath='/book-a-free-call'
        siteContent={siteContent}
        pageContent={pageContent}
      />,
    );

    const localizedBookingHref = '#intro-call-booking';
    const pickTimeLinks = screen.getAllByRole('link', {
      name: bookAFreeCall.en.hero.ctaAnchorLabel,
    });
    expect(
      pickTimeLinks.filter((link) => link.getAttribute('href') === localizedBookingHref),
    ).toHaveLength(2);
  });

  it('renders hero anchor CTA to the booking section and no booking modal shell', () => {
    render(
      <BookFreeCallLandingPage
        locale='en'
        pagePath='/book-a-free-call'
        siteContent={enContent}
        pageContent={pageContent}
      />,
    );

    const heroSection = document.getElementById('landing-page-hero');
    expect(heroSection).not.toBeNull();
    const heroCta = within(heroSection as HTMLElement).getByRole('link', {
      name: bookAFreeCall.en.hero.ctaAnchorLabel,
    });
    expect(heroCta).toHaveAttribute('href', '#intro-call-booking');

    const bookingRegion = screen.getByRole('region', {
      name: bookAFreeCall.en.introCall.bookingSectionTitle,
    });
    expect(bookingRegion).toHaveAttribute('id', 'intro-call-booking');

    expect(screen.queryByTestId('landing-page-modal')).toBeNull();
  });
});
