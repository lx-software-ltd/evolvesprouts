/* eslint-disable @next/next/no-img-element */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { EventBookingModal } from '@/components/sections/events/event-booking-modal';
import { buildThankYouRecapLabels } from '@/components/sections/booking-modal/thank-you-recap-labels';
import enContent from '@/content/en.json';
import type { EventCalendarBookingModalPayload } from '@/lib/events-data';
import { createPublicCrmApiClient } from '@/lib/crm-api-client';
import { validateDiscountCode } from '@/lib/discounts-data';
import { generateFpsQrImageDataUrl } from '@/lib/fps-qr-code';
import { submitReservation } from '@/lib/reservations-data';

vi.mock('@/lib/hooks/use-modal-lock-body', () => ({
  useModalLockBody: () => {},
}));

vi.mock('@/lib/hooks/use-modal-focus-management', () => ({
  useModalFocusManagement: () => {},
}));

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
    Promise.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
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
    submitReservation: vi.fn((client, opts) => {
      return actual.submitReservation(client, opts);
    }),
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
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
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

describe('EventBookingModal', () => {
  const mockedCreateCrmApiClient = vi.mocked(createPublicCrmApiClient);
  const mockedValidateDiscountCode = vi.mocked(validateDiscountCode);
  const mockedGenerateFpsQr = vi.mocked(generateFpsQrImageDataUrl);
  const mockedSubmitReservationFn = vi.mocked(submitReservation);

  beforeEach(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'test-turnstile-site-key';
    process.env.NEXT_PUBLIC_FPS_MERCHANT_NAME = 'Test FPS Merchant';
    process.env.NEXT_PUBLIC_FPS_MOBILE_NUMBER = '85200000000';
    process.env.NEXT_PUBLIC_BANK_NAME = 'Test Bank';
    process.env.NEXT_PUBLIC_BANK_ACCOUNT_HOLDER = 'Test Holder';
    process.env.NEXT_PUBLIC_BANK_ACCOUNT_NUMBER = '123';
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_mock_123';
  });

  afterEach(() => {
    mockedGenerateFpsQr.mockImplementation(() =>
      Promise.resolve(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ),
    );
    mockedCreateCrmApiClient.mockReturnValue(null);
    mockedSubmitReservationFn.mockClear();
    vi.clearAllMocks();
  });

  it('submits location_url when direction link is a valid HTTP URL', async () => {
    const requestSpy = vi.fn().mockResolvedValue({ message: 'ok' });
    mockedCreateCrmApiClient.mockReturnValue({ request: requestSpy });

    render(
      <EventBookingModal
        paymentModalContent={paymentModal}
        bookingPayload={eventPayload}
        thankYouRecapLabels={buildThankYouRecapLabels(thankYouModalContent)}
        onClose={() => {}}
        onSubmitReservation={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText(new RegExp(paymentModal.fullNameLabel)), {
      target: { value: 'Test User' },
    });
    fireEvent.change(screen.getByLabelText(new RegExp(paymentModal.emailLabel)), {
      target: { value: 'u@example.com' },
    });
    fireEvent.change(
      screen.getByRole('textbox', { name: new RegExp(`^${paymentModal.phoneLabel}`) }),
      {
        target: { value: '91234567' },
      },
    );
    fireEvent.change(screen.getByLabelText(paymentModal.topicsInterestLabel), {
      target: { value: 'Note' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: new RegExp(paymentModal.pendingReservationAcknowledgementLabel),
      }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: new RegExp(paymentModal.termsLinkLabel),
      }),
    );

    await waitFor(() => {
      const qrImg = document.querySelector(
        '[aria-label="FPS payment QR code"] img',
      ) as HTMLImageElement | null;
      expect(qrImg?.getAttribute('src') ?? '').toMatch(/^data:image\/png/);
    });

    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', {
        name: paymentModal.submitLabel,
      }),
    );

    await waitFor(() => {
      expect(requestSpy).toHaveBeenCalled();
    });

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        endpointPath: '/v1/reservations',
        body: expect.objectContaining({
          locationUrl: mapsUrl,
          bookingSystem: 'event-booking',
          serviceKey: 'test-event-1',
          serviceInstanceSlug: 'test-event-instance-slug',
        }),
      }),
    );
    const call = requestSpy.mock.calls[0]?.[0] as { body: Record<string, unknown> };
    expect(call.body).not.toHaveProperty('serviceTier');
  });

  it('omits payment UI for a zero-priced event and submits paymentMethod free', async () => {
    mockedCreateCrmApiClient.mockReturnValue({ request: vi.fn().mockResolvedValue({ message: 'ok' }) });

    render(
      <EventBookingModal
        paymentModalContent={paymentModal}
        bookingPayload={{ ...eventPayload, originalAmount: 0 }}
        thankYouRecapLabels={buildThankYouRecapLabels(thankYouModalContent)}
        onClose={() => {}}
        onSubmitReservation={() => {}}
      />,
    );

    expect(document.querySelector('div[data-booking-payment="true"]')).toBeNull();
    expect(
      screen.queryByRole('checkbox', {
        name: new RegExp(paymentModal.pendingReservationAcknowledgementLabel),
      }),
    ).toBeNull();
    expect(
      screen.getByRole('checkbox', {
        name: new RegExp(paymentModal.termsLinkLabel),
      }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(new RegExp(paymentModal.fullNameLabel)), {
      target: { value: 'Test User' },
    });
    fireEvent.change(screen.getByLabelText(new RegExp(paymentModal.emailLabel)), {
      target: { value: 'u@example.com' },
    });
    fireEvent.change(
      screen.getByRole('textbox', { name: new RegExp(`^${paymentModal.phoneLabel}`) }),
      {
        target: { value: '91234567' },
      },
    );
    fireEvent.change(screen.getByLabelText(paymentModal.topicsInterestLabel), {
      target: { value: 'Note' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: new RegExp(paymentModal.termsLinkLabel),
      }),
    );
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', {
        name: paymentModal.submitLabel,
      }),
    );

    await waitFor(() => {
      expect(mockedSubmitReservationFn).toHaveBeenCalled();
    });

    expect(mockedSubmitReservationFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          paymentMethod: 'free',
          totalAmount: 0,
          serviceKey: 'test-event-1',
          serviceInstanceSlug: 'test-event-instance-slug',
        }),
      }),
    );
  });

  it('shows discount unavailable copy and skips validate when serviceKey is empty', async () => {
    const requestSpy = vi.fn().mockResolvedValue({ message: 'ok' });
    mockedCreateCrmApiClient.mockReturnValue({ request: requestSpy });
    mockedValidateDiscountCode.mockClear();

    render(
      <EventBookingModal
        paymentModalContent={paymentModal}
        bookingPayload={{ ...eventPayload, serviceKey: '' }}
        thankYouRecapLabels={buildThankYouRecapLabels(thankYouModalContent)}
        onClose={() => {}}
        onSubmitReservation={() => {}}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(paymentModal.discountCodePlaceholder), {
      target: { value: 'SAVE10' },
    });
    fireEvent.click(screen.getByRole('button', { name: paymentModal.applyDiscountLabel }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(paymentModal.discountUnavailableLabel);
    });

    expect(mockedValidateDiscountCode).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
  });
});
