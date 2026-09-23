import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LandingPageCta } from '@/components/sections/landing-pages/landing-page-cta';
import enContent from '@/content/en.json';
import easterWorkshopContent from '@/content/landing-pages/easter-2026-montessori-play-coaching-workshop.json';
import { trackAnalyticsEvent } from '@/lib/analytics';
import type { EventBookingModalPayload } from '@/lib/events-data';
import { trackMetaPixelEvent } from '@/lib/meta-pixel';

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid='landing-page-modal' />,
}));

vi.mock('@/lib/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  trackEcommerceEvent: vi.fn(),
}));
vi.mock('@/lib/meta-pixel', () => ({
  trackMetaPixelEvent: vi.fn(),
}));

const mockedTrackAnalyticsEvent = vi.mocked(trackAnalyticsEvent);
const mockedTrackMetaPixelEvent = vi.mocked(trackMetaPixelEvent);

afterEach(() => {
  mockedTrackAnalyticsEvent.mockReset();
  mockedTrackMetaPixelEvent.mockReset();
});

describe('LandingPageCta section', () => {
  const bookingPayload: EventBookingModalPayload = {
    variant: 'event',
    bookingSystem: 'event-booking',
    serviceKey: 'easter-workshop-cta-test',
    instanceSlug: 'easter-workshop-cta-test-instance',
    title: 'Easter 2026 Montessori Play Coaching Workshop',
    subtitle: 'A practical workshop',
    originalAmount: 350,
    locationName: 'Baumhaus',
    locationAddress: "Example Hall, 1/F, Example Tower, 1 Sample Street, Hong Kong",
    directionHref:
      'https://www.google.com/maps/dir/?api=1&destination=Example+Hall,+1+Sample+Street,+Hong+Kong',
    dateParts: [
      {
        id: 'session-1',
        startDateTime: '2026-04-06T02:00:00Z',
        endDateTime: '2026-04-06T03:00:00Z',
        description: 'A practical workshop',
      },
    ],
    selectedDateLabel: '06 Apr 2026',
    selectedDateStartTime: '2026-04-06T02:00:00Z',
  };
  const ctaPriceLabel = 'HK$350';
  const resolvedCtaLabel = easterWorkshopContent.en.cta.buttonLabelTemplate.replace(
    '{price}',
    ctaPriceLabel,
  );

  it('keeps booking topics field copy in easter landing-page locale content', () => {
    expect(easterWorkshopContent.en.cta.bookingTopicsField).toMatchObject({
      label: "What's your child's age?",
      placeholder: 'This will help me better personalise your experience',
      required: true,
    });
    expect(easterWorkshopContent['zh-CN'].cta.bookingTopicsField).toMatchObject({
      required: true,
    });
    expect(easterWorkshopContent['zh-HK'].cta.bookingTopicsField).toMatchObject({
      required: true,
    });
  });

  it('opens booking modal and tracks CTA, modal-open, and meta pixel events', async () => {
    const resolvedEyebrow = '⚡ 6 spots left - Monday 6 April';
    const { container } = render(
      <LandingPageCta
        locale='en'
        slug='easter-2026-montessori-play-coaching-workshop'
        content={easterWorkshopContent.en.cta}
        eyebrow={resolvedEyebrow}
        ctaPriceLabel={ctaPriceLabel}
        commonContent={enContent.landingPages.common}
        bookingPayload={bookingPayload}
        isFullyBooked={false}
        bookingModalContent={enContent.bookingModal}
      />,
    );

    const section = document.getElementById('landing-page-cta');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('data-figma-node')).toBe('landing-page-cta');
    expect(section).toHaveClass('es-landing-page-cta-section');
    expect(screen.getByText(resolvedEyebrow)).toBeInTheDocument();
    expect(container.querySelector('img[src="/images/evolvesprouts-logo.svg"]')).toBeNull();
    expect(
      screen.getByRole('heading', {
        name: easterWorkshopContent.en.cta.title,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(easterWorkshopContent.en.cta.description)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: resolvedCtaLabel,
      }),
    );

    expect(screen.getByTestId('landing-page-modal')).toBeInTheDocument();
    expect(mockedTrackAnalyticsEvent).toHaveBeenCalledWith(
      'landing_page_cta_click',
      expect.objectContaining({
        sectionId: 'landing-page-cta',
        ctaLocation: 'landing_page',
        params: expect.objectContaining({
          landing_page_slug: 'easter-2026-montessori-play-coaching-workshop',
        }),
      }),
    );
    await waitFor(() => {
      expect(mockedTrackAnalyticsEvent).toHaveBeenCalledWith(
        'booking_modal_open',
        expect.objectContaining({
          sectionId: 'landing-page-cta',
          ctaLocation: 'landing_page',
        }),
      );
    });
    expect(mockedTrackMetaPixelEvent).toHaveBeenCalledWith('InitiateCheckout', {
      content_name: 'easter-2026-montessori-play-coaching-workshop',
    });
  });

  it('hides eyebrow when eyebrow prop is an empty string', () => {
    render(
      <LandingPageCta
        locale='en'
        slug='easter-2026-montessori-play-coaching-workshop'
        content={easterWorkshopContent.en.cta}
        eyebrow=''
        ctaPriceLabel={ctaPriceLabel}
        commonContent={enContent.landingPages.common}
        bookingPayload={bookingPayload}
        isFullyBooked={false}
        bookingModalContent={enContent.bookingModal}
      />,
    );

    expect(screen.queryByText(/\bspots left\b/)).not.toBeInTheDocument();
  });

  it('shows eyebrow logo by default when eyebrowShowLogo is not provided', () => {
    const { container } = render(
      <LandingPageCta
        locale='en'
        slug='easter-2026-montessori-play-coaching-workshop'
        content={{
          ...easterWorkshopContent.en.cta,
          eyebrowShowLogo: undefined,
        }}
        ctaPriceLabel={ctaPriceLabel}
        commonContent={enContent.landingPages.common}
        bookingPayload={bookingPayload}
        isFullyBooked={false}
        bookingModalContent={enContent.bookingModal}
      />,
    );

    expect(container.querySelector('img[src="/images/evolvesprouts-logo.svg"]')).toBeInTheDocument();
  });

  it('renders fully booked waitlist link when waitlist href is provided', () => {
    render(
      <LandingPageCta
        locale='en'
        slug='easter-2026-montessori-play-coaching-workshop'
        content={easterWorkshopContent.en.cta}
        ctaPriceLabel={ctaPriceLabel}
        commonContent={enContent.landingPages.common}
        bookingPayload={bookingPayload}
        isFullyBooked
        fullyBookedCtaLabel='Fully booked - Get in touch to join the waiting list.'
        fullyBookedWaitlistHref='https://wa.me/85291234567?text=waitlist'
        bookingModalContent={enContent.bookingModal}
      />,
    );

    expect(
      screen.getByRole('link', {
        name: 'Fully booked - Get in touch to join the waiting list.',
      }),
    ).toHaveAttribute('href', 'https://wa.me/85291234567?text=waitlist');
  });

  it('disables CTA button when event is fully booked and no waitlist href is provided', () => {
    render(
      <LandingPageCta
        locale='en'
        slug='easter-2026-montessori-play-coaching-workshop'
        content={easterWorkshopContent.en.cta}
        ctaPriceLabel={ctaPriceLabel}
        commonContent={enContent.landingPages.common}
        bookingPayload={bookingPayload}
        isFullyBooked
        bookingModalContent={enContent.bookingModal}
      />,
    );

    expect(
      screen.getByRole('button', { name: easterWorkshopContent.en.cta.fullyBookedButtonLabel }),
    ).toBeDisabled();
  });

  it('falls back to landingPages.common.defaultCtaLabel when buttonLabel is empty and no template is set', () => {
    render(
      <LandingPageCta
        locale='en'
        slug='easter-2026-montessori-play-coaching-workshop'
        content={{
          ...easterWorkshopContent.en.cta,
          buttonLabel: '',
          buttonLabelTemplate: '',
        }}
        commonContent={enContent.landingPages.common}
        bookingPayload={bookingPayload}
        isFullyBooked={false}
        bookingModalContent={enContent.bookingModal}
      />,
    );

    expect(
      screen.getByRole('button', { name: enContent.landingPages.common.defaultCtaLabel }),
    ).toBeInTheDocument();
  });

  it('falls back to buttonLabel when template exists but event price is unavailable', () => {
    render(
      <LandingPageCta
        locale='en'
        slug='easter-2026-montessori-play-coaching-workshop'
        content={easterWorkshopContent.en.cta}
        commonContent={enContent.landingPages.common}
        bookingPayload={bookingPayload}
        isFullyBooked={false}
        bookingModalContent={enContent.bookingModal}
      />,
    );

    expect(
      screen.getByRole('button', { name: easterWorkshopContent.en.cta.buttonLabel }),
    ).toBeInTheDocument();
  });

  it('renders anchor CTA label from ctaAnchorLabel when anchor mode is active', () => {
    render(
      <LandingPageCta
        locale='en'
        slug='book-a-free-call'
        content={{
          ...easterWorkshopContent.en.cta,
          ctaAnchorHref: '#intro-call-booking',
          ctaAnchorLabel: 'Scroll to booking',
          buttonLabel: 'Different modal label',
        }}
        commonContent={enContent.landingPages.common}
        bookingPayload={bookingPayload}
        isFullyBooked={false}
        bookingModalContent={enContent.bookingModal}
      />,
    );

    const link = screen.getByRole('link', { name: 'Scroll to booking' });
    expect(link).toHaveAttribute('href', '#intro-call-booking');
  });
});
