import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaForm } from '@/components/sections/media-form';
import enContent from '@/content/en.json';
import { FORM_PREFILL_STORAGE_KEY } from '@/lib/form-prefill';
import { trackPublicFormOutcome } from '@/lib/analytics';
import { createPublicCrmApiClient } from '@/lib/crm-api-client';

const originalTurnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

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

vi.mock('@/lib/analytics', () => ({
  trackPublicFormOutcome: vi.fn(),
  trackEcommerceEvent: vi.fn(),
}));

const mockedCreateCrmApiClient = vi.mocked(createPublicCrmApiClient);
const mockedTrackPublicFormOutcome = vi.mocked(trackPublicFormOutcome);

function mediaFormProps() {
  const resourcesContent = enContent.resources;
  return {
    ctaLabel: resourcesContent.ctaLabel,
    locale: 'en' as const,
    resourceKey: resourcesContent.resourceKey,
    formMarketingOptInLabel: resourcesContent.formMarketingOptInLabel,
    formFirstNameLabel: resourcesContent.formFirstNameLabel,
    formEmailLabel: resourcesContent.formEmailLabel,
    formFirstNameValidationMessage: resourcesContent.formFirstNameValidationMessage,
    formEmailValidationMessage: resourcesContent.formEmailValidationMessage,
    formSubmitLabel: resourcesContent.formSubmitLabel,
    formSubmittingLabel: resourcesContent.formSubmittingLabel,
    formSuccessMessage: resourcesContent.formSuccessMessage,
    formErrorMessage: resourcesContent.formErrorMessage,
    formCaptchaRequiredError: resourcesContent.formCaptchaRequiredError,
    formCaptchaLoadError: resourcesContent.formCaptchaLoadError,
    formCaptchaUnavailableError: resourcesContent.formCaptchaUnavailableError,
    formCaptchaLabel: resourcesContent.formCaptchaLabel,
  };
}

function renderMediaForm() {
  return render(<MediaForm {...mediaFormProps()} />);
}

