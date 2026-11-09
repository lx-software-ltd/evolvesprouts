/* eslint-disable @next/next/no-img-element */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { ConsultationBookingModal } from '@/components/sections/consultations/consultation-booking-modal';
import { buildThankYouRecapLabels } from '@/components/sections/booking-modal/thank-you-recap-labels';
import enContent from '@/content/en.json';
import { buildConsultationsBookingModalPayload } from '@/lib/consultations-booking-modal-payload';
import { createPublicCrmApiClient } from '@/lib/crm-api-client';
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

function buildPickerContent(
  paymentModal: typeof enContent.bookingModal.paymentModal,
) {
  const p = paymentModal.consultationPicker;
  return {
    pickDateTimeIntro: p.pickDateTimeIntro,
    amLabel: p.amLabel,
    pmLabel: p.pmLabel,
    monthJoiner: p.monthJoiner,
    weekdayShortLabels: [
      p.weekdayShortMon,
      p.weekdayShortTue,
      p.weekdayShortWed,
      p.weekdayShortThu,
      p.weekdayShortFri,
    ] as [string, string, string, string, string],
    datePickerLegend: p.datePickerLegend,
    datePickerDayTemplate: p.datePickerDayTemplate,
    datePickerUnavailableDayTemplate: p.datePickerUnavailableDayTemplate,
    datePickerLoadingDayTemplate: p.datePickerLoadingDayTemplate,
    dateConfirmationNote: p.dateConfirmationNote,
  };
}

describe('ConsultationBookingModal free price', () => {
  const paymentModal = enContent.bookingModal.paymentModal;
  const thankYouModalContent = enContent.bookingModal.thankYouModal;

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
    vi.mocked(createPublicCrmApiClient).mockReturnValue(null);
    vi.mocked(submitReservation).mockClear();
    vi.clearAllMocks();
  });

  it('submits paymentMethod free when consultation tier price is 0', async () => {
    const requestSpy = vi.fn().mockResolvedValue({ message: 'ok' });
    vi.mocked(createPublicCrmApiClient).mockReturnValue({ request: requestSpy });

    const baseReservation = enContent.consultations.booking.reservation;
    const freeReservation = {
      ...baseReservation,
      essentials: {
        ...baseReservation.essentials,
        priceHkd: 0,
      },
    };
    const topicsLabel = freeReservation.topicsField.label;
    const bookingPayload = buildConsultationsBookingModalPayload(freeReservation, 'en');

    render(
      <ConsultationBookingModal
        locale='en'
        paymentModalContent={paymentModal}
        bookingPayload={bookingPayload}
        pickerContent={buildPickerContent(paymentModal)}
        calendarAvailability={{ unavailable_slots: [] }}
        thankYouRecapLabels={buildThankYouRecapLabels(thankYouModalContent)}
        onClose={() => {}}
        onSubmitReservation={() => {}}
      />,
    );

    expect(document.querySelector('div[data-booking-payment="true"]')).toBeNull();

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
    fireEvent.change(screen.getByLabelText(new RegExp(topicsLabel)), {
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
      expect(vi.mocked(submitReservation)).toHaveBeenCalled();
    });

    expect(vi.mocked(submitReservation)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          paymentMethod: 'free',
          totalAmount: 0,
          serviceKey: 'family-consultation-essentials',
        }),
      }),
    );
    const submitted = vi.mocked(submitReservation).mock.calls[0]?.[1]?.payload as {
      serviceInstanceSlug?: string;
    };
    expect(submitted.serviceInstanceSlug).toBeUndefined();
  });
});
