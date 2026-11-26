/* eslint-disable @next/next/no-img-element */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ContactUsForm,
  type ContactUsFormContactConfig,
} from '@/components/sections/contact-us-form';
import enContent from '@/content/en.json';
import { trackAnalyticsEvent, trackPublicFormOutcome } from '@/lib/analytics';
import { createPublicCrmApiClient } from '@/lib/crm-api-client';

const originalTurnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const defaultContactConfig: ContactUsFormContactConfig = {
  contactEmail: 'hello@example.com',
  whatsappUrl: 'https://wa.me/message/ZQHVW4DEORD5A1?src=qr',
  instagramUrl: 'https://www.instagram.com/evolvesprouts',
  linkedinUrl: 'https://www.linkedin.com/company/evolve-sprouts',
};

vi.mock('next/image', () => ({
  default: ({
    alt,
    ...props
  }: {
    alt?: string;
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

vi.mock('@/lib/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  trackPublicFormOutcome: vi.fn(),
  trackEcommerceEvent: vi.fn(),
}));

const mockedCreateCrmApiClient = vi.mocked(createPublicCrmApiClient);
const mockedTrackAnalyticsEvent = vi.mocked(trackAnalyticsEvent);
const mockedTrackPublicFormOutcome = vi.mocked(trackPublicFormOutcome);

function renderContactUsForm(
  contactConfig: ContactUsFormContactConfig = defaultContactConfig,
) {
  return render(
    <ContactUsForm
      content={enContent.contactUs.form}
      locale='en'
      contactConfig={contactConfig}
    />,
  );
}

describe('ContactUsForm section', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'test-turnstile-site-key';
  });

  afterEach(() => {
    mockedCreateCrmApiClient.mockReset();
    mockedCreateCrmApiClient.mockReturnValue(null);
    mockedTrackAnalyticsEvent.mockReset();
    mockedTrackPublicFormOutcome.mockReset();

    if (originalTurnstileSiteKey === undefined) {
      delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    } else {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalTurnstileSiteKey;
    }

  });

  it('does not render Turnstile until the user focuses a field', async () => {
    renderContactUsForm();

    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();

    fireEvent.focus(
      screen.getByLabelText(new RegExp(`^${enContent.contactUs.form.firstNameLabel}`)),
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-turnstile-captcha')).toBeInTheDocument();
    });
  });

  it('renders Turnstile after a typed field change', async () => {
    renderContactUsForm();

    expect(screen.queryByTestId('mock-turnstile-captcha')).toBeNull();

    fireEvent.change(
      screen.getByLabelText(new RegExp(`^${enContent.contactUs.form.firstNameLabel}`)),
      { target: { value: 'Pat' } },
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-turnstile-captcha')).toBeInTheDocument();
    });
  });

  it('removes mobile top padding while preserving responsive section spacing', () => {
    renderContactUsForm();

    const section = document.getElementById('contact-us-form');
    expect(section).not.toBeNull();
    expect(section?.className).toContain('pt-0');
    expect(section?.className).toContain('sm:pt-[60px]');
  });

  it('uses class-based decorative background styling on the section container', () => {
    renderContactUsForm();

    const sectionContainer = document.getElementById('contact-us-form');
    expect(sectionContainer).not.toBeNull();

    const decorativeLayer = sectionContainer?.querySelector(
      'div[aria-hidden="true"].es-contact-us-left-decor',
    ) as HTMLDivElement | null;
    expect(decorativeLayer).not.toBeNull();
    expect(decorativeLayer?.className).toContain('es-contact-us-left-decor');
    expect(decorativeLayer?.getAttribute('style')).toBeNull();
  });

  it('removes mobile top padding from the left content column', () => {
    renderContactUsForm();

    const splitLayout = document.querySelector(
      '#contact-us-form .es-section-split-layout--contact-us',
    ) as HTMLDivElement | null;
    expect(splitLayout).not.toBeNull();

    const leftColumn = splitLayout?.firstElementChild as HTMLDivElement | null;
    expect(leftColumn).not.toBeNull();
    expect(leftColumn?.className).toContain('pb-8');
    expect(leftColumn?.className).toContain('lg:pt-[25%]');
    expect(leftColumn?.className).not.toContain('py-8');
    expect(leftColumn?.className).not.toContain('pt-8');
    expect(leftColumn?.className).not.toContain('px-6');
    expect(leftColumn?.className).not.toContain('sm:px-8');
    expect(leftColumn?.className).not.toContain('lg:px-10');
  });

  it('renders WhatsApp contact CTA with the configured label and href', () => {
    renderContactUsForm();

    const contactMethodsBody = screen.getByText(
      enContent.contactUs.form.contactMethodsTitle,
    );
    expect(contactMethodsBody.className).toContain('es-section-body');
    expect(contactMethodsBody.className).toContain('text-[1.05rem]');
    expect(contactMethodsBody.className).toContain('leading-8');
    const whatsappCta = screen.getByRole('link', {
      name: enContent.contactUs.form.contactMethodLinks.whatsapp,
    });
    expect(whatsappCta).toHaveAttribute(
      'href',
      'https://wa.me/message/ZQHVW4DEORD5A1?src=qr',
    );
    expect(whatsappCta.className).toContain('es-btn');
    expect(whatsappCta.className).toContain('es-btn--primary');
    expect(whatsappCta.className).toContain('es-btn--whatsapp-cta');
    expect(whatsappCta.querySelector('img')).toHaveAttribute(
      'src',
      '/images/contact-whatsapp.svg',
    );

    fireEvent.click(whatsappCta);
    expect(mockedTrackAnalyticsEvent).toHaveBeenCalledWith('whatsapp_click', {
      sectionId: 'contact-us-form',
      ctaLocation: 'contact_section',
    });
  });

  it('omits the WhatsApp CTA when the provided contact URL is missing', () => {
    renderContactUsForm({
      contactEmail: defaultContactConfig.contactEmail,
      whatsappUrl: undefined,
      instagramUrl: undefined,
      linkedinUrl: undefined,
    });

    expect(
      screen.queryByRole('link', {
        name: enContent.contactUs.form.contactMethodLinks.whatsapp,
      }),
    ).toBeNull();
  });

  it('uses the same input styling pattern as the booking form', () => {
    renderContactUsForm();

    const firstNameInput = screen.getByLabelText(
      new RegExp(`^${enContent.contactUs.form.firstNameLabel}`),
    );
    const emailInput = screen.getByLabelText(
      new RegExp(enContent.contactUs.form.emailFieldLabel),
    );
    const phoneInput = screen.getByRole('textbox', {
      name: new RegExp(`^${enContent.contactUs.form.phoneLabel}`),
    });
    const messageInput = screen.getByLabelText(
      new RegExp(enContent.contactUs.form.messageLabel),
    );

    for (const input of [firstNameInput, emailInput, phoneInput, messageInput]) {
      expect(input.className).toContain('es-form-input');
    }
  });

  it('renders the form title heading above fields', () => {
    renderContactUsForm();

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: enContent.contactUs.form.formTitle,
      }),
    ).toBeInTheDocument();
  });

  it('renders form description text after the submit button', () => {
    renderContactUsForm();

    const submitButton = screen.getByRole('button', {
      name: enContent.contactUs.form.submitLabel,
    });
    const formElement = submitButton.closest('form');
    expect(formElement).toHaveAttribute('novalidate');
    expect(formElement).not.toBeNull();
    if (!formElement) {
      throw new Error('Expected contact form to exist');
    }
    expect(within(formElement).getByText(enContent.contactUs.form.formDescription))
      .toBeInTheDocument();
  });

  it('shows linked validation feedback for invalid email and phone values', () => {
    renderContactUsForm();

    const firstNameInput = screen.getByLabelText(
      new RegExp(`^${enContent.contactUs.form.firstNameLabel}`),
    );
    const emailInput = screen.getByLabelText(
      new RegExp(enContent.contactUs.form.emailFieldLabel),
    );
    const phoneInput = screen.getByRole('textbox', {
      name: new RegExp(`^${enContent.contactUs.form.phoneLabel}`),
    });
    const messageInput = screen.getByLabelText(
      new RegExp(enContent.contactUs.form.messageLabel),
    );
    const formElement = screen
      .getByRole('button', { name: enContent.contactUs.form.submitLabel })
      .closest('form');
    if (!formElement) {
      throw new Error('Expected contact form');
    }

    fireEvent.change(firstNameInput, { target: { value: 'Pat' } });
    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    fireEvent.blur(emailInput);
    fireEvent.change(phoneInput, { target: { value: '12' } });
    fireEvent.blur(phoneInput);
    fireEvent.change(messageInput, { target: { value: 'Hello.' } });
    fireEvent.submit(formElement);

    expect(
      screen.getByText(enContent.contactUs.form.emailValidationError),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enContent.contactUs.form.phoneInvalidForCountry),
    ).toBeInTheDocument();
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(phoneInput).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput).toHaveAttribute(
      'aria-describedby',
      'contact-us-form-email-error',
    );
    expect(phoneInput).toHaveAttribute(
      'aria-describedby',
      'contact-us-form-phone-error',
    );
    expect(mockedTrackPublicFormOutcome).toHaveBeenCalledWith(
      'contact_form_submit_error',
      expect.objectContaining({
        params: expect.objectContaining({
          error_type: 'validation_error',
        }),
      }),
    );
  });

  it('shows message required error when message is empty on submit', () => {
    renderContactUsForm();

    const firstNameInput = screen.getByLabelText(
      new RegExp(`^${enContent.contactUs.form.firstNameLabel}`),
    );
    const emailInput = screen.getByLabelText(
      new RegExp(enContent.contactUs.form.emailFieldLabel),
    );
    const messageInput = screen.getByLabelText(
      new RegExp(enContent.contactUs.form.messageLabel),
    );
    const formElement = screen
      .getByRole('button', { name: enContent.contactUs.form.submitLabel })
      .closest('form');
    if (!formElement) {
      throw new Error('Expected contact form');
    }

    fireEvent.change(firstNameInput, { target: { value: 'Pat' } });
    fireEvent.change(emailInput, { target: { value: 'parent@example.com' } });
    fireEvent.change(messageInput, { target: { value: '   ' } });
    fireEvent.submit(formElement);

    expect(
      screen.getByText(enContent.contactUs.form.messageRequiredError),
    ).toBeInTheDocument();
    expect(messageInput).toHaveAttribute('aria-invalid', 'true');
    expect(messageInput).toHaveAttribute(
      'aria-describedby',
      'contact-us-form-message-error',
    );
  });

  it('validates email only after blur instead of while typing', () => {
    renderContactUsForm();

    const emailInput = screen.getByLabelText(
      new RegExp(enContent.contactUs.form.emailFieldLabel),
    );

    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    expect(
      screen.queryByText(enContent.contactUs.form.emailValidationError),
    ).not.toBeInTheDocument();

    fireEvent.blur(emailInput);
    expect(
      screen.getByText(enContent.contactUs.form.emailValidationError),
    ).toBeInTheDocument();
  });

  it('requires CAPTCHA verification before form submission', () => {
    renderContactUsForm();

    const emailInput = screen.getByLabelText(
      new RegExp(enContent.contactUs.form.emailFieldLabel),
    );
    const messageInput = screen.getByLabelText(
      new RegExp(enContent.contactUs.form.messageLabel),
    );
    const submitButton = screen.getByRole('button', {
      name: enContent.contactUs.form.submitLabel,
    });

    fireEvent.change(
      screen.getByLabelText(new RegExp(`^${enContent.contactUs.form.firstNameLabel}`)),
      { target: { value: 'Pat' } },
    );
    fireEvent.change(emailInput, { target: { value: 'parent@example.com' } });
    fireEvent.change(messageInput, { target: { value: 'Tell me more about your course.' } });
    fireEvent.click(submitButton);

    expect(
      screen.getByText(enContent.contactUs.form.captchaRequiredError),
    ).toBeInTheDocument();
    expect(submitButton).toHaveAttribute(
      'aria-describedby',
      'contact-us-form-captcha-error',
    );

    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));

    expect(
      screen.queryByText(enContent.contactUs.form.captchaRequiredError),
    ).not.toBeInTheDocument();
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
    mockedCreateCrmApiClient.mockReturnValue({
      request,
    });

    renderContactUsForm();

    fireEvent.change(
      screen.getByLabelText(new RegExp(`^${enContent.contactUs.form.firstNameLabel}`)),
      { target: { value: 'Pat' } },
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.contactUs.form.emailFieldLabel)),
      { target: { value: 'parent@example.com' } },
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.contactUs.form.messageLabel)),
      { target: { value: 'Tell me more about your course.' } },
    );
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.contactUs.form.submitLabel,
      }),
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });

    const submitButton = screen.getByRole('button', {
      name: enContent.contactUs.form.submittingLabel,
    });
    expect(submitButton).toBeDisabled();
    const loadingGear = screen.getByTestId('contact-us-form-submit-loading-gear');
    expect(loadingGear).toHaveClass('animate-spin');
    expect(loadingGear.parentElement?.className).toContain('es-loading-gear-bubble');

    releaseRequest?.();
    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: enContent.contactUs.form.submitLabel,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(enContent.contactUs.form.submitErrorMessage),
      ).toBeInTheDocument();
    });
  });

  it('submits the validated form payload to the contact-us API endpoint', async () => {
    const request = vi.fn().mockResolvedValue(null);
    mockedCreateCrmApiClient.mockReturnValue({
      request,
    });

    renderContactUsForm();

    const firstNameInput = screen.getByLabelText(
      new RegExp(`^${enContent.contactUs.form.firstNameLabel}`),
    );
    const emailInput = screen.getByLabelText(
      new RegExp(enContent.contactUs.form.emailFieldLabel),
    );
    const phoneInput = screen.getByRole('textbox', {
      name: new RegExp(`^${enContent.contactUs.form.phoneLabel}`),
    });
    const messageInput = screen.getByLabelText(
      new RegExp(enContent.contactUs.form.messageLabel),
    );
    const submitButton = screen.getByRole('button', {
      name: enContent.contactUs.form.submitLabel,
    });

    fireEvent.change(firstNameInput, { target: { value: ' Ida ' } });
    fireEvent.change(emailInput, { target: { value: 'parent@example.com' } });
    fireEvent.change(phoneInput, { target: { value: '91234567' } });
    fireEvent.change(messageInput, { target: { value: ' Tell me more about your courses. ' } });
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith({
        endpointPath: '/v1/public/contact-us',
        method: 'POST',
        body: {
          first_name: 'Ida',
          email_address: 'parent@example.com',
          phone_country: 'HK',
          phone_number: '91234567',
          message: 'Tell me more about your courses.',
          marketing_opt_in: false,
          signup_intent: 'contact_inquiry',
          locale: 'en',
        },
        turnstileToken: 'mock-turnstile-token',
        expectedSuccessStatuses: [200, 202],
      });
      expect(
        screen.getByText(enContent.contactUs.form.successTitle),
      ).toBeInTheDocument();
      expect(
        screen.getByText(enContent.contactUs.form.successDescription),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', {
          name: enContent.contactUs.form.submitLabel,
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', {
          level: 2,
          name: enContent.contactUs.form.formTitle,
        }),
      ).not.toBeInTheDocument();
      const contactFormPanel = document.getElementById('contact-form');
      expect(contactFormPanel).not.toBeNull();
      expect(contactFormPanel?.className).toContain('flex');
      expect(contactFormPanel?.className).toContain('min-h-full');
      expect(contactFormPanel?.className).toContain('items-center');
      expect(contactFormPanel?.className).toContain('justify-center');
      expect(mockedTrackPublicFormOutcome).toHaveBeenCalledWith(
        'contact_form_submit_attempt',
        {
          formKind: 'contact',
          formId: 'contact-us-form',
          sectionId: 'contact-us-form',
          ctaLocation: 'form',
          params: {
            form_type: 'contact_us',
          },
        },
      );
      expect(mockedTrackPublicFormOutcome).toHaveBeenCalledWith(
        'contact_form_submit_success',
        {
          formKind: 'contact',
          formId: 'contact-us-form',
          sectionId: 'contact-us-form',
          ctaLocation: 'form',
          params: {
            form_type: 'contact_us',
          },
        },
      );
    });
  });

  it('shows an inline submit error under the button when submission fails', async () => {
    const request = vi.fn().mockRejectedValue(new Error('request failed'));
    mockedCreateCrmApiClient.mockReturnValue({
      request,
    });

    renderContactUsForm();

    fireEvent.change(
      screen.getByLabelText(new RegExp(`^${enContent.contactUs.form.firstNameLabel}`)),
      { target: { value: 'Pat' } },
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.contactUs.form.emailFieldLabel)),
      { target: { value: 'parent@example.com' } },
    );
    fireEvent.change(
      screen.getByLabelText(new RegExp(enContent.contactUs.form.messageLabel)),
      { target: { value: 'Tell me more about your course.' } },
    );
    fireEvent.click(screen.getByTestId('mock-turnstile-captcha-solve'));
    fireEvent.click(
      screen.getByRole('button', {
        name: enContent.contactUs.form.submitLabel,
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(enContent.contactUs.form.submitErrorMessage),
      ).toBeInTheDocument();
      expect(mockedTrackPublicFormOutcome).toHaveBeenCalledWith(
        'contact_form_submit_error',
        {
          formKind: 'contact',
          formId: 'contact-us-form',
          sectionId: 'contact-us-form',
          ctaLocation: 'form',
          params: {
            form_type: 'contact_us',
            error_type: 'api_error',
          },
        },
      );
    });
  });
});
