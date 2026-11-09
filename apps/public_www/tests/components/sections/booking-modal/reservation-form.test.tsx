/* eslint-disable @next/next/no-img-element */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { type ReactNode } from 'react';

import { BookingReservationForm } from '@/components/sections/booking-modal/reservation-form';
import { buildThankYouRecapLabels } from '@/components/sections/booking-modal/thank-you-recap-labels';
import enContent from '@/content/en.json';
import type { EventCalendarBookingModalPayload } from '@/lib/events-data';

vi.mock('@/lib/crm-api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crm-api-client')>(
    '@/lib/crm-api-client',
  );

  return {
    ...actual,
    createPublicApiClient: vi.fn(() => null),
    createPublicCrmApiClient: vi.fn(() => null),
    isAbortRequestError: (error: unknown) =>
      error instanceof Error && error.name === 'AbortError',
  };
});

vi.mock('@/lib/fps-qr-code', () => ({
  generateFpsQrImageDataUrl: vi.fn(() =>
    Promise.resolve(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    ),
  ),
  hasFpsQrConfiguration: vi.fn(() => true),
}));

vi.mock('@/lib/discounts-data', async () => {
  const actual = await vi.importActual<typeof import('@/lib/discounts-data')>(
    '@/lib/discounts-data',
  );

  return {
    ...actual,
    validateDiscountCode: vi.fn(() => Promise.resolve(null)),
  };
});

vi.mock('@/lib/reservation-payments-data', () => ({
  createReservationPaymentIntent: vi.fn(() =>
    Promise.resolve({
      payment_intent_id: 'pi_mock_123',
      client_secret: 'pi_mock_123_secret_abc',
    })),
}));

vi.mock('@/lib/reservations-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reservations-data')>();
  return {
    ...actual,
    submitReservation: vi.fn(),
  };
});

vi.mock('@/lib/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  trackPublicFormOutcome: vi.fn(),
  trackEcommerceEvent: vi.fn(),
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

vi.mock('next/image', () => ({
  default: ({
    alt,
    ...props
  }: {
    alt?: string;
  } & Record<string, unknown>) => <img alt={alt ?? ''} {...props} />,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    scroll: _scroll,
    ...props
  }: {
    href: string;
    children: ReactNode;
    prefetch?: boolean;
    scroll?: boolean;
  } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}));

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
    const LazyStripePaymentSection = React.lazy(async () => ({
      default: await loader(),
    }));
    return function DynamicStripePaymentSection(props: Record<string, unknown>) {
      return (
        <React.Suspense fallback={null}>
          <LazyStripePaymentSection {...props} />
        </React.Suspense>
      );
    };
  },
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PaymentElement: () => <div data-testid='mock-stripe-payment-element' />,
  useElements: () => ({}),
  useStripe: () => ({
    confirmPayment: vi.fn(async () => ({
      paymentIntent: { id: 'pi_test', status: 'succeeded' },
    })),
  }),
}));

const paymentModal = enContent.bookingModal.paymentModal;
const thankYouModalContent = enContent.bookingModal.thankYouModal;
const mapsUrl = 'https://maps.example.com/dir?q=venue';

const eventPayload: EventCalendarBookingModalPayload = {
  variant: 'event',
  bookingSystem: 'event-booking',
  serviceKey: 'test-event-1',
  instanceSlug: 'test-event-instance-slug',
  title: 'Test Event',
  subtitle: 'Event subtitle',
  originalAmount: 100,
  locationName: 'Venue Name',
  locationAddress: '1 Test St, Hong Kong',
  directionHref: mapsUrl,
  dateParts: [
    {
      id: 'part-1',
      startDateTime: '2026-06-15T10:00:00.000Z',
      endDateTime: '2026-06-15T11:00:00.000Z',
      description: 'Part one',
    },
  ],
  selectedDateLabel: '15 Jun 2026',
  selectedDateStartTime: '2026-06-15T10:00:00.000Z',
};

async function expectFpsQrLoaded(): Promise<void> {
  await waitFor(() => {
    const image = document.querySelector('[aria-label="FPS payment QR code"] img');
    expect(image?.getAttribute('src') ?? '').toMatch(/^data:image\/png;base64,/);
  });
}

describe('BookingReservationForm', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'test-turnstile-site-key';
    process.env.NEXT_PUBLIC_FPS_MERCHANT_NAME = 'Test FPS Merchant';
    process.env.NEXT_PUBLIC_FPS_MOBILE_NUMBER = '85200000000';
    process.env.NEXT_PUBLIC_BANK_NAME = 'Test Bank';
    process.env.NEXT_PUBLIC_BANK_ACCOUNT_HOLDER = 'Test Holder';
    process.env.NEXT_PUBLIC_BANK_ACCOUNT_NUMBER = '123';
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_mock_123';
  });

  it('does not render Turnstile until the user focuses a field by default', async () => {
    render(
      <BookingReservationForm
        locale='en'
        content={paymentModal}
        eventTitle={eventPayload.title}
        serviceKey={eventPayload.serviceKey}
        bookingSystem={eventPayload.bookingSystem}
        serviceTypeLabelKey='event'
        serviceInstanceSlug={eventPayload.instanceSlug}
        selectedServiceTierLabel=''
        selectedCohortDateLabel={eventPayload.selectedDateLabel}
        selectedDateStartTime={eventPayload.selectedDateStartTime}
        originalPriceAmount={eventPayload.originalAmount}
        venueName={eventPayload.locationName}
        venueAddress={eventPayload.locationAddress}
        venueDirectionHref={eventPayload.directionHref}
        dateEndTime={eventPayload.dateParts[0].endDateTime}
        eventSubtitle={eventPayload.subtitle}
        sessionSlots={eventPayload.dateParts.map((part) => ({
          dateStartTime: part.startDateTime,
          dateEndTime: part.endDateTime,
        }))}
        descriptionId='booking-test-description'
        thankYouRecapLabels={buildThankYouRecapLabels(thankYouModalContent)}
        onSubmitReservation={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();

    fireEvent.focus(
      screen.getByLabelText(new RegExp(`^${paymentModal.fullNameLabel}`)),
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-turnstile-captcha')).toBeInTheDocument();
    });
    await expectFpsQrLoaded();
  });

  it('renders Turnstile on initial mount when initiallyInteracted is true', async () => {
    render(
      <BookingReservationForm
        initiallyInteracted
        locale='en'
        content={paymentModal}
        eventTitle={eventPayload.title}
        serviceKey={eventPayload.serviceKey}
        bookingSystem={eventPayload.bookingSystem}
        serviceTypeLabelKey='event'
        serviceInstanceSlug={eventPayload.instanceSlug}
        selectedServiceTierLabel=''
        selectedCohortDateLabel={eventPayload.selectedDateLabel}
        selectedDateStartTime={eventPayload.selectedDateStartTime}
        originalPriceAmount={eventPayload.originalAmount}
        venueName={eventPayload.locationName}
        venueAddress={eventPayload.locationAddress}
        venueDirectionHref={eventPayload.directionHref}
        dateEndTime={eventPayload.dateParts[0].endDateTime}
        eventSubtitle={eventPayload.subtitle}
        sessionSlots={eventPayload.dateParts.map((part) => ({
          dateStartTime: part.startDateTime,
          dateEndTime: part.endDateTime,
        }))}
        descriptionId='booking-test-description'
        thankYouRecapLabels={buildThankYouRecapLabels(thankYouModalContent)}
        onSubmitReservation={vi.fn()}
      />,
    );

    expect(screen.getByTestId('mock-turnstile-captcha')).toBeInTheDocument();
    await expectFpsQrLoaded();
  });
});
