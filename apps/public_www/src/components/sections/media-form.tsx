'use client';

import type { FormEvent } from 'react';
import { useEffect, useId, useMemo, useState } from 'react';

import { ButtonPrimitive } from '@/components/shared/button-primitive';
import {
  SubmitButtonLoadingContent,
  submitButtonClassName,
} from '@/components/shared/submit-button-loading-content';
import { MarketingOptInCheckbox } from '@/components/shared/marketing-opt-in-checkbox';
import { TurnstileCaptcha } from '@/components/shared/turnstile-captcha';
import { useFormInteractionGate } from '@/components/sections/shared/use-form-interaction';
import {
  resolveCaptchaErrorMessage,
  useFormSubmission,
} from '@/components/sections/shared/use-form-submission';
import { trackPublicFormOutcome } from '@/lib/analytics';
import { trackMetaPixelEvent } from '@/lib/meta-pixel';
import { PIXEL_CONTENT_NAME } from '@/lib/meta-pixel-taxonomy';
import { mergeClassNames } from '@/lib/class-name-utils';
import { createPublicCrmApiClient } from '@/lib/crm-api-client';
import { readFormPrefill, writeFormPrefill } from '@/lib/form-prefill';
import { ServerSubmissionResult } from '@/lib/server-submission-result';
import { isValidEmail, sanitizeSingleLineValue } from '@/lib/validation';
import type { Locale } from '@/content';

interface MediaFormProps {
  ctaLabel: string;
  locale: Locale;
  formMarketingOptInLabel: string;
  formFirstNameLabel: string;
  formEmailLabel: string;
  formFirstNameValidationMessage: string;
  formEmailValidationMessage: string;
  formSubmitLabel: string;
  formSubmittingLabel: string;
  formSuccessMessage: string;
  formErrorMessage: string;
  formCaptchaRequiredError: string;
  formCaptchaLoadError: string;
  formCaptchaUnavailableError: string;
  formCaptchaLabel: string;
  resourceKey?: string;
  className?: string;
  /** Extra classes for the closed-state CTA (e.g. `es-btn--outline` for primary outline). */
  ctaButtonClassName?: string;
  analyticsSectionId?: string;
  onFormOpened?: () => void;
}

const MEDIA_REQUEST_API_PATH = '/v1/public/assets/free/request';
const MAX_RESOURCE_KEY_LENGTH = 64;

function normalizeResourceKey(value: string): string {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, MAX_RESOURCE_KEY_LENGTH)
    .replaceAll(/-+$/g, '');
  return slug;
}

