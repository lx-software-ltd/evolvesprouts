'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import { ExternalLinkInlineContent } from '@/components/shared/external-link-icon';
import { ButtonPrimitive } from '@/components/shared/button-primitive';
import { CarouselTrack } from '@/components/sections/shared/carousel-track';
import { BOOKING_SELECTOR_CARD_CLASSNAME } from '@/components/sections/shared/booking-selector-layout';
import { useBookingAutoOpenFromQuery, useBookingPageSearch } from '@/components/sections/shared/use-booking-auto-open-from-query';
import { useBookingThankYouView } from '@/components/sections/shared/use-booking-thank-you-view';
import { useReferralPrefill } from '@/components/sections/shared/use-referral-prefill';
import { trackBookingBeginCheckout } from '@/components/sections/shared/track-booking-begin-checkout';
import { CarouselHorizontalArrowControls } from '@/components/sections/shared/carousel-horizontal-arrow-controls';
import { EventsLoadingState } from '@/components/sections/shared/events-shared';
import {
  buildSectionSplitLayoutClassName,
  SectionContainer,
} from '@/components/sections/shared/section-container';
import { SectionHeader } from '@/components/sections/shared/section-header';
import { buildThankYouRecapLabels } from '@/components/sections/booking-modal/thank-you-recap-labels';
import type { ReservationSummary } from '@/components/sections/booking-modal/types';
import { SectionShell } from '@/components/sections/shared/section-shell';
import enContent from '@/content/en.json';
import type {
  BookingModalContent,
  CommonAccessibilityContent,
  Locale,
  MyBestAuntieBookingContent,
  MyBestAuntieModalContent,
} from '@/content';
import { formatContentTemplate } from '@/content/content-field-utils';
import {
  MY_BEST_AUNTIE_BOOKING_SYSTEM,
  MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY,
  type MyBestAuntieEventCohort,
} from '@/lib/events-data';
import {
  formatCohortValue,
  formatPartDateTimeLabel,
  parseCohortValue,
} from '@/lib/format';
import {
  formatYmdInPublicSiteTimeZone,
  getPrimarySessionSortValue,
  isFutureCohort,
} from '@/lib/my-best-auntie-cohort-calendar';
import { useHorizontalCarousel } from '@/lib/hooks/use-horizontal-carousel';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { trackMetaPixelEvent } from '@/lib/meta-pixel';
import { PIXEL_CONTENT_NAME } from '@/lib/meta-pixel-taxonomy';
import { useMyBestAuntieCohorts } from '@/components/sections/my-best-auntie/use-my-best-auntie-cohorts';
import {
  cohortsVisibleForAgeGroup,
  resolveMyBestAuntieDeepLink,
} from '@/components/sections/my-best-auntie/resolve-my-best-auntie-deep-link';

const MyBestAuntieBookingModal = dynamic(
  () =>
    import('@/components/sections/my-best-auntie/my-best-auntie-booking-modal').then(
      (module) => module.MyBestAuntieBookingModal,
    ),
  { ssr: false },
);

const MyBestAuntieThankYouModal = dynamic(
  () =>
    import('@/components/sections/my-best-auntie/my-best-auntie-thank-you-modal').then(
      (module) => module.MyBestAuntieThankYouModal,
    ),
  { ssr: false },
);

interface MyBestAuntieBookingProps {
  locale: Locale;
  content: MyBestAuntieBookingContent;
  initialCohorts: MyBestAuntieEventCohort[];
  modalContent: MyBestAuntieModalContent;
  bookingModalContent: BookingModalContent;
  commonAccessibility?: CommonAccessibilityContent;
  thankYouWhatsappHref?: string;
  thankYouWhatsappCtaLabel?: string;
  privateProgrammeWhatsappHref?: string;
}

function formatCohortPreviewLabel(value: string): string {
  const firstDateSegment = value.split(/\s+-\s+/)[0]?.trim() ?? value.trim();

  return firstDateSegment.replace(/\s+(am|pm)$/i, '$1');
}

function getCohortSortValue(value: string): number {
  const parsed = parseCohortValue(value);
  if (!parsed) {
    return Number.POSITIVE_INFINITY;
  }

  return parsed.year * 100 + (parsed.monthIndex + 1);
}

