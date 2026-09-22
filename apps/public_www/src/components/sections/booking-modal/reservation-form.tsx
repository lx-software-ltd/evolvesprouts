'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { ReservationFormDiscountCodeInput } from '@/components/sections/booking-modal/reservation-form-discount-code-input';
import {
  BOOKING_EMAIL_ERROR_MESSAGE_ID,
  BOOKING_FULL_NAME_ERROR_MESSAGE_ID,
  BOOKING_PHONE_ERROR_MESSAGE_ID,
  BOOKING_PHONE_INVALID_COUNTRY_ERROR_MESSAGE_ID,
  BOOKING_TOPICS_ERROR_MESSAGE_ID,
  ReservationFormFields,
} from '@/components/sections/booking-modal/reservation-form-fields';
import { ReservationFormPriceBreakdown } from '@/components/sections/booking-modal/reservation-form-price-breakdown';
import { DiscountBadge } from '@/components/sections/booking-modal/shared';
import { ReservationAcknowledgements } from '@/components/sections/booking-modal/reservation-acknowledgements';
import { ReservationPaymentMethodPicker } from '@/components/sections/booking-modal/reservation-payment-method-picker';
import {
  CAPTCHA_ERROR_MESSAGE_ID,
  PAYMENT_METHOD_FREE,
  PAYMENT_METHOD_STRIPE,
  SUBMIT_ERROR_MESSAGE_ID,
  ACKNOWLEDGEMENT_ERROR_MESSAGE_ID,
} from '@/components/sections/booking-modal/reservation-form-types';
import { applyDiscount } from '@/components/sections/booking-modal/helpers';
import type { StripePaymentFieldsHandle } from '@/components/sections/booking-modal/stripe-payment-section';
import { useReservationDiscount } from '@/components/sections/booking-modal/use-reservation-discount';
import { useReservationPaymentMethods } from '@/components/sections/booking-modal/use-reservation-payment-methods';
import {
  isStripeUnavailable,
  useStripePaymentIntent,
} from '@/components/sections/booking-modal/use-stripe-payment-intent';
import { createReservationSubmitHandler } from '@/components/sections/booking-modal/create-reservation-submit-handler';
import type {
  BookingThankYouRecapLabelTemplates,
  BookingTopicsFieldConfig,
  ReservationCourseSession,
  ReservationSummary,
} from '@/components/sections/booking-modal/types';
import {
  resolveCaptchaErrorMessage,
  useFormSubmission,
} from '@/components/sections/shared/use-form-submission';
import { useFormInteractionGate } from '@/components/sections/shared/use-form-interaction';
import { ButtonPrimitive } from '@/components/shared/button-primitive';
import {
  SubmitButtonLoadingContent,
  submitButtonClassName,
} from '@/components/shared/submit-button-loading-content';
import { TurnstileCaptcha } from '@/components/shared/turnstile-captcha';
import { trackMetaPixelEvent, type MetaPixelContentName } from '@/lib/meta-pixel';
import { PIXEL_CONTENT_NAME } from '@/lib/meta-pixel-taxonomy';
import {
  EVENT_BOOKING_SYSTEM,
  MY_BEST_AUNTIE_BOOKING_SYSTEM,
} from '@/lib/events-data';
import type { BookingPaymentModalContent, Locale } from '@/content';
import { getContent } from '@/content';
import { isValidPhoneForRegion } from '@/lib/public-phone-validation';
import { isValidEmail, sanitizeSingleLineValue } from '@/lib/validation';

interface BookingReservationFormProps {
  locale: Locale;
  content: BookingPaymentModalContent;
  eventTitle: string;
  serviceKey: string;
  cohortId?: string;
  bookingSystem: string;
  serviceTypeLabelKey: 'event' | 'training-course' | 'consultation';
  eventSubtitle?: string;
  sessionSlots?: ReservationCourseSession[];
  selectedServiceTierLabel: string;
  selectedCohortDateLabel: string;
  selectedDateStartTime: string;
  originalPriceAmount: number;
  venueName?: string;
  venueAddress?: string;
  venueDirectionHref?: string;
  dateEndTime?: string;
  topicsFieldConfig?: BookingTopicsFieldConfig;
  topicsPrefill?: string;
  consultationWritingFocusLabel?: string;
  consultationLevelLabel?: string;
  thankYouRecapLabels?: BookingThankYouRecapLabelTemplates;
  descriptionId: string;
  analyticsSectionId?: string;
  metaPixelContentName?: MetaPixelContentName;
  captchaWidgetAction?: string;
  serviceInstanceSlug?: string;
  prefilledDiscountCode?: string;
  referralAppliedNote?: string;
  referralAppliedAnnouncement?: string;
  initiallyInteracted?: boolean;
  onSubmitReservation: (summary: ReservationSummary) => void;
}

