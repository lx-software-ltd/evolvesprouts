import { render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LandingPage } from '@/components/pages/landing-pages/landing-page';
import enContent from '@/content/en.json';
import easterWorkshopContent from '@/content/landing-pages/easter-2026-montessori-play-coaching-workshop.json';
import { clearCrmApiGetCacheForTests } from '@/lib/crm-api-client';
import { publicCalendarFixture } from '../../../fixtures/public-calendar';

const mockedReportInternalError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/internal-error-reporting', () => ({
  reportInternalError: mockedReportInternalError,
}));

vi.mock('@/lib/site-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/site-config')>();
  return {
    ...actual,
    resolvePublicSiteConfig: vi.fn(() => ({
      instagramUrl: undefined,
      linkedinUrl: undefined,
      whatsappUrl: undefined,
      contactEmail: 'hello@example.com',
      businessAddress: undefined,
      businessPhoneNumber: undefined,
    })),
  };
});

vi.mock('@/components/shared/page-layout', () => ({
  PageLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));

vi.mock('@/components/sections/about-us-founder-coach', () => ({
  AboutUsFounderCoach: () => <div data-testid='about-us-founder-coach' />,
}));
vi.mock('@/components/sections/testimonials', () => ({
  Testimonials: () => <div data-testid='testimonials' />,
}));
vi.mock('@/components/sections/landing-pages/landing-page-outline', () => ({
  LandingPageOutline: () => <div data-testid='landing-page-outline' />,
}));
vi.mock('@/components/sections/landing-pages/landing-page-description', () => ({
  LandingPageDescription: () => <div data-testid='landing-page-description' />,
}));
vi.mock('@/components/sections/landing-pages/landing-page-details', () => ({
  LandingPageDetails: () => <div data-testid='landing-page-details' />,
}));
vi.mock('@/components/sections/landing-pages/landing-page-faq', () => ({
  LandingPageFaq: () => <div data-testid='landing-page-faq' />,
}));
vi.mock('@/components/sections/landing-pages/landing-page-cta', () => ({
  LandingPageCta: () => <div data-testid='landing-page-cta' />,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mockedReportInternalError.mockReset();
});

beforeEach(() => {
  clearCrmApiGetCacheForTests();
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.evolvesprouts.com/www');
  vi.stubEnv('NEXT_PUBLIC_WWW_CRM_API_KEY', 'public-crm-key');
});

describe('LandingPage calendar rehydrate', () => {
  it('does not mount locale error boundary when client NEXT_PUBLIC_* env is empty (thank-you href from server)', async () => {
    vi.stubEnv('NEXT_PUBLIC_EMAIL', '');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(publicCalendarFixture), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <LandingPage
        locale='en'
        slug='easter-2026-montessori-play-coaching-workshop'
        pagePath='/easter-2026-montessori-play-coaching-workshop'
        siteContent={enContent}
        pageContent={easterWorkshopContent.en}
        heroEventContent={null}
        bookingEventContent={null}
        structuredDataContent={null}
      />,
    );

    await waitFor(() => {
      const ctaButton = screen.getByRole('button', {
        name: new RegExp(
          easterWorkshopContent.en.cta.buttonLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        ),
      });
      expect(ctaButton).not.toBeDisabled();
    });

    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument();
    const heroSection = document.querySelector('#landing-page-hero');
    expect(heroSection).not.toBeNull();
    expect(heroSection).toHaveTextContent('Hong Kong');
    expect(mockedReportInternalError).not.toHaveBeenCalled();
    const emailConfigErrors = consoleErrorSpy.mock.calls.filter((call) =>
      call.some(
        (arg) => typeof arg === 'string' && arg.includes('NEXT_PUBLIC_EMAIL'),
      ),
    );
    expect(emailConfigErrors).toHaveLength(0);
    consoleErrorSpy.mockRestore();
  });

  it('enables booking CTA and updates hero chips after client fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(publicCalendarFixture), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const ctaButtonLabel = easterWorkshopContent.en.cta.buttonLabel;
    const ctaNamePattern = new RegExp(ctaButtonLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    render(
      <LandingPage
        locale='en'
        slug='easter-2026-montessori-play-coaching-workshop'
        pagePath='/easter-2026-montessori-play-coaching-workshop'
        siteContent={enContent}
        pageContent={easterWorkshopContent.en}
        heroEventContent={null}
        bookingEventContent={null}
        structuredDataContent={null}
      />,
    );

    await waitFor(() => {
      const ctaButton = screen.getByRole('button', { name: ctaNamePattern });
      expect(ctaButton).not.toBeDisabled();
    });

    const heroSection = document.querySelector('#landing-page-hero');
    expect(heroSection).not.toBeNull();
    expect(heroSection).toHaveTextContent('Hong Kong');
    expect(heroSection).toHaveTextContent('Workshop');
  });
});