function formatNextCohortLabel(
  scheduleLabel: string,
  ageGroupLabel: string,
  template: string,
): string {
  if (!ageGroupLabel) {
    return scheduleLabel;
  }

  return formatContentTemplate(template, {
    scheduleLabel,
    ageGroupLabel,
  });
}

const MAX_VISIBLE_COHORTS_PER_AGE_GROUP = 3;

interface BookingDateOption {
  id: string;
  label: string;
  availabilityLabel: string;
  isFullyBooked: boolean;
  cohort: MyBestAuntieEventCohort;
}

function formatSpacesLeftLabel(count: number, template: string): string {
  return formatContentTemplate(template, {
    count: String(count),
  });
}

function sortCohortsByPrimarySession(
  leftCohort: MyBestAuntieEventCohort,
  rightCohort: MyBestAuntieEventCohort,
): number {
  const dateDifference =
    getPrimarySessionSortValue(leftCohort) -
    getPrimarySessionSortValue(rightCohort);

  if (dateDifference !== 0) {
    return dateDifference;
  }

  const cohortDifference = getCohortSortValue(leftCohort.cohort) -
    getCohortSortValue(rightCohort.cohort);
  if (cohortDifference !== 0) {
    return cohortDifference;
  }

  return leftCohort.slug.localeCompare(rightCohort.slug);
}

function findPreferredCohortId(
  cohorts: MyBestAuntieEventCohort[],
  ageGroupId: string,
): string {
  const ageGroupCohorts = cohorts.filter(
    (cohort) => cohort.service_tier === ageGroupId,
  );
  const available = ageGroupCohorts.find((cohort) => !cohort.is_fully_booked);
  return available?.slug ?? ageGroupCohorts[0]?.slug ?? '';
}

function getPrimarySessionDateTimeLabel(
  cohort: MyBestAuntieEventCohort | null,
  locale: Locale,
): string {
  const startDateTime = cohort?.dates[0]?.start_datetime ?? '';
  return formatPartDateTimeLabel(startDateTime, locale);
}

function formatCohortPrice(
  price: number,
  currency: string,
  locale: Locale,
): string {
  const numberFormatLocale = locale === 'en' ? 'en-HK' : locale;
  const normalizedCurrency = currency.trim();

  if (/^[A-Z]{3}$/.test(normalizedCurrency)) {
    try {
      return new Intl.NumberFormat(numberFormatLocale, {
        style: 'currency',
        currency: normalizedCurrency,
        maximumFractionDigits: 0,
      }).format(price);
    } catch {
      // fall through to symbol formatting
    }
  }

  const formattedAmount = new Intl.NumberFormat(numberFormatLocale, {
    useGrouping: true,
    maximumFractionDigits: 0,
  }).format(price);

  if (!normalizedCurrency) {
    return formattedAmount;
  }

  return `${normalizedCurrency}${formattedAmount}`;
}