export function BookingReservationForm({
  locale,
  content,
  eventTitle,
  serviceKey,
  cohortId = '',
  serviceTypeLabelKey,
  bookingSystem,
  eventSubtitle = '',
  sessionSlots,
  selectedServiceTierLabel,
  selectedCohortDateLabel,
  selectedDateStartTime,
  originalPriceAmount,
  venueName = '',
  venueAddress = '',
  venueDirectionHref = '',
  dateEndTime = '',
  topicsFieldConfig,
  topicsPrefill = '',
  consultationWritingFocusLabel = '',
  consultationLevelLabel = '',
  thankYouRecapLabels,
  descriptionId,
  analyticsSectionId = 'my-best-auntie-booking',
  metaPixelContentName = PIXEL_CONTENT_NAME.my_best_auntie,
  captchaWidgetAction = 'mba_reservation_submit',
  serviceInstanceSlug = '',
  prefilledDiscountCode = '',
  referralAppliedNote = '',
  referralAppliedAnnouncement = '',
  initiallyInteracted = false,
  onSubmitReservation,
}: BookingReservationFormProps) {
  const requiresServiceInstanceSlug =
    bookingSystem === EVENT_BOOKING_SYSTEM ||
    bookingSystem === MY_BEST_AUNTIE_BOOKING_SYSTEM;
  const dialCodeOptionTemplate = getContent(locale).common.phoneDialCodeOptionTemplate;
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [isFullNameTouched, setIsFullNameTouched] = useState(false);
  const [isEmailTouched, setIsEmailTouched] = useState(false);
  const [phoneCountry, setPhoneCountry] = useState('HK');
  const [phone, setPhone] = useState('');
  const [isPhoneTouched, setIsPhoneTouched] = useState(false);
  const [isTopicsTouched, setIsTopicsTouched] = useState(false);
  const [isAcknowledgementsTouched, setIsAcknowledgementsTouched] = useState(false);
  const [interestedTopics, setInterestedTopics] = useState(() => topicsPrefill.trim());
  const lastAppliedTopicsPrefillRef = useRef(topicsPrefill.trim());
  const [hasPendingReservationAcknowledgement, setHasPendingReservationAcknowledgement] =
    useState(false);
  const [hasTermsAgreement, setHasTermsAgreement] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [fpsQrImageDataUrl, setFpsQrImageDataUrl] = useState('');
  const stripePaymentFieldsRef = useRef<StripePaymentFieldsHandle | null>(null);

  const {
    captchaToken,
    clearSubmissionError,
    handleCaptchaLoadError,
    handleCaptchaTokenChange,
    hasCaptchaLoadError,
    hasCaptchaValidationError,
    isCaptchaConfigured,
    isCaptchaUnavailable,
    isSubmitting,
    markCaptchaTouched,
    setSubmissionError,
    submitErrorMessage,
    withSubmitting,
  } = useFormSubmission({ turnstileSiteKey });
  const { hasFormInteracted, markFormInteracted, formInteractionProps } =
    useFormInteractionGate({ initiallyInteracted });

  const {
    discountCode,
    setDiscountCode,
    discountRule,
    discountError,
    setDiscountError,
    autoAppliedFromReferral,
    referralAnnouncement,
    isDiscountValidationSubmitting,
    handleApplyDiscount,
  } = useReservationDiscount({
    analyticsSectionId,
    content,
    originalPriceAmount,
    serviceKey,
    serviceInstanceSlug,
    requiresServiceInstanceSlug,
    prefilledDiscountCode,
    referralAppliedAnnouncement,
  });

  const totalAmount = useMemo(() => {
    return applyDiscount(originalPriceAmount, discountRule);
  }, [discountRule, originalPriceAmount]);
  const isFreeReservation = totalAmount <= 0;

  const {
    paymentMethodFlags,
    selectedPaymentMethod,
    setSelectedPaymentMethod,
    showPaymentMethodPickers,
  } = useReservationPaymentMethods({ isFreeReservation });

  const prevPaymentContextRef = useRef({
    totalAmount,
    selectedPaymentMethod,
  });
  useEffect(() => {
    const previous = prevPaymentContextRef.current;
    if (
      previous.totalAmount === totalAmount &&
      previous.selectedPaymentMethod === selectedPaymentMethod
    ) {
      return;
    }
    prevPaymentContextRef.current = { totalAmount, selectedPaymentMethod };
    setFpsQrImageDataUrl('');
  }, [totalAmount, selectedPaymentMethod]);

  useEffect(() => {
    const next = topicsPrefill.trim();
    if (!next || next === lastAppliedTopicsPrefillRef.current) {
      return;
    }
    lastAppliedTopicsPrefillRef.current = next;
    setInterestedTopics(next);
  }, [topicsPrefill]);

  const discountAmount = Math.max(0, originalPriceAmount - totalAmount);
  const normalizedStartDateTime = sanitizeSingleLineValue(selectedDateStartTime);
  const normalizedCohortDate =
    (normalizedStartDateTime.split('T')[0] ?? '') ||
    sanitizeSingleLineValue(selectedCohortDateLabel);
  const paymentIntentServiceKey = sanitizeSingleLineValue(serviceKey);
  const isStripePaymentMethodSelected = selectedPaymentMethod === PAYMENT_METHOD_STRIPE;
  const paymentMethodForAnalytics = isFreeReservation
    ? PAYMENT_METHOD_FREE
    : selectedPaymentMethod;

  const {
    stripePaymentIntent,
    stripeElementsOptions,
    isStripePaymentIntentLoading,
    isStripeReady,
  } = useStripePaymentIntent({
    captchaToken,
    clearSubmissionError,
    cohortId,
    content,
    discountRule,
    isFreeReservation,
    isStripePaymentMethodSelected,
    normalizedCohortDate,
    paymentIntentServiceKey,
    paymentMethodFlags,
    selectedServiceTierLabel,
    setSubmissionError,
    totalAmount,
  });

  const hasEmailError = isEmailTouched && !isValidEmail(email);
  const hasFullNameError = isFullNameTouched && !sanitizeSingleLineValue(fullName);
  const normalizedPhoneForValidation = sanitizeSingleLineValue(phone);
  const phoneNationalDigits = normalizedPhoneForValidation.replace(/\D/g, '');
  const hasPhoneError =
    isPhoneTouched &&
    (!normalizedPhoneForValidation || phoneNationalDigits.length === 0);
  const hasPhoneInvalidForCountry =
    isPhoneTouched &&
    phoneNationalDigits.length > 0 &&
    !isValidPhoneForRegion(phone, phoneCountry);
  const isTopicsFieldRequired = topicsFieldConfig?.required ?? false;
  const hasTopicsError =
    isTopicsTouched && isTopicsFieldRequired && !interestedTopics.trim();
  const hasAcknowledgementsError = isFreeReservation
    ? isAcknowledgementsTouched && !hasTermsAgreement
    : isAcknowledgementsTouched &&
      (!hasPendingReservationAcknowledgement || !hasTermsAgreement);

  const reservationSubmitIdleLabel =
    isFreeReservation || !isStripePaymentMethodSelected
      ? content.submitLabel
      : content.submitStripeLabel;
  const captchaErrorMessage = resolveCaptchaErrorMessage(
    {
      isCaptchaConfigured,
      hasCaptchaLoadError,
      hasCaptchaValidationError,
    },
    {
      requiredError: content.captchaRequiredError,
      loadError: content.captchaLoadError,
      unavailableError: content.captchaUnavailableError,
    },
  );
  const submitButtonDescribedByParts = [
    hasFullNameError ? BOOKING_FULL_NAME_ERROR_MESSAGE_ID : null,
    hasEmailError ? BOOKING_EMAIL_ERROR_MESSAGE_ID : null,
    hasPhoneError ? BOOKING_PHONE_ERROR_MESSAGE_ID : null,
    hasPhoneInvalidForCountry && !hasPhoneError
      ? BOOKING_PHONE_INVALID_COUNTRY_ERROR_MESSAGE_ID
      : null,
    hasTopicsError ? BOOKING_TOPICS_ERROR_MESSAGE_ID : null,
    hasAcknowledgementsError ? ACKNOWLEDGEMENT_ERROR_MESSAGE_ID : null,
    captchaErrorMessage ? CAPTCHA_ERROR_MESSAGE_ID : null,
    submitErrorMessage ? SUBMIT_ERROR_MESSAGE_ID : null,
  ].filter((id): id is string => id !== null);
  const submitButtonDescribedBy =
    submitButtonDescribedByParts.length > 0
      ? submitButtonDescribedByParts.join(' ')
      : undefined;
  const isSubmitDisabled =
    isCaptchaUnavailable ||
    (!isFreeReservation &&
      isStripePaymentMethodSelected &&
      (isStripePaymentIntentLoading || !isStripeReady)) ||
    isSubmitting;

  const { handleSubmit } = createReservationSubmitHandler(
    {
      fullName,
      email,
      phone,
      phoneCountry,
      interestedTopics,
      hasPendingReservationAcknowledgement,
      hasTermsAgreement,
      marketingOptIn,
      captchaToken,
      fpsQrImageDataUrl,
    },
    {
      analyticsSectionId,
      bookingSystem,
      cohortId,
      consultationLevelLabel,
      consultationWritingFocusLabel,
      content,
      dateEndTime,
      discountAmount,
      discountRule,
      eventSubtitle,
      eventTitle,
      isFreeReservation,
      isStripePaymentIntentLoading,
      isStripePaymentMethodSelected,
      isStripeReady,
      isTopicsFieldRequired,
      locale,
      normalizedCohortDate,
      paymentMethodForAnalytics,
      requiresServiceInstanceSlug,
      selectedCohortDateLabel,
      selectedDateStartTime,
      selectedPaymentMethod,
      selectedServiceTierLabel,
      serviceInstanceSlug,
      serviceKey,
      serviceTypeLabelKey,
      sessionSlots,
      thankYouRecapLabels,
      topicsFieldConfig,
      totalAmount,
      venueAddress,
      venueDirectionHref,
      venueName,
    },
    {
      clearSubmissionError,
      isCaptchaUnavailable,
      isSubmitting,
      markCaptchaTouched,
      markFormInteracted,
      onSubmitReservation,
      onReservationMetaPixelSuccess: (value) => {
        trackMetaPixelEvent('Schedule', {
          content_name: metaPixelContentName,
          value,
          currency: 'HKD',
        });
        trackMetaPixelEvent('Purchase', {
          content_name: metaPixelContentName,
          value,
          currency: 'HKD',
        });
      },
      setIsAcknowledgementsTouched,
      setIsEmailTouched,
      setIsFullNameTouched,
      setIsPhoneTouched,
      setIsTopicsTouched,
      setSubmissionError,
      withSubmitting,
    },
    // Ref is read only inside handleSubmit on user action, not during handler creation.
    // eslint-disable-next-line react-hooks/refs -- factory stores ref for submit-time Stripe confirmation
    stripePaymentFieldsRef,
  );

  return (
    <div className='w-full lg:w-[calc(50%-20px)]'>
      <section className='es-my-best-auntie-booking-modal-reservation-panel relative overflow-visible rounded-inner border es-border-panel es-bg-surface-muted px-5 py-7 sm:px-7'>
        <h3 className='relative z-10 text-[30px] font-bold leading-none es-text-heading'>
          {content.reservationTitle}
        </h3>
        <p id={descriptionId} className='sr-only'>
          {content.reservationDescription}
        </p>

        <form
          {...formInteractionProps}
          noValidate
          className='relative z-10 mt-4 space-y-3'
          onSubmit={handleSubmit}
        >
          <ReservationFormFields
            content={content}
            dialCodeOptionTemplate={dialCodeOptionTemplate}
            fullName={fullName}
            email={email}
            phoneCountry={phoneCountry}
            phone={phone}
            interestedTopics={interestedTopics}
            hasFullNameError={hasFullNameError}
            hasEmailError={hasEmailError}
            hasPhoneError={hasPhoneError}
            hasPhoneInvalidForCountry={hasPhoneInvalidForCountry}
            hasTopicsError={hasTopicsError}
            topicsFieldConfig={topicsFieldConfig}
            onFullNameChange={(value) => {
              markFormInteracted();
              setFullName(value);
            }}
            onFullNameBlur={() => {
              setIsFullNameTouched(true);
            }}
            onEmailChange={(value) => {
              markFormInteracted();
              setEmail(value);
            }}
            onEmailBlur={() => {
              setIsEmailTouched(true);
            }}
            onPhoneCountryChange={(value) => {
              markFormInteracted();
              setPhoneCountry(value);
            }}
            onPhoneChange={(value) => {
              markFormInteracted();
              setPhone(value);
            }}
            onPhoneBlur={() => {
              setIsPhoneTouched(true);
            }}
            onTopicsChange={(value) => {
              markFormInteracted();
              setInterestedTopics(value);
            }}
            onTopicsBlur={() => {
              setIsTopicsTouched(true);
            }}
          />

          <ReservationFormDiscountCodeInput
            content={content}
            discountCode={discountCode}
            discountError={discountError}
            hasDiscountRule={Boolean(discountRule)}
            isDiscountValidationSubmitting={isDiscountValidationSubmitting}
            onDiscountCodeChange={(value) => {
              markFormInteracted();
              setDiscountCode(value);
              setDiscountError('');
            }}
            onApplyDiscount={handleApplyDiscount}
          />

          {referralAnnouncement ? (
            <p className='sr-only' role='status' aria-live='polite'>
              {referralAnnouncement}
            </p>
          ) : null}

          {autoAppliedFromReferral && referralAppliedNote.trim() ? (
            <p className='text-sm es-text-neutral-strong'>{referralAppliedNote.trim()}</p>
          ) : null}

          {discountRule ? <DiscountBadge label={content.discountAppliedLabel} /> : null}

          <ReservationFormPriceBreakdown
            content={content}
            locale={locale}
            originalAmount={originalPriceAmount}
            discountAmount={discountAmount}
            totalAmount={totalAmount}
          />

          {!isFreeReservation ? (
            <ReservationPaymentMethodPicker
              analyticsSectionId={analyticsSectionId}
              content={content}
              eventTitle={eventTitle}
              fpsQrImageDataUrl={fpsQrImageDataUrl}
              isStripeReady={isStripeReady}
              isStripeUnavailable={isStripeUnavailable()}
              markFormInteracted={markFormInteracted}
              onFpsQrImageDataUrlChange={setFpsQrImageDataUrl}
              paymentMethodFlags={paymentMethodFlags}
              selectedPaymentMethod={selectedPaymentMethod}
              selectedServiceTierLabel={selectedServiceTierLabel}
              setSelectedPaymentMethod={setSelectedPaymentMethod}
              showPaymentMethodPickers={showPaymentMethodPickers}
              stripeElementsOptions={stripeElementsOptions}
              stripePaymentFieldsRef={stripePaymentFieldsRef}
              stripePaymentIntentId={stripePaymentIntent?.payment_intent_id}
              totalAmount={totalAmount}
            />
          ) : null}

          <ReservationAcknowledgements
            content={content}
            hasAcknowledgementsError={hasAcknowledgementsError}
            hasPendingReservationAcknowledgement={hasPendingReservationAcknowledgement}
            hasTermsAgreement={hasTermsAgreement}
            isFreeReservation={isFreeReservation}
            marketingOptIn={marketingOptIn}
            markFormInteracted={markFormInteracted}
            onMarketingOptInChange={setMarketingOptIn}
            onPendingReservationAcknowledgementChange={
              setHasPendingReservationAcknowledgement
            }
            onTermsAgreementChange={setHasTermsAgreement}
          />

          {hasFormInteracted ? (
            <label className='relative z-20 block overflow-visible'>
              <span className='mb-1 block text-sm font-semibold es-text-heading'>
                {content.captchaLabel}
              </span>
              <TurnstileCaptcha
                siteKey={turnstileSiteKey}
                widgetAction={captchaWidgetAction}
                onTokenChange={handleCaptchaTokenChange}
                onLoadError={handleCaptchaLoadError}
              />
            </label>
          ) : null}
          {captchaErrorMessage ? (
            <p
              id={CAPTCHA_ERROR_MESSAGE_ID}
              className='es-form-submit-error'
              role='alert'
            >
              {captchaErrorMessage}
            </p>
          ) : null}
          {submitErrorMessage ? (
            <p
              id={SUBMIT_ERROR_MESSAGE_ID}
              className='es-form-submit-error'
              role='alert'
            >
              {submitErrorMessage}
            </p>
          ) : null}

          <ButtonPrimitive
            variant='primary'
            type='submit'
            disabled={isSubmitDisabled}
            aria-describedby={submitButtonDescribedBy}
            className={submitButtonClassName(isSubmitting, 'mt-1')}
          >
            <SubmitButtonLoadingContent
              isSubmitting={isSubmitting}
              submittingLabel={content.submittingLabel}
              idleLabel={reservationSubmitIdleLabel}
              loadingGearTestId='booking-reservation-submit-loading-gear'
            />
          </ButtonPrimitive>
        </form>
      </section>
    </div>
  );
}
