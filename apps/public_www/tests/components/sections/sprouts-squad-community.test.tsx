/* eslint-disable @next/next/no-img-element */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SproutsSquadCommunity } from '@/components/sections/sprouts-squad-community';
import enContent from '@/content/en.json';
import { FORM_PREFILL_STORAGE_KEY } from '@/lib/form-prefill';
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

describe('SproutsSquadCommunity section', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'test-turnstile-site-key';
    sessionStorage.clear();
  });

  afterEach(() => {
    mockedCreateCrmApiClient.mockReset();
    mockedCreateCrmApiClient.mockReturnValue(null);
    if (originalTurnstileSiteKey === undefined) {
      delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    } else {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalTurnstileSiteKey;
    }
    sessionStorage.clear();
  });

  it('uses migrated section/overlay/logo classes and renders CTA-first state', () => {
    const { container } = render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    const section = screen.getByRole('region', {
      name: enContent.sproutsSquadCommunity.title,
    });
    expect(section.className).toContain('es-sprouts-community-section');

    expect(container.querySelector('.es-sprouts-community-overlay')).not.toBeNull();
    const sectionLogo = container.querySelector('img.es-sprouts-community-logo');
    expect(sectionLogo).not.toBeNull();
    expect(sectionLogo?.className).toContain('hidden');
    expect(sectionLogo?.className).toContain('sm:block');
    expect(
      container.querySelector('img[src="/images/footer-community-bg.webp"]'),
    ).toBeNull();
    expect(
      container.querySelector('.es-section-header')?.className,
    ).toContain('es-section-header--left');
    expect(
      container.querySelector('.es-section-header')?.className,
    ).toContain('mt-[75px]');
    expect(
      container.querySelector('.es-section-header')?.className,
    ).toContain('sm:mt-0');

    const heading = screen.getByRole('heading', {
      level: 2,
      name: enContent.sproutsSquadCommunity.title,
    });
    expect(heading.className).toContain('es-sprouts-community-heading');

    const supportParagraph = screen.getByText((_, element) => {
      if (!element) {
        return false;
      }

      return (
        element.classList.contains('es-sprouts-community-support-paragraph') &&
        element.textContent === enContent.sproutsSquadCommunity.description
      );
    });
    expect(supportParagraph.className).toContain(
      'es-sprouts-community-support-paragraph',
    );

    const initialCtaButton = screen.getByRole('button', {
      name: enContent.sproutsSquadCommunity.ctaLabel,
    });
    expect(initialCtaButton).toBeInTheDocument();
    expect(initialCtaButton.closest('form')).toHaveAttribute('novalidate');
    expect(
      screen.queryByLabelText(new RegExp(enContent.sproutsSquadCommunity.emailLabel)),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: enContent.sproutsSquadCommunity.ctaLabel }),
    ).not.toBeInTheDocument();
  });

  it('reveals email input after initial CTA click without mounting Turnstile yet', () => {
    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );

    const emailField = screen.getByLabelText(
      new RegExp(enContent.sproutsSquadCommunity.emailLabel),
    );
    expect(emailField).toBeInTheDocument();
    expect(emailField.closest('form')).toHaveClass('gap-3');
    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();
    expect(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.formSubmitLabel,
      }),
    ).toBeInTheDocument();
  });

  it('does not render Turnstile after reveal CTA alone; mounts after field focus', async () => {
    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );

    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();

    fireEvent.focus(
      screen.getByLabelText(new RegExp(enContent.sproutsSquadCommunity.emailLabel)),
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-turnstile-captcha')).toBeInTheDocument();
    });
  });

  it('renders Turnstile after email field change once the form is visible', async () => {
    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );

    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();

    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.sproutsSquadCommunity.emailLabel)),
      { target: { value: 'a@b.co' } },
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-turnstile-captcha')).toBeInTheDocument();
    });
  });

  it('opens with empty email when sessionStorage has no prefill data', () => {
    mockedCreateCrmApiClient.mockReturnValue({ request: vi.fn() });
    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );

    expect(
      screen.getByLabelText(new RegExp(enContent.sproutsSquadCommunity.emailLabel)),
    ).toHaveValue('');
  });

  it('pre-fills email from sessionStorage when CTA is clicked', () => {
    mockedCreateCrmApiClient.mockReturnValue({ request: vi.fn() });
    sessionStorage.setItem(
      FORM_PREFILL_STORAGE_KEY,
      JSON.stringify({ firstName: 'Alice', email: 'alice@example.com' }),
    );
    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );

    expect(
      screen.getByLabelText(new RegExp(enContent.sproutsSquadCommunity.emailLabel)),
    ).toHaveValue('alice@example.com');
  });

  it('writes lowercased email to sessionStorage after successful submit', async () => {
    const request = vi.fn().mockResolvedValue(null);
    mockedCreateCrmApiClient.mockReturnValue({ request });

    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.sproutsSquadCommunity.emailLabel)),
      { target: { value: 'Community@Example.com' } },
    );
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.formSubmitLabel,
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(enContent.sproutsSquadCommunity.successMessage),
      ).toBeInTheDocument();
    });

    expect(sessionStorage.getItem(FORM_PREFILL_STORAGE_KEY)).toBe(
      JSON.stringify({ firstName: '', email: 'community@example.com' }),
    );
  });

  it('preserves stored firstName when sprouts squad writes email only', async () => {
    const request = vi.fn().mockResolvedValue(null);
    mockedCreateCrmApiClient.mockReturnValue({ request });
    sessionStorage.setItem(
      FORM_PREFILL_STORAGE_KEY,
      JSON.stringify({ firstName: 'Alice', email: 'old@example.com' }),
    );

    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.sproutsSquadCommunity.emailLabel)),
      { target: { value: 'newuser@example.com' } },
    );
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.formSubmitLabel,
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(enContent.sproutsSquadCommunity.successMessage),
      ).toBeInTheDocument();
    });

    expect(sessionStorage.getItem(FORM_PREFILL_STORAGE_KEY)).toBe(
      JSON.stringify({ firstName: 'Alice', email: 'newuser@example.com' }),
    );
  });

  it('fades in revealed fields after the initial CTA click', async () => {
    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );

    const emailInput = screen.getByLabelText(
      new RegExp(enContent.sproutsSquadCommunity.emailLabel),
    );
    const form = emailInput.closest('form');
    if (!form) {
      throw new Error('Expected sprouts community form to render after CTA click');
    }
    expect(form).toHaveClass('transition-opacity');
    expect(form).toHaveClass('duration-300');

    await waitFor(() => {
      expect(form).toHaveClass('opacity-100');
    });
  });

  it('shows email validation error when form submit is clicked with empty email', () => {
    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );

    const emailInput = screen.getByLabelText(
      new RegExp(enContent.sproutsSquadCommunity.emailLabel),
    );
    const submitButton = screen.getByRole('button', {
      name: enContent.sproutsSquadCommunity.formSubmitLabel,
    });

    fireEvent.click(submitButton);

    expect(
      screen.getByText(enContent.sproutsSquadCommunity.emailValidationMessage),
    ).toBeInTheDocument();
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput).toHaveAttribute(
      'aria-describedby',
      'sprouts-community-email-error',
    );
  });

  it('shows email validation error for invalid email after CTA reveal', () => {
    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );

    const emailInput = screen.getByLabelText(
      new RegExp(enContent.sproutsSquadCommunity.emailLabel),
    );
    const submitButton = screen.getByRole('button', {
      name: enContent.sproutsSquadCommunity.formSubmitLabel,
    });

    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    fireEvent.blur(emailInput);
    fireEvent.click(submitButton);

    expect(
      screen.getByText(enContent.sproutsSquadCommunity.emailValidationMessage),
    ).toBeInTheDocument();
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput).toHaveAttribute(
      'aria-describedby',
      'sprouts-community-email-error',
    );
  });

  it('shows captcha-required error when token is missing', async () => {
    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.sproutsSquadCommunity.emailLabel)),
      { target: { value: 'community@example.com' } },
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.formSubmitLabel,
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(enContent.sproutsSquadCommunity.captchaRequiredError),
      ).toBeInTheDocument();
    });
    const submitButton = screen.getByRole('button', {
      name: enContent.sproutsSquadCommunity.formSubmitLabel,
    });
    expect(submitButton).toHaveAttribute(
      'aria-describedby',
      'sprouts-community-captcha-error',
    );
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
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.sproutsSquadCommunity.emailLabel)),
      { target: { value: 'community@example.com' } },
    );
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.formSubmitLabel,
      }),
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });

    const submitButton = screen.getByRole('button', {
      name: enContent.common.formActions.submittingLabel,
    });
    expect(submitButton).toBeDisabled();
    const loadingGear = screen.getByTestId('sprouts-squad-community-submit-loading-gear');
    expect(loadingGear).toHaveClass('animate-spin');
    expect(loadingGear.parentElement?.className).toContain('es-loading-gear-bubble');

    releaseRequest?.();
    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: enContent.sproutsSquadCommunity.formSubmitLabel,
        }),
      ).toBeInTheDocument();
    });
  });

  it('submits payload with turnstile token and shows success state', async () => {
    const request = vi.fn().mockResolvedValue(null);
    mockedCreateCrmApiClient.mockReturnValue({ request });

    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.sproutsSquadCommunity.emailLabel)),
      { target: { value: 'community@example.com' } },
    );
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.formSubmitLabel,
      }),
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith({
        endpointPath: '/v1/public/contact-us',
        method: 'POST',
        body: {
          email_address: 'community@example.com',
          first_name: 'Community',
          message: enContent.sproutsSquadCommunity.prefilledMessage,
          marketing_opt_in: true,
          locale: 'en',
          signup_intent: 'community_newsletter',
        },
        turnstileToken: 'mock-turnstile-token',
        expectedSuccessStatuses: [200, 202],
      });
      expect(
        screen.getByText(enContent.sproutsSquadCommunity.successMessage),
      ).toBeInTheDocument();
    });
  });

  it('shows submit error when API request fails', async () => {
    const request = vi.fn().mockRejectedValue(new Error('request failed'));
    mockedCreateCrmApiClient.mockReturnValue({ request });

    render(
      <SproutsSquadCommunity
        content={enContent.sproutsSquadCommunity}
        commonCaptchaContent={enContent.common.captcha}
        commonFormActionsContent={enContent.common.formActions}
        locale='en'
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.ctaLabel,
      }),
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.sproutsSquadCommunity.emailLabel)),
      { target: { value: 'community@example.com' } },
    );
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.sproutsSquadCommunity.formSubmitLabel,
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(enContent.sproutsSquadCommunity.submitErrorMessage),
      ).toBeInTheDocument();
    });
    const submitButton = screen.getByRole('button', {
      name: enContent.sproutsSquadCommunity.formSubmitLabel,
    });
    expect(submitButton).toHaveAttribute(
      'aria-describedby',
      'sprouts-community-submit-error',
    );
  });
});