export function MyBestAuntieBooking({
  locale,
  content,
  initialCohorts,
  modalContent,
  bookingModalContent,
  commonAccessibility = enContent.common.accessibility,
  thankYouWhatsappHref,
  thankYouWhatsappCtaLabel,
  privateProgrammeWhatsappHref,
}: MyBestAuntieBookingProps) {
  const {
    cohorts: cohortsFromHook,
    isLoading: isCohortsLoading,
    hasRequestError: hasCohortsRequestError,
  } = useMyBestAuntieCohorts({
    initialCohorts,
    serviceKey: MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY,
    serviceType: 'training_course',
  });
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isThankYouModalOpen, setIsThankYouModalOpen] = useState(false);
  const [reservationSummary, setReservationSummary] =
    useState<ReservationSummary | null>(null);
  const [prefilledDiscountCode, setPrefilledDiscountCode] = useState('');
  const [todayYmd] = useState(() =>
    formatYmdInPublicSiteTimeZone(new Date(Date.now())),
  );

  const ageOptions = content.ageOptions ?? [];
  const sortedCohorts = [...cohortsFromHook].sort(sortCohortsByPrimarySession);
  const initialAgeId = ageOptions[0]?.id ?? '';
  const pageSearch = useBookingPageSearch();
  const deepLinkResolution = resolveMyBestAuntieDeepLink({
    link: pageSearch,
    cohorts: sortedCohorts,
    ageGroupIds: ageOptions.map((option) => option.id),
    todayYmd,
    isLoading: isCohortsLoading,
  });
  const deepLinkServiceTier =
    deepLinkResolution.status === 'open' ||
    deepLinkResolution.status === 'blocked' ||
    deepLinkResolution.status === 'tier'
      ? deepLinkResolution.serviceTier
      : '';
  const deepLinkCohortSlug =
    deepLinkResolution.status === 'open' ? deepLinkResolution.cohortSlug : '';
  /** Null until the visitor picks an age; a deep link supplies the age until then. */
  const [ageOverride, setAgeOverride] = useState<string | null>(null);
  /** Null follows the deep link. An empty string means the visitor cleared that date. */
  const [dateOverride, setDateOverride] = useState<string | null>(null);
  const selectedAgeId = ageOverride ?? (deepLinkServiceTier || initialAgeId);
  const deepLinkedVisibleSlug = deepLinkCohortSlug;
  const cohortsForSelectedAge = cohortsVisibleForAgeGroup({
    sortedCohorts,
    ageGroupId: selectedAgeId,
    todayYmd,
    deepLinkedSlug: deepLinkedVisibleSlug,
    limit: MAX_VISIBLE_COHORTS_PER_AGE_GROUP,
    sortCohorts: sortCohortsByPrimarySession,
  });
  const dateOptions: BookingDateOption[] = cohortsForSelectedAge.map((cohort) => ({
    id: cohort.slug,
    label: formatCohortValue(cohort.cohort, locale),
    availabilityLabel: formatSpacesLeftLabel(
      cohort.spaces_left,
      content.spacesLeftLabelTemplate,
    ),
    isFullyBooked: cohort.is_fully_booked,
    cohort,
  }));
  const pendingDateSelectionSlug =
    dateOverride !== null ? dateOverride || null : deepLinkCohortSlug || null;
  const preferredDateId = findPreferredCohortId(cohortsForSelectedAge, selectedAgeId);
  const selectedDateId =
    pendingDateSelectionSlug
    && cohortsForSelectedAge.some(
      (cohort) =>
        cohort.service_tier === selectedAgeId && cohort.slug === pendingDateSelectionSlug,
    )
      ? pendingDateSelectionSlug
      : preferredDateId;
  const dateCardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const {
    carouselRef: dateCarouselRef,
    hasNavigation: hasDateNavigation,
    canScrollPrevious: canScrollDateLeft,
    canScrollNext: canScrollDateRight,
    scrollByDirection: scrollDateCarouselByDirection,
    scrollItemIntoView,
  } = useHorizontalCarousel<HTMLDivElement>({
    itemCount: dateOptions.length,
    minItemsForNavigation: 3,
    loop: false,
  });

  const selectedAgeOption =
    ageOptions.find((option) => option.id === selectedAgeId) ?? ageOptions[0];
  const selectedDateOption =
    dateOptions.find((option) => option.id === selectedDateId) ?? dateOptions[0];
  const selectedCohort = selectedDateOption?.cohort ?? dateOptions[0]?.cohort ?? null;
  const nextCohortForSelectedAge = cohortsForSelectedAge[0] ?? null;
  const nextCohortDate = getPrimarySessionDateTimeLabel(nextCohortForSelectedAge, locale);
  const nextCohortLabel = formatNextCohortLabel(
    content.scheduleLabel,
    selectedAgeOption?.label ?? '',
    content.nextCohortLabelTemplate,
  );
  const nextCohortPreview = nextCohortDate
    ? formatCohortPreviewLabel(nextCohortDate)
    : content.noCohortsLabel;
  const nextCohortPriceLabel = nextCohortForSelectedAge
    ? formatCohortPrice(
        nextCohortForSelectedAge.price,
        nextCohortForSelectedAge.currency,
        locale,
      )
    : '';

  useEffect(() => {
    const selectedDateCard = dateCardRefs.current[selectedDateId];
    scrollItemIntoView(selectedDateCard);
  }, [scrollItemIntoView, selectedDateId]);

  const deepLinkSelectionReady =
    deepLinkResolution.status === 'ignore' ||
    deepLinkResolution.status === 'unscoped' ||
    (deepLinkResolution.status === 'tier' && selectedAgeId === deepLinkServiceTier) ||
    (deepLinkResolution.status === 'open' &&
      selectedAgeId === deepLinkServiceTier &&
      selectedDateId === deepLinkCohortSlug);

  const handleReferralPrefill = (referral: string) => {
    setPrefilledDiscountCode(referral);
  };
  useReferralPrefill(handleReferralPrefill);

  useBookingAutoOpenFromQuery({
    bookingSystem: MY_BEST_AUNTIE_BOOKING_SYSTEM,
    canOpen:
      deepLinkSelectionReady &&
      Boolean(selectedCohort && !selectedCohort.is_fully_booked),
    onOpen: () => {
      if (!selectedCohort) {
        return;
      }
      trackBookingBeginCheckout({
        sectionId: 'my-best-auntie-booking',
        ctaLocation: 'query_param',
        value: selectedCohort.price,
        serviceTier: selectedCohort.service_tier,
        cohortLabel: selectedCohort.cohort,
        cohortDate: selectedCohort.dates[0]?.start_datetime?.split('T')[0] ?? '',
        items: [{
          item_id: `mba-${selectedCohort.service_tier}`,
          item_name: 'My Best Auntie',
          item_category: selectedCohort.service_tier,
          price: selectedCohort.price,
          quantity: 1,
        }],
      });
      trackMetaPixelEvent('InitiateCheckout', { content_name: PIXEL_CONTENT_NAME.my_best_auntie });
      setIsPaymentModalOpen(true);
    },
  });

  useBookingThankYouView({
    isOpen: isThankYouModalOpen,
    reservationSummary,
    sectionId: 'my-best-auntie-booking',
  });

  function handleDateCarouselNavigation(direction: 'prev' | 'next') {
    scrollDateCarouselByDirection(direction);
  }

  return (
    <>
      <SectionShell
        id='my-best-auntie-booking'
        ariaLabel={content.title}
        dataFigmaNode='my-best-auntie-booking'
        className='es-my-best-auntie-booking-section'
      >
        <SectionContainer
          className={buildSectionSplitLayoutClassName(
            'es-section-split-layout--my-best-auntie-booking w-full min-w-0 items-center',
          )}
        >
          <div className='space-y-5 max-w-[620px] lg:pr-8'>
            <SectionHeader
              title={content.title}
              titleAs='h2'
              align='left'
              className='max-w-[620px]'
              titleClassName='es-my-best-auntie-booking-heading'
              description={content.description}
              descriptionClassName='mt-5 max-w-[58ch] es-type-body es-my-best-auntie-booking-body'
            />

            <div className='pt-3'>
              <div
                data-testid='my-best-auntie-next-cohort-card'
                className='w-full max-w-[410px] rounded-inner border es-border-warm-2 es-bg-surface-soft px-5 py-4'
              >
                <p className='text-base font-semibold es-text-brand'>
                  {nextCohortLabel}
                </p>
                <p className='es-type-subtitle-lg mt-1 es-text-heading'>
                  {nextCohortPreview}
                </p>
                {nextCohortPriceLabel ? (
                  <p className='mt-1 text-base font-semibold es-text-heading'>
                    {nextCohortPriceLabel}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <aside className='mx-auto w-full min-w-0 max-w-[573px] lg:ml-auto lg:mr-0'>
            <h2 className='text-[1.6rem] font-semibold es-text-heading'>
              {content.eyebrow}
            </h2>

            <div
              className='mt-4'
              aria-live={isCohortsLoading || hasCohortsRequestError ? 'polite' : undefined}
            >
              {isCohortsLoading ? (
                <EventsLoadingState
                  label={content.cohortsLoadingLabel}
                  testId='my-best-auntie-cohorts-loading'
                />
              ) : null}
              {hasCohortsRequestError && !isCohortsLoading ? (
                <p className='text-sm text-black/60'>{content.cohortsErrorLabel}</p>
              ) : null}
            </div>

            <div className='mt-6'>
              <h3 className='text-sm font-semibold es-text-neutral-strong'>
                {content.ageSelectorLabel}
              </h3>
              <div className='mt-3 flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'>
                {ageOptions.map((option) => {
                  const isSelected = option.id === selectedAgeId;

                  return (
                    <ButtonPrimitive
                      key={option.id}
                      variant='selection'
                      state={isSelected ? 'active' : 'inactive'}
                      aria-pressed={isSelected}
                      onClick={() => {
                        trackAnalyticsEvent('booking_age_selected', {
                          sectionId: 'my-best-auntie-booking',
                          ctaLocation: 'selector',
                          params: {
                            service_tier: option.label,
                          },
                        });
                        setAgeOverride(option.id);
                        setDateOverride('');
                      }}
                      className={`${BOOKING_SELECTOR_CARD_CLASSNAME} w-[140px] snap-center text-left sm:w-[168px]`}
                    >
                      <div className='flex items-center justify-start gap-4 sm:gap-10'>
                        <Image
                          src={option.iconSrc}
                          alt=''
                          width={48}
                          height={48}
                          className='h-12 w-12'
                          aria-hidden='true'
                        />
                        <span className='text-lg font-semibold es-text-heading'>
                          {option.label}
                        </span>
                      </div>
                    </ButtonPrimitive>
                  );
                })}
              </div>
            </div>

            <div className='mt-7'>
              <h3 className='text-sm font-semibold es-text-neutral-strong'>
                {content.dateSelectorLabel}
              </h3>
              <div className='mt-3 w-full min-w-0 overflow-visible'>
                <CarouselHorizontalArrowControls
                  showPrevious={Boolean(hasDateNavigation && canScrollDateLeft)}
                  showNext={Boolean(hasDateNavigation && canScrollDateRight)}
                  onPrevious={() => {
                    handleDateCarouselNavigation('prev');
                  }}
                  onNext={() => {
                    handleDateCarouselNavigation('next');
                  }}
                  previousAriaLabel={content.scrollDatesLeftAriaLabel}
                  nextAriaLabel={content.scrollDatesRightAriaLabel}
                >
                  <CarouselTrack
                    carouselRef={dateCarouselRef}
                    testId='my-best-auntie-booking-date-carousel'
                    ariaLabel={content.dateSelectorLabel}
                    ariaRoleDescription={commonAccessibility.carouselRoleDescription}
                    className='flex min-w-0 gap-3 pb-2 pr-1'
                  >
                    {dateOptions.map((option) => {
                      const isSelected = option.id === selectedDateId;
                      const isFullyBooked = option.isFullyBooked;

                      return (
                        <ButtonPrimitive
                          key={option.id}
                          buttonRef={(element) => {
                            dateCardRefs.current[option.id] = element;
                          }}
                          variant='selection'
                          state={isFullyBooked ? 'inactive' : isSelected ? 'active' : 'inactive'}
                          aria-pressed={isFullyBooked ? undefined : isSelected}
                          aria-disabled={isFullyBooked || undefined}
                          onClick={
                            isFullyBooked
                              ? undefined
                              : () => {
                                  trackAnalyticsEvent('booking_date_selected', {
                                    sectionId: 'my-best-auntie-booking',
                                    ctaLocation: 'selector',
                                    params: {
                                      service_tier: selectedAgeOption?.label ?? '',
                                      cohort_label: option.label,
                                      cohort_date: option.cohort.dates[0]?.start_datetime?.split('T')[0]
                                        ?? '',
                                      is_fully_booked: option.isFullyBooked,
                                    },
                                  });
                                  setDateOverride(option.id);
                                }
                          }
                          className={`${BOOKING_SELECTOR_CARD_CLASSNAME} relative w-[140px] snap-center text-center sm:w-[168px] ${isFullyBooked ? 'pointer-events-none' : ''}`}
                        >
                          {isFullyBooked && (
                            <span className='es-cohort-sold-out-stamp' aria-hidden='true'>
                              <span className='es-cohort-sold-out-stamp-text'>
                                {content.soldOutStampLabel}
                              </span>
                            </span>
                          )}
                          <div className={`flex w-full flex-col items-center gap-2 ${isFullyBooked ? 'opacity-40' : ''}`}>
                            <div className='flex items-center justify-center gap-1.5'>
                              <span
                                className={`h-6 w-6 shrink-0 es-mask-calendar-current ${isSelected && !isFullyBooked ? 'es-btn-selection-icon-active' : 'es-btn-selection-icon-inactive'}`}
                                aria-hidden='true'
                              />
                              <p className='text-base font-semibold es-text-heading whitespace-nowrap'>
                                {option.label}
                              </p>
                            </div>
                            <p className='text-center text-sm es-text-danger-accent'>
                              {option.availabilityLabel}
                            </p>
                          </div>
                        </ButtonPrimitive>
                      );
                    })}
                  </CarouselTrack>
                </CarouselHorizontalArrowControls>
              </div>
            </div>

            <div className='mt-7 flex flex-wrap items-center gap-3'>
              <ButtonPrimitive
                variant='primary'
                onClick={() => {
                  if (!selectedCohort || selectedCohort.is_fully_booked) {
                    return;
                  }
                  trackAnalyticsEvent('booking_confirm_pay_click', {
                    sectionId: 'my-best-auntie-booking',
                    ctaLocation: 'booking_section',
                    params: {
                      service_tier: selectedAgeOption?.label ?? '',
                      cohort_label: selectedDateOption?.label ?? '',
                      cohort_date: selectedCohort.dates[0]?.start_datetime?.split('T')[0] ?? '',
                      total_amount: selectedCohort.price,
                    },
                  });
                  trackBookingBeginCheckout({
                    sectionId: 'my-best-auntie-booking',
                    ctaLocation: 'booking_section',
                    value: selectedCohort.price,
                    serviceTier: selectedAgeOption?.label ?? '',
                    cohortLabel: selectedDateOption?.label ?? '',
                    cohortDate: selectedCohort.dates[0]?.start_datetime?.split('T')[0] ?? '',
                    items: [{
                      item_id: `mba-${selectedCohort.service_tier}`,
                      item_name: 'My Best Auntie',
                      item_category: selectedCohort.service_tier,
                      price: selectedCohort.price,
                      quantity: 1,
                    }],
                  });
                  trackMetaPixelEvent('InitiateCheckout', {
                    content_name: PIXEL_CONTENT_NAME.my_best_auntie,
                  });
                  trackMetaPixelEvent('AddPaymentInfo', {
                    content_name: PIXEL_CONTENT_NAME.my_best_auntie,
                    value: selectedCohort.price,
                    currency: 'HKD',
                  });
                  setIsPaymentModalOpen(true);
                }}
                disabled={
                  dateOptions.length === 0
                  || !selectedCohort
                  || selectedCohort.is_fully_booked
                }
              >
                {content.confirmAndPayLabel}
              </ButtonPrimitive>
              {privateProgrammeWhatsappHref ? (
                <ButtonPrimitive
                  variant='primary'
                  className='es-btn--outline'
                  href={privateProgrammeWhatsappHref}
                >
                  {({ isExternalHttp }) => (
                    <ExternalLinkInlineContent isExternalHttp={isExternalHttp}>
                      {content.privateProgrammeCtaLabel}
                    </ExternalLinkInlineContent>
                  )}
                </ButtonPrimitive>
              ) : null}
            </div>
          </aside>
        </SectionContainer>
      </SectionShell>

      {isPaymentModalOpen && (
        <MyBestAuntieBookingModal
          locale={locale}
          modalContent={modalContent}
          paymentModalContent={bookingModalContent.paymentModal}
          selectedCohort={selectedCohort}
          selectedCohortDateLabel={selectedDateOption?.label ?? ''}
          selectedServiceTierLabel={selectedAgeOption?.label ?? ''}
          prefilledDiscountCode={prefilledDiscountCode}
          referralAppliedNote={content.referralAppliedNote}
          referralAppliedAnnouncement={commonAccessibility.referralAppliedAnnouncement}
          thankYouRecapLabels={buildThankYouRecapLabels(bookingModalContent.thankYouModal)}
          onClose={() => {
            setIsPaymentModalOpen(false);
          }}
          onSubmitReservation={(summary) => {
            setReservationSummary(summary);
            setIsPaymentModalOpen(false);
            setIsThankYouModalOpen(true);
          }}
        />
      )}

      {isThankYouModalOpen && (
        <MyBestAuntieThankYouModal
          locale={locale}
          content={bookingModalContent.thankYouModal}
          summary={reservationSummary}
          whatsappHref={thankYouWhatsappHref}
          whatsappCtaLabel={thankYouWhatsappCtaLabel}
          onClose={() => {
            setIsThankYouModalOpen(false);
          }}
        />
      )}
    </>
  );
}
