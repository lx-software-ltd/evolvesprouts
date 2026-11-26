/* eslint-disable @next/next/no-img-element */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventNotification } from '@/components/sections/event-notification';
import enContent from '@/content/en.json';
import { createPublicCrmApiClient } from '@/lib/crm-api-client';

const originalTurnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

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

vi.mock('@/components/shared/turnstile-captcha', () => ({
  TurnstileCaptcha: ({
    onTokenChange,
    onLoadError,
  }: {
    onTokenChange: (token: string | null) => void;
    onLoadError: () => void;
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
      <button
        data-testid='mock-turnstile-captcha-fail'
        type='button'
        onClick={() => {
          onLoadError();
        }}
      >
        Fail CAPTCHA
      </button>
    </div>
  ),
}));

vi.mock('@/lib/crm-api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crm-api-client')>(
    '@/lib/crm-api-client',
  );

  return {
    ...actual,
    createPublicCrmApiClient: vi.fn(() => null),
  };
});

const mockedCreateCrmApiClient = vi.mocked(createPublicCrmApiClient);

describe('EventNotification section', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'test-turnstile-site-key';
  });

  afterEach(() => {
    mockedCreateCrmApiClient.mockReset();
    mockedCreateCrmApiClient.mockReturnValue(null);
    if (originalTurnstileSiteKey === undefined) {
      delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    } else {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalTurnstileSiteKey;
    }
  });

  it('renders event notification section in CTA-first state', () => {
    const { container } = render(
      <EventNotification
        content={enContent.events.notification}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    const section = screen.getByRole('region', {
      name: enContent.events.notification.title,
    });
    expect(section.className).toContain('es-event-notification-section');
    expect(container.querySelector('img.es-event-notification-logo')).toBeNull();
    expect(
      screen.getByRole('button', {
        name: enContent.events.notification.ctaLabel,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(new RegExp(enContent.events.notification.emailLabel)),
    ).not.toBeInTheDocument();
  });

  it('reveals email input after initial CTA click without mounting Turnstile yet', () => {
    render(
      <EventNotification
        content={enContent.events.notification}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.events.notification.ctaLabel,
      }),
    );

    expect(
      screen.getByLabelText(new RegExp(enContent.events.notification.emailLabel)),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();
    expect(
      screen.getByRole('button', {
        name: enContent.events.notification.formSubmitLabel,
      }),
    ).toBeInTheDocument();
  });

  it('does not render Turnstile after reveal CTA alone; mounts after field focus', async () => {
    render(
      <EventNotification
        content={enContent.events.notification}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.events.notification.ctaLabel,
      }),
    );

    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();

    fireEvent.focus(
      screen.getByLabelText(new RegExp(enContent.events.notification.emailLabel)),
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-turnstile-captcha')).toBeInTheDocument();
    });
  });

  it('renders Turnstile after email field change once the form is visible', async () => {
    render(
      <EventNotification
        content={enContent.events.notification}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.events.notification.ctaLabel,
      }),
    );

    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();

    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.events.notification.emailLabel)),
      { target: { value: 'events@example.com' } },
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-turnstile-captcha')).toBeInTheDocument();
    });
  });

  it('shows the loading gear on the submit button while the request is in flight', async () => {
    let releaseRequest: (() => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          releaseRequest = () => {
            reject(new Error('deferred failure'));
          };
        }),
    );
    mockedCreateCrmApiClient.mockReturnValue({ request });

    render(
      <EventNotification
        content={enContent.events.notification}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.events.notification.ctaLabel,
      }),
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.events.notification.emailLabel)),
      { target: { value: 'events@example.com' } },
    );
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.events.notification.formSubmitLabel,
      }),
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });

    const submitButton = screen.getByRole('button', {
      name: enContent.common.formActions.submittingLabel,
    });
    expect(submitButton).toBeDisabled();
    const loadingGear = screen.getByTestId('event-notification-submit-loading-gear');
    expect(loadingGear).toHaveClass('animate-spin');
    expect(loadingGear.parentElement?.className).toContain('es-loading-gear-bubble');

    releaseRequest?.();
    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: enContent.events.notification.formSubmitLabel,
        }),
      ).toBeInTheDocument();
    });
  });

  it('submits payload with turnstile token and shows success state', async () => {
    const request = vi.fn().mockResolvedValue(null);
    mockedCreateCrmApiClient.mockReturnValue({ request });

    render(
      <EventNotification
        content={enContent.events.notification}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.events.notification.ctaLabel,
      }),
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.events.notification.emailLabel)),
      { target: { value: 'events@example.com' } },
    );
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.events.notification.formSubmitLabel,
      }),
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith({
        endpointPath: '/v1/public/contact-us',
        method: 'POST',
        body: {
          email_address: 'events@example.com',
          first_name: 'Events',
          message: enContent.events.notification.prefilledMessage,
          marketing_opt_in: true,
          locale: 'en',
          signup_intent: 'event_notification',
        },
        turnstileToken: 'mock-turnstile-token',
        expectedSuccessStatuses: [200, 202],
      });
      expect(
        screen.getByText(enContent.events.notification.successMessage),
      ).toBeInTheDocument();
    });
  });

});
