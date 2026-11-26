import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LandingPageFreeIntroCall } from '@/components/sections/landing-pages/landing-page-free-intro-call';
import enContent from '@/content/en.json';
import bookAFreeCall from '@/content/landing-pages/book-a-free-call.json';
import * as reservationsData from '@/lib/reservations-data';

vi.mock('@/lib/public-calendar-availability-api', () => ({
  CALENDAR_PUBLIC_CLIENT_FETCH_TIMEOUT_MS: 30000,
  fetchIntroCallSlots: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  trackPublicFormOutcome: vi.fn(),
  trackEcommerceEvent: vi.fn(),
}));

vi.mock('@/lib/meta-pixel', () => ({
  trackMetaPixelEvent: vi.fn(),
}));

const { fetchIntroCallSlots } = await import('@/lib/public-calendar-availability-api');

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

const submitReservationSpy = vi.spyOn(reservationsData, 'submitReservation');

afterEach(() => {
  vi.mocked(fetchIntroCallSlots).mockReset();
  submitReservationSpy.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('LandingPageFreeIntroCall', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.evolvesprouts.com/api');
    vi.stubEnv('NEXT_PUBLIC_WWW_CRM_API_KEY', 'test-www-crm-api-key');
    vi.stubEnv('NEXT_PUBLIC_WHATSAPP_URL', 'https://wa.me/85290000000');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'test-turnstile-site-key');
    vi.mocked(fetchIntroCallSlots).mockResolvedValue({
      slots: [
        { startIso: '2026-05-05T01:00:00.000Z', endIso: '2026-05-05T01:15:00.000Z' },
      ],
      fetchFailed: false,
    });
    submitReservationSpy.mockResolvedValue(undefined);
  });

  it('submits intro-call reservation when slot and fields are valid', async () => {
    render(
      <LandingPageFreeIntroCall
        locale='en'
        pageTitle={bookAFreeCall.en.meta.title}
        introContent={bookAFreeCall.en.introCall}
        paymentModalContent={enContent.bookingModal.paymentModal}
        commonAccessibility={enContent.common.accessibility}
        captchaContent={enContent.common.captcha}
        whatsappHref='https://wa.me/85290000000'
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '09:00' })).toBeInTheDocument();
    });

    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '09:00' }));

    const selectedSlotCard = screen.getByTestId('intro-call-selected-slot-card');
    expect(within(selectedSlotCard).getByText(bookAFreeCall.en.introCall.selectedSlotSummaryHeading))
      .toBeInTheDocument();
    expect(selectedSlotCard).toHaveTextContent('05 May @ 09:00');

    fireEvent.change(screen.getByLabelText(/Your name/i), {
      target: { value: 'Test Parent' },
    });
    fireEvent.change(screen.getByLabelText(/Your email/i), {
      target: { value: 'parent@example.com' },
    });

    const form = screen.getByRole('form', { name: bookAFreeCall.en.introCall.bookingSectionTitle });
    const terms = within(form).getByRole('checkbox', { name: /Terms/i });
    fireEvent.click(terms);

    await waitFor(() => {
      expect(screen.getByTestId('mock-turnstile-captcha')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));

    fireEvent.click(
      screen.getByRole('button', { name: bookAFreeCall.en.introCall.submitLabel }),
    );

    await waitFor(() => {
      expect(submitReservationSpy).toHaveBeenCalled();
    });

    const firstCall = submitReservationSpy.mock.calls[0];
    expect(firstCall?.[1]?.payload).toMatchObject({
      bookingSystem: 'intro-call-booking',
      serviceKey: 'intro-call',
      attendeeName: 'Test Parent',
      attendeeEmail: 'parent@example.com',
      primarySessionStartIso: '2026-05-05T01:00:00.000Z',
      primarySessionEndIso: '2026-05-05T01:15:00.000Z',
      totalAmount: 0,
      paymentMethod: 'free',
    });
    expect(
      (firstCall?.[1]?.payload as { serviceInstanceSlug?: string }).serviceInstanceSlug,
    ).toBeUndefined();
    expect(firstCall?.[1]?.turnstileToken).toBe('mock-turnstile-token');

    expect(screen.getByRole('heading', { name: bookAFreeCall.en.introCall.thankYouTitle }))
      .toBeInTheDocument();
  });

  it('disables submit while the reservation request is pending', async () => {
    let resolveSubmit: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    submitReservationSpy.mockReturnValue(pending as unknown as Promise<void>);

    render(
      <LandingPageFreeIntroCall
        locale='en'
        pageTitle={bookAFreeCall.en.meta.title}
        introContent={bookAFreeCall.en.introCall}
        paymentModalContent={enContent.bookingModal.paymentModal}
        commonAccessibility={enContent.common.accessibility}
        captchaContent={enContent.common.captcha}
        whatsappHref='https://wa.me/85290000000'
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '09:00' })).toBeInTheDocument();
    });

    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '09:00' }));

    await waitFor(() => {
      expect(screen.getByTestId('mock-turnstile-captcha')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Your name/i), {
      target: { value: 'Test Parent' },
    });
    fireEvent.change(screen.getByLabelText(/Your email/i), {
      target: { value: 'parent@example.com' },
    });

    const form = screen.getByRole('form', { name: bookAFreeCall.en.introCall.bookingSectionTitle });
    const terms = within(form).getByRole('checkbox', { name: /Terms/i });
    fireEvent.click(terms);

    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));

    const submitButton = screen.getByRole('button', { name: bookAFreeCall.en.introCall.submitLabel });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });

    resolveSubmit?.();
    await waitFor(() => {
      expect(submitReservationSpy).toHaveBeenCalled();
    });
    expect(
      screen.getByRole('heading', { name: bookAFreeCall.en.introCall.thankYouTitle }),
    ).toBeInTheDocument();
  });
});
