import { useCallback, useEffect, useRef, useState } from 'react';

import { applyDiscount } from '@/components/sections/booking-modal/helpers';
import { trackAnalyticsEvent } from '@/lib/analytics';
import type { BookingPaymentModalContent } from '@/content';
import { createPublicCrmApiClient } from '@/lib/crm-api-client';
import { type DiscountRule, validateDiscountCode } from '@/lib/discounts-data';
import { sanitizeSingleLineValue } from '@/lib/validation';

interface UseReservationDiscountOptions {
  analyticsSectionId: string;
  content: BookingPaymentModalContent;
  originalPriceAmount: number;
  serviceKey: string;
  serviceInstanceSlug: string;
  requiresServiceInstanceSlug: boolean;
  prefilledDiscountCode: string;
  referralAppliedAnnouncement: string;
}

export function useReservationDiscount({
  analyticsSectionId,
  content,
  originalPriceAmount,
  serviceKey,
  serviceInstanceSlug,
  requiresServiceInstanceSlug,
  prefilledDiscountCode,
  referralAppliedAnnouncement,
}: UseReservationDiscountOptions) {
  const [discountCode, setDiscountCode] = useState('');
  const [discountRule, setDiscountRule] = useState<DiscountRule | null>(null);
  const [discountError, setDiscountError] = useState('');
  const [autoAppliedFromReferral, setAutoAppliedFromReferral] = useState(false);
  const [referralAnnouncement, setReferralAnnouncement] = useState('');
  const [isDiscountValidationSubmitting, setIsDiscountValidationSubmitting] =
    useState(false);
  const autoApplyAttemptedRef = useRef(false);

  const applyDiscountFromCode = useCallback(
    async (
      rawCode: string,
      options: { ctaLocation: string; autoApply: boolean },
    ): Promise<void> => {
      if (discountRule) {
        return;
      }

      const normalizedCode = rawCode.trim().toUpperCase();
      if (!normalizedCode) {
        if (options.autoApply) {
          trackAnalyticsEvent('booking_discount_autoapply_error', {
            sectionId: analyticsSectionId,
            ctaLocation: options.ctaLocation,
            params: {
              error_type: 'invalid_code',
            },
          });
        } else {
          trackAnalyticsEvent('booking_discount_apply_error', {
            sectionId: analyticsSectionId,
            ctaLocation: options.ctaLocation,
            params: {
              error_type: 'invalid_code',
            },
          });
        }
        setDiscountRule(null);
        if (!options.autoApply) {
          setDiscountError(content.invalidDiscountLabel);
        }
        return;
      }

      const crmApiClient = createPublicCrmApiClient();
      if (!crmApiClient) {
        if (options.autoApply) {
          trackAnalyticsEvent('booking_discount_autoapply_error', {
            sectionId: analyticsSectionId,
            ctaLocation: options.ctaLocation,
            params: {
              error_type: 'service_unavailable',
            },
          });
        } else {
          trackAnalyticsEvent('booking_discount_apply_error', {
            sectionId: analyticsSectionId,
            ctaLocation: options.ctaLocation,
            params: {
              error_type: 'service_unavailable',
            },
          });
        }
        setDiscountRule(null);
        if (!options.autoApply) {
          setDiscountError(content.invalidDiscountLabel);
        }
        return;
      }

      const scopeKey = sanitizeSingleLineValue(serviceKey);
      const instanceSlugForValidate = sanitizeSingleLineValue(serviceInstanceSlug);

      setIsDiscountValidationSubmitting(true);
      if (!options.autoApply) {
        setDiscountError('');
      }
      try {
        if (!scopeKey || (requiresServiceInstanceSlug && !instanceSlugForValidate)) {
          setDiscountRule(null);
          if (options.autoApply) {
            trackAnalyticsEvent('booking_discount_autoapply_error', {
              sectionId: analyticsSectionId,
              ctaLocation: options.ctaLocation,
              params: {
                error_type: 'service_key_missing',
              },
            });
          } else {
            trackAnalyticsEvent('booking_discount_apply_error', {
              sectionId: analyticsSectionId,
              ctaLocation: options.ctaLocation,
              params: {
                error_type: 'service_key_missing',
              },
            });
          }
          if (!options.autoApply) {
            setDiscountError(content.discountUnavailableLabel);
          }
          console.warn(
            '[reservation-form] discount validate skipped: missing serviceKey or serviceInstanceSlug (calendar feed identity)',
          );
          return;
        }
        const validatedRule = await validateDiscountCode(crmApiClient, {
          code: normalizedCode,
          serviceKey: scopeKey,
          ...(instanceSlugForValidate
            ? { serviceInstanceSlug: instanceSlugForValidate }
            : {}),
        });
        if (!validatedRule) {
          if (options.autoApply) {
            trackAnalyticsEvent('booking_discount_autoapply_error', {
              sectionId: analyticsSectionId,
              ctaLocation: options.ctaLocation,
              params: {
                error_type: 'invalid_code',
              },
            });
          } else {
            trackAnalyticsEvent('booking_discount_apply_error', {
              sectionId: analyticsSectionId,
              ctaLocation: options.ctaLocation,
              params: {
                error_type: 'invalid_code',
              },
            });
          }
          setDiscountRule(null);
          if (!options.autoApply) {
            setDiscountError(content.invalidDiscountLabel);
          }
          return;
        }

        setDiscountCode(normalizedCode);
        setDiscountRule(validatedRule);
        if (options.autoApply) {
          trackAnalyticsEvent('booking_discount_autoapply_success', {
            sectionId: analyticsSectionId,
            ctaLocation: options.ctaLocation,
            params: {
              discount_type: validatedRule.type,
              discount_amount: Math.max(
                0,
                originalPriceAmount - applyDiscount(originalPriceAmount, validatedRule),
              ),
            },
          });
        } else {
          trackAnalyticsEvent('booking_discount_apply_success', {
            sectionId: analyticsSectionId,
            ctaLocation: options.ctaLocation,
            params: {
              discount_type: validatedRule.type,
              discount_amount: Math.max(
                0,
                originalPriceAmount - applyDiscount(originalPriceAmount, validatedRule),
              ),
            },
          });
        }
        if (options.autoApply) {
          setAutoAppliedFromReferral(true);
          if (referralAppliedAnnouncement.trim()) {
            setReferralAnnouncement(referralAppliedAnnouncement.trim());
          }
        }
      } catch {
        if (options.autoApply) {
          trackAnalyticsEvent('booking_discount_autoapply_error', {
            sectionId: analyticsSectionId,
            ctaLocation: options.ctaLocation,
            params: {
              error_type: 'api_error',
            },
          });
        } else {
          trackAnalyticsEvent('booking_discount_apply_error', {
            sectionId: analyticsSectionId,
            ctaLocation: options.ctaLocation,
            params: {
              error_type: 'api_error',
            },
          });
        }
        setDiscountRule(null);
        if (!options.autoApply) {
          setDiscountError(content.invalidDiscountLabel);
        }
      } finally {
        setIsDiscountValidationSubmitting(false);
      }
    },
    [
      analyticsSectionId,
      content.discountUnavailableLabel,
      content.invalidDiscountLabel,
      discountRule,
      serviceKey,
      serviceInstanceSlug,
      requiresServiceInstanceSlug,
      originalPriceAmount,
      referralAppliedAnnouncement,
    ],
  );

  useEffect(() => {
    if (autoApplyAttemptedRef.current) {
      return;
    }
    const raw = prefilledDiscountCode?.trim() ?? '';
    if (!raw) {
      return;
    }
    if (discountRule) {
      return;
    }
    autoApplyAttemptedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- apply a prefilled referral code once
    void applyDiscountFromCode(raw, { ctaLocation: 'referral_auto', autoApply: true });
  }, [applyDiscountFromCode, discountRule, prefilledDiscountCode]);

  async function handleApplyDiscount() {
    const normalizedCode = discountCode.trim().toUpperCase();
    await applyDiscountFromCode(normalizedCode, {
      ctaLocation: 'discount_code',
      autoApply: false,
    });
  }

  return {
    discountCode,
    setDiscountCode,
    discountRule,
    discountError,
    setDiscountError,
    autoAppliedFromReferral,
    referralAnnouncement,
    isDiscountValidationSubmitting,
    handleApplyDiscount,
  };
}