describe('MediaForm', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'test-turnstile-site-key';
    sessionStorage.clear();
  });

  afterEach(() => {
    mockedCreateCrmApiClient.mockReset();
    mockedCreateCrmApiClient.mockReturnValue(null);
    mockedTrackPublicFormOutcome.mockReset();
    if (originalTurnstileSiteKey === undefined) {
      delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    } else {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalTurnstileSiteKey;
    }
    sessionStorage.clear();
  });

  it('tracks validation_error when submit runs with invalid fields', () => {
    mockedCreateCrmApiClient.mockReturnValue({ request: vi.fn() });
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.resources.formFirstNameLabel)),
      { target: { value: '' } },
    );
    fireEvent.change(screen.getByLabelText(new RegExp(enContent.resources.formEmailLabel)), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', { name: enContent.resources.formSubmitLabel }),
    );

    expect(mockedTrackPublicFormOutcome).toHaveBeenCalledWith('media_form_submit_attempt', {
      formKind: 'media_request',
      formId: 'media-form__media-form',
      sectionId: 'media-form',
      ctaLocation: 'form',
      params: {
        resource_key: 'patience-free-guide',
      },
    });
    expect(mockedTrackPublicFormOutcome).toHaveBeenCalledWith('media_form_submit_error', {
      formKind: 'media_request',
      formId: 'media-form__media-form',
      sectionId: 'media-form',
      ctaLocation: 'form',
      params: {
        resource_key: 'patience-free-guide',
        error_type: 'validation_error',
      },
    });
    expect(
      screen.getByText(enContent.resources.formFirstNameValidationMessage),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enContent.resources.formEmailValidationMessage),
    ).toBeInTheDocument();
    expect(screen.queryByText(enContent.resources.formErrorMessage)).toBeNull();
  });

  it('shows captcha-required error when token is missing', () => {
    mockedCreateCrmApiClient.mockReturnValue({ request: vi.fn() });
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.resources.formFirstNameLabel)),
      { target: { value: 'Ida' } },
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.resources.formEmailLabel)),
      { target: { value: 'ida@example.com' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: enContent.resources.formSubmitLabel }),
    );

    expect(
      screen.getByText(enContent.resources.formCaptchaRequiredError),
    ).toBeInTheDocument();
    expect(screen.queryByText(enContent.resources.formErrorMessage)).toBeNull();
  });

  it('renders the CTA button before the form opens', () => {
    renderMediaForm();

    expect(
      screen.getByRole('button', { name: enContent.resources.ctaLabel }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(new RegExp(enContent.resources.formFirstNameLabel)),
    ).not.toBeInTheDocument();
  });

  it('opens the form with empty fields when sessionStorage has no prefill data', () => {
    mockedCreateCrmApiClient.mockReturnValue({ request: vi.fn() });
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));

    expect(screen.getByLabelText(new RegExp(enContent.resources.formFirstNameLabel))).toHaveValue(
      '',
    );
    expect(screen.getByLabelText(new RegExp(enContent.resources.formEmailLabel))).toHaveValue('');
  });

  it('pre-fills first name and email from sessionStorage when CTA is clicked', () => {
    mockedCreateCrmApiClient.mockReturnValue({ request: vi.fn() });
    sessionStorage.setItem(
      FORM_PREFILL_STORAGE_KEY,
      JSON.stringify({ firstName: 'Alice', email: 'alice@example.com' }),
    );
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));

    expect(screen.getByLabelText(new RegExp(enContent.resources.formFirstNameLabel))).toHaveValue(
      'Alice',
    );
    expect(screen.getByLabelText(new RegExp(enContent.resources.formEmailLabel))).toHaveValue(
      'alice@example.com',
    );
  });

  it('does not pre-fill marketing opt-in from sessionStorage', () => {
    mockedCreateCrmApiClient.mockReturnValue({ request: vi.fn() });
    sessionStorage.setItem(
      FORM_PREFILL_STORAGE_KEY,
      JSON.stringify({ firstName: 'Alice', email: 'alice@example.com' }),
    );
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));

    const optIn = screen.getByRole('checkbox');
    expect(optIn).not.toBeChecked();
  });

  it('writes normalized prefill to sessionStorage after successful submit', async () => {
    const request = vi.fn().mockResolvedValue(null);
    mockedCreateCrmApiClient.mockReturnValue({ request });
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.resources.formFirstNameLabel)),
      { target: { value: ' Ida ' } },
    );
    fireEvent.change(screen.getByLabelText(new RegExp(enContent.resources.formEmailLabel)), {
      target: { value: 'IDA@Example.com' },
    });
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', { name: enContent.resources.formSubmitLabel }),
    );

    await waitFor(() => {
      expect(screen.getByText(enContent.resources.formSuccessMessage)).toBeInTheDocument();
    });

    expect(sessionStorage.getItem(FORM_PREFILL_STORAGE_KEY)).toBe(
      JSON.stringify({ firstName: 'Ida', email: 'ida@example.com' }),
    );
  });

  it('opens the form when CTA is clicked', () => {
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));

    expect(
      screen.getByLabelText(new RegExp(enContent.resources.formFirstNameLabel)),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(new RegExp(enContent.resources.formEmailLabel)),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();
    expect(mockedTrackPublicFormOutcome).toHaveBeenCalledWith('media_form_open', {
      formKind: 'media_request',
      formId: 'media-form__media-form',
      sectionId: 'media-form',
      ctaLocation: 'cta_button',
      params: {
        resource_key: 'patience-free-guide',
      },
    });
  });

  it('adds top spacing and fades in the form when CTA is clicked', async () => {
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));

    const firstNameInput = screen.getByLabelText(
      new RegExp(enContent.resources.formFirstNameLabel),
    );
    const form = firstNameInput.closest('form');
    if (!form) {
      throw new Error('Expected media form to render after CTA click');
    }
    expect(form).toHaveClass('mt-7');
    expect(form).toHaveClass('transition-opacity');
    expect(form).toHaveClass('duration-300');

    await waitFor(() => {
      expect(form).toHaveClass('opacity-100');
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
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.resources.formFirstNameLabel)),
      { target: { value: 'Ida' } },
    );
    fireEvent.change(screen.getByLabelText(new RegExp(enContent.resources.formEmailLabel)), {
      target: { value: 'ida@example.com' },
    });
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', { name: enContent.resources.formSubmitLabel }),
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });

    const submitButton = screen.getByRole('button', {
      name: enContent.resources.formSubmittingLabel,
    });
    expect(submitButton).toBeDisabled();
    const loadingGear = screen.getByTestId('media-form-submit-loading-gear');
    expect(loadingGear).toHaveClass('animate-spin');
    expect(loadingGear.parentElement?.className).toContain('es-loading-gear-bubble');

    releaseRequest?.();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: enContent.resources.formSubmitLabel }),
      ).toBeInTheDocument();
    });
  });

  it('submits valid payload and renders success message', async () => {
    const request = vi.fn().mockResolvedValue(null);
    mockedCreateCrmApiClient.mockReturnValue({ request });
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.resources.formFirstNameLabel)),
      { target: { value: ' Ida ' } },
    );
    fireEvent.change(screen.getByLabelText(new RegExp(enContent.resources.formEmailLabel)), {
      target: { value: 'IDA@Example.com' },
    });
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', { name: enContent.resources.formSubmitLabel }),
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith({
        endpointPath: '/v1/public/assets/free/request',
        method: 'POST',
        body: {
          first_name: 'Ida',
          email: 'ida@example.com',
          resource_key: 'patience-free-guide',
          marketing_opt_in: false,
          locale: 'en',
        },
        turnstileToken: 'mock-turnstile-token',
        expectedSuccessStatuses: [202],
      });
      expect(mockedTrackPublicFormOutcome).toHaveBeenCalledWith('media_form_submit_attempt', {
        formKind: 'media_request',
        formId: 'media-form__media-form',
        sectionId: 'media-form',
        ctaLocation: 'form',
        params: {
          resource_key: 'patience-free-guide',
        },
      });
      expect(mockedTrackPublicFormOutcome).toHaveBeenCalledWith('media_form_submit_success', {
        formKind: 'media_request',
        formId: 'media-form__media-form',
        sectionId: 'media-form',
        ctaLocation: 'form',
        params: {
          resource_key: 'patience-free-guide',
        },
      });
    });

    expect(
      screen.getByText(enContent.resources.formSuccessMessage),
    ).toBeInTheDocument();
  });

  it('shows submit error when API request fails', async () => {
    const request = vi.fn().mockRejectedValue(new Error('failed'));
    mockedCreateCrmApiClient.mockReturnValue({ request });
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.resources.formFirstNameLabel)),
      { target: { value: 'Ida' } },
    );
    fireEvent.change(screen.getByLabelText(new RegExp(enContent.resources.formEmailLabel)), {
      target: { value: 'ida@example.com' },
    });
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', { name: enContent.resources.formSubmitLabel }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(enContent.resources.formErrorMessage),
      ).toBeInTheDocument();
      expect(mockedTrackPublicFormOutcome).toHaveBeenCalledWith('media_form_submit_attempt', {
        formKind: 'media_request',
        formId: 'media-form__media-form',
        sectionId: 'media-form',
        ctaLocation: 'form',
        params: {
          resource_key: 'patience-free-guide',
        },
      });
      expect(mockedTrackPublicFormOutcome).toHaveBeenCalledWith('media_form_submit_error', {
        formKind: 'media_request',
        formId: 'media-form__media-form',
        sectionId: 'media-form',
        ctaLocation: 'form',
        params: {
          resource_key: 'patience-free-guide',
          error_type: 'api_error',
        },
      });
    });
  });

  it('does not render Turnstile after reveal CTA alone; mounts after field focus', async () => {
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));

    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();

    fireEvent.focus(
      screen.getByLabelText(new RegExp(enContent.resources.formFirstNameLabel)),
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-turnstile-captcha')).toBeInTheDocument();
    });
  });

  it('renders Turnstile after a typed field change once the form is visible', async () => {
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));

    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();

    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.resources.formFirstNameLabel)),
      { target: { value: 'Ida' } },
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-turnstile-captcha')).toBeInTheDocument();
    });
  });

  it('disables submit and shows error when CRM API client is unavailable', () => {
    mockedCreateCrmApiClient.mockReturnValue(null);
    renderMediaForm();

    fireEvent.click(screen.getByRole('button', { name: enContent.resources.ctaLabel }));

    const submitButton = screen.getByRole('button', { name: enContent.resources.formSubmitLabel });
    expect(submitButton).toBeDisabled();
    expect(screen.getByText(enContent.resources.formErrorMessage)).toBeInTheDocument();
  });

  it('shows success only on the MediaForm instance that submitted', async () => {
    const request = vi.fn().mockResolvedValue(null);
    mockedCreateCrmApiClient.mockReturnValue({ request });

    render(
      <>
        <MediaForm {...mediaFormProps()} analyticsSectionId='form-a' />
        <MediaForm {...mediaFormProps()} analyticsSectionId='form-b' />
      </>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: enContent.resources.ctaLabel })[0]);
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.resources.formFirstNameLabel)),
      { target: { value: 'Ida' } },
    );
    fireEvent.change(screen.getByLabelText(new RegExp(enContent.resources.formEmailLabel)), {
      target: { value: 'ida@example.com' },
    });
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', { name: enContent.resources.formSubmitLabel }),
    );

    await waitFor(() => {
      const messages = screen.getAllByText(enContent.resources.formSuccessMessage);
      expect(messages).toHaveLength(1);
    });

    expect(
      screen.getAllByRole('button', { name: enContent.resources.ctaLabel }),
    ).toHaveLength(1);
  });
});