export function MediaForm({
  ctaLabel,
  locale,
  formMarketingOptInLabel,
  formFirstNameLabel,
  formEmailLabel,
  formFirstNameValidationMessage,
  formEmailValidationMessage,
  formSubmitLabel,
  formSubmittingLabel,
  formSuccessMessage,
  formErrorMessage,
  formCaptchaRequiredError,
  formCaptchaLoadError,
  formCaptchaUnavailableError,
  formCaptchaLabel,
  resourceKey,
  className,
  ctaButtonClassName,
  analyticsSectionId = 'media-form',
  onFormOpened,
}: MediaFormProps) {
  const mediaFormInstanceId = useId();
  const firstNameInputId = `${mediaFormInstanceId}-media-first-name`;
  const emailInputId = `${mediaFormInstanceId}-media-email`;
  const firstNameErrorId = `${mediaFormInstanceId}-media-first-name-error`;
  const emailErrorId = `${mediaFormInstanceId}-media-email-error`;
  const formErrorId = `${mediaFormInstanceId}-media-form-error`;
  const captchaErrorId = `${mediaFormInstanceId}-media-captcha-error`;

  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
  const crmApiClient = useMemo(() => createPublicCrmApiClient(), []);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [isFormFadingIn, setIsFormFadingIn] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [isEmailTouched, setIsEmailTouched] = useState(false);
  const [isFirstNameTouched, setIsFirstNameTouched] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const {
    captchaToken,
    clearSubmissionError,
    handleCaptchaLoadError,
    handleCaptchaTokenChange,
    hasCaptchaLoadError,
    hasCaptchaValidationError,
    hasSuccessfulSubmission,
    isCaptchaConfigured,
    isCaptchaUnavailable,
    isSubmitting,
    markCaptchaTouched,
    markSubmissionSuccess,
    setSubmissionError,
    submitErrorMessage,
    withSubmitting,
  } = useFormSubmission({
    turnstileSiteKey,
  });
  const { hasFormInteracted, markFormInteracted, formInteractionProps } =
    useFormInteractionGate();
  const isServiceUnavailable = !crmApiClient || isCaptchaUnavailable;
  const hasFirstNameError = isFirstNameTouched && !sanitizeSingleLineValue(firstName);
  const hasEmailError = isEmailTouched && !isValidEmail(email);
  const isSubmitDisabled = isSubmitting || isServiceUnavailable;
  const captchaErrorMessage = resolveCaptchaErrorMessage(
    {
      isCaptchaConfigured,
      hasCaptchaLoadError,
      hasCaptchaValidationError,
    },
    {
      requiredError: formCaptchaRequiredError,
      loadError: formCaptchaLoadError,
      unavailableError: formCaptchaUnavailableError,
    },
  );
  const shouldShowFormLevelError =
    Boolean(submitErrorMessage) ||
    (isServiceUnavailable && !captchaErrorMessage);

  const firstNameDescribedBy = hasFirstNameError ? firstNameErrorId : undefined;
  const emailDescribedBy = hasEmailError ? emailErrorId : undefined;
  const submitButtonDescribedByParts = [
    captchaErrorMessage ? captchaErrorId : null,
    shouldShowFormLevelError ? formErrorId : null,
    hasFirstNameError ? firstNameErrorId : null,
    hasEmailError ? emailErrorId : null,
  ].filter((id): id is string => id !== null);
  const submitButtonDescribedBy =
    submitButtonDescribedByParts.length > 0
      ? submitButtonDescribedByParts.join(' ')
      : undefined;

  useEffect(() => {
    if (!isFormVisible) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      setIsFormFadingIn(true);
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [isFormVisible]);

  const mediaFormAnalyticsId = `media-form__${analyticsSectionId}`;

  function handleOpenForm() {
    const prefill = readFormPrefill();
    setFirstName(prefill.firstName);
    setEmail(prefill.email);
    setIsFormFadingIn(false);
    setIsFormVisible(true);
    trackPublicFormOutcome('media_form_open', {
      formKind: 'media_request',
      formId: mediaFormAnalyticsId,
      sectionId: analyticsSectionId,
      ctaLocation: 'cta_button',
      params: {
        resource_key: normalizeResourceKey(resourceKey ?? ''),
      },
    });
    onFormOpened?.();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearSubmissionError();
    setIsFirstNameTouched(true);
    setIsEmailTouched(true);
    markCaptchaTouched();
    markFormInteracted();

    const normalizedResourceKey = normalizeResourceKey(resourceKey ?? '');
    trackPublicFormOutcome('media_form_submit_attempt', {
      formKind: 'media_request',
      formId: mediaFormAnalyticsId,
      sectionId: analyticsSectionId,
      ctaLocation: 'form',
      params: {
        resource_key: normalizedResourceKey,
      },
    });

    const normalizedFirstName = sanitizeSingleLineValue(firstName);
    const normalizedEmail = sanitizeSingleLineValue(email).toLowerCase();
    if (!normalizedFirstName || !isValidEmail(normalizedEmail) || !captchaToken) {
      trackPublicFormOutcome('media_form_submit_error', {
        formKind: 'media_request',
        formId: mediaFormAnalyticsId,
        sectionId: analyticsSectionId,
        ctaLocation: 'form',
        params: {
          resource_key: normalizedResourceKey,
          error_type: 'validation_error',
        },
      });
      return;
    }
    if (isServiceUnavailable) {
      trackPublicFormOutcome('media_form_submit_error', {
        formKind: 'media_request',
        formId: mediaFormAnalyticsId,
        sectionId: analyticsSectionId,
        ctaLocation: 'form',
        params: {
          resource_key: normalizedResourceKey,
          error_type: 'service_unavailable',
        },
      });
      setSubmissionError(formErrorMessage);
      return;
    }

    await withSubmitting(async () => {
      const requestBody: Record<string, string | boolean> = {
        first_name: normalizedFirstName,
        email: normalizedEmail,
        marketing_opt_in: marketingOptIn,
        locale,
      };
      if (normalizedResourceKey) {
        requestBody.resource_key = normalizedResourceKey;
      }

      const submissionResult = await ServerSubmissionResult.resolve({
        request: () =>
          crmApiClient.request({
            endpointPath: MEDIA_REQUEST_API_PATH,
            method: 'POST',
            body: requestBody,
            turnstileToken: captchaToken,
            expectedSuccessStatuses: [202],
          }),
        failureMessage: formErrorMessage,
      });
      if (submissionResult.isSuccess) {
        trackPublicFormOutcome('media_form_submit_success', {
          formKind: 'media_request',
          formId: mediaFormAnalyticsId,
          sectionId: analyticsSectionId,
          ctaLocation: 'form',
          params: {
            resource_key: normalizedResourceKey,
          },
        });
        trackMetaPixelEvent('Lead', { content_name: PIXEL_CONTENT_NAME.media_download });
        markSubmissionSuccess();
        writeFormPrefill({ firstName: normalizedFirstName, email: normalizedEmail });
        return;
      }

      trackPublicFormOutcome('media_form_submit_error', {
        formKind: 'media_request',
        formId: mediaFormAnalyticsId,
        sectionId: analyticsSectionId,
        ctaLocation: 'form',
        params: {
          resource_key: normalizedResourceKey,
          error_type: 'api_error',
        },
      });
      setSubmissionError(submissionResult.errorMessage);
    });
  }

  if (hasSuccessfulSubmission) {
    return (
      <div className={className}>
        <div className='es-public-form-success-panel mt-3 w-full max-w-[420px]'>
          <p className='es-public-form-success-panel-message'>{formSuccessMessage}</p>
        </div>
      </div>
    );
  }

  if (!isFormVisible) {
    return (
      <ButtonPrimitive
        variant='primary'
        className={mergeClassNames(
          'mt-auto w-full max-w-[360px]',
          ctaButtonClassName,
          className,
        )}
        onClick={handleOpenForm}
      >
        {ctaLabel}
      </ButtonPrimitive>
    );
  }

  return (
    <form
      {...formInteractionProps}
      onSubmit={handleSubmit}
      className={mergeClassNames(
        'mt-7 w-full max-w-[420px] space-y-3 opacity-0 transition-opacity duration-300 ease-out motion-reduce:transition-none',
        isFormFadingIn ? 'opacity-100' : null,
        className,
      )}
      noValidate
    >
      <label className='block' htmlFor={firstNameInputId}>
        <span className='mb-1 block text-sm font-semibold es-text-heading'>
          {formFirstNameLabel}
          <span className='es-form-required-marker ml-0.5' aria-hidden='true'>
            *
          </span>
        </span>
        <input
          id={firstNameInputId}
          type='text'
          autoComplete='given-name'
          value={firstName}
          onChange={(event) => {
            markFormInteracted();
            setFirstName(event.target.value);
          }}
          onBlur={() => {
            setIsFirstNameTouched(true);
          }}
          className={`es-focus-ring es-form-input ${hasFirstNameError ? 'es-form-input-error' : ''}`}
          aria-invalid={hasFirstNameError}
          aria-describedby={firstNameDescribedBy}
          required
          disabled={isSubmitting}
        />
        {hasFirstNameError ? (
          <p id={firstNameErrorId} className='mt-1 es-form-field-error' role='alert'>
            {formFirstNameValidationMessage}
          </p>
        ) : null}
      </label>

      <label className='block' htmlFor={emailInputId}>
        <span className='mb-1 block text-sm font-semibold es-text-heading'>
          {formEmailLabel}
          <span className='es-form-required-marker ml-0.5' aria-hidden='true'>
            *
          </span>
        </span>
        <input
          id={emailInputId}
          type='email'
          autoComplete='email'
          value={email}
          onChange={(event) => {
            markFormInteracted();
            setEmail(event.target.value);
          }}
          onBlur={() => {
            setIsEmailTouched(true);
          }}
          className={`es-focus-ring es-form-input ${hasEmailError ? 'es-form-input-error' : ''}`}
          aria-invalid={hasEmailError}
          aria-describedby={emailDescribedBy}
          required
          disabled={isSubmitting}
        />
        {hasEmailError ? (
          <p id={emailErrorId} className='mt-1 es-form-field-error' role='alert'>
            {formEmailValidationMessage}
          </p>
        ) : null}
      </label>

      <MarketingOptInCheckbox
        label={formMarketingOptInLabel}
        checked={marketingOptIn}
        onChange={(checked) => {
          markFormInteracted();
          setMarketingOptIn(checked);
        }}
      />

      {hasFormInteracted ? (
        <label className='block'>
          <span className='mb-1 block text-sm font-semibold es-text-heading'>
            {formCaptchaLabel}
          </span>
          <TurnstileCaptcha
            siteKey={turnstileSiteKey}
            widgetAction='media_submit'
            onTokenChange={handleCaptchaTokenChange}
            onLoadError={handleCaptchaLoadError}
          />
        </label>
      ) : null}

      {captchaErrorMessage ? (
        <p id={captchaErrorId} className='es-form-submit-error' role='alert'>
          {captchaErrorMessage}
        </p>
      ) : null}

      <ButtonPrimitive
        variant='primary'
        type='submit'
        className={submitButtonClassName(isSubmitting)}
        disabled={isSubmitDisabled}
        aria-describedby={submitButtonDescribedBy}
      >
        <SubmitButtonLoadingContent
          isSubmitting={isSubmitting}
          submittingLabel={formSubmittingLabel}
          idleLabel={formSubmitLabel}
          loadingGearTestId='media-form-submit-loading-gear'
        />
      </ButtonPrimitive>

      {shouldShowFormLevelError ? (
        <p id={formErrorId} className='es-form-submit-error' role='alert'>
          {submitErrorMessage || formErrorMessage}
        </p>
      ) : null}
    </form>
  );
}
