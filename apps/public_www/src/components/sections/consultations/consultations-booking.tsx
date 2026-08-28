/* eslint-disable @next/next/no-img-element -- static SVG icons from /public/images */

'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';

import { buildThankYouRecapLabels } from '@/components/sections/booking-modal/thank-you-recap-labels';
import type { ReservationSummary } from '@/components/sections/booking-modal/types';
import { useBookingThankYouView } from '@/components/sections/shared/use-booking-thank-you-view';
import { trackBookingBeginCheckout } from '@/components/sections/shared/track-booking-begin-checkout';
import { CarouselTrack } from '@/components/sections/shared/carousel-track';
import { SectionContainer } from '@/components/sections/shared/section-container';
import { SectionHeader } from '@/components/sections/shared/section-header';
import { SectionShell } from '@/components/sections/shared/section-shell';
import { ButtonPrimitive } from '@/components/shared/button-primitive';
import type {
  BookingModalContent,
  CommonAccessibilityContent,
  ConsultationsBookingContent,
  ConsultationsBookingReservationContent,
  Locale,
} from '@/content';
import enContent from '@/content/en.json';
import { formatContentTemplate } from '@/content/content-field-utils';
import { fetchConsultationCalendarBlockersSlots } from '@/lib/public-calendar-availability-api';
import {
  buildConsultationsBookingModalPayload,
  type ConsultationsBookingModalTierId,
} from '@/lib/consultations-booking-modal-payload';
import { mergeClassNames } from '@/lib/class-name-utils';
import { useHorizontalCarousel } from '@/lib/hooks/use-horizontal-carousel';
import { useHeightTransitionOnChange } from '@/lib/hooks/use-height-transition-on-change';
import { useMatchMedia } from '@/lib/hooks/use-match-media';
import { PIXEL_CONTENT_NAME } from '@/lib/meta-pixel-taxonomy';
import { trackMetaPixelEvent } from '@/lib/meta-pixel';
import type {
  ConsultationBookingPickerContent,
  ConsultationBookingModalSelectionInfo,
} from '@/components/sections/consultations/consultation-booking-modal';

const ConsultationBookingModal = dynamic(
  () =>
    import('@/components/sections/consultations/consultation-booking-modal').then(
      (module) => module.ConsultationBookingModal,
    ),
  { ssr: false },
);

const ConsultationsThankYouModal = dynamic(
  () =>
    import('@/components/sections/consultations/consultations-thank-you-modal').then(
      (module) => module.ConsultationsThankYouModal,
    ),
  { ssr: false },
);

const FOCUS_CARD_CLASSNAME =
  'w-full rounded-3xl border es-border-soft es-bg-surface-neutral px-6 py-7 text-left sm:px-8 sm:py-8';

const CONSULTATIONS_BOOKING_ICON_CIRCLE_CLASSNAME =
  'inline-flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-full border es-border-soft es-bg-surface-muted shadow-[0_8px_24px_rgba(0,0,0,0.2)]';

const LEVEL_COMPACT_SELECTOR_CLASSNAME = mergeClassNames(
  'w-full rounded-3xl border es-border-soft es-bg-surface-neutral px-3 py-4 text-center sm:px-4 md:py-5',
  'flex min-h-0 flex-col items-center justify-center gap-3',
);

/** Step 2 (level picker + description) stays columnar like mobile; width cap keeps it narrower than step 1 / CTA. */
const CONSULTATIONS_BOOKING_LEVEL_BLOCK_CLASSNAME =
  'mx-auto w-full max-w-[min(100%,22rem)] sm:max-w-[26rem] md:mx-0 md:max-w-[28rem]';

const LEVEL_FEATURES_LIST_CLASSNAME =
  'es-consultations-booking-level-features mt-3 w-full min-w-0 list-disc space-y-2 ps-5 text-left';
const LEVEL_FEATURE_LINE_CLASSNAME = 'es-type-body es-text-dim';

const MD_UP_MEDIA_QUERY = '(min-width: 768px)';

const MOBILE_CAROUSEL_SLIDE_LI_CLASSNAME =
  'flex min-h-0 w-[77.28vw] max-w-[331px] shrink-0 flex-col self-stretch snap-center sm:w-[62.56vw]';

const GRID_CARD_LI_CLASSNAME = 'flex min-h-0 flex-col';

const LEVEL_COMPACT_LI_CLASSNAME = 'flex min-h-0 min-w-0 flex-col';

function ConsultationsBookingLevelDescription({
  whatYouGetHeading,
  level,
}: {
  whatYouGetHeading: string;
  level: ConsultationsBookingContent['levels'][number];
}) {
  return (
    <div className='text-left'>
      <h4 className='text-lg font-bold es-text-heading'>{whatYouGetHeading}</h4>
      <ul className={LEVEL_FEATURES_LIST_CLASSNAME}>
        {level.features.map((feature, index) => (
          <li
            key={`${level.id}-feature-${index}`}
            className={LEVEL_FEATURE_LINE_CLASSNAME}
          >
            {feature}
          </li>
        ))}
      </ul>
      <p className='mt-4 text-sm italic es-type-body es-text-dim'>{level.bestFor}</p>
    </div>
  );
}

function mapLevelIdToBookingTier(levelId: string): ConsultationsBookingModalTierId {
  return levelId === 'deep-dive' ? 'deepDive' : 'essentials';
}

function buildConsultationPickerContent(
  paymentModal: BookingModalContent['paymentModal'],
): ConsultationBookingPickerContent {
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
    ],
    datePickerLegend: p.datePickerLegend,
    datePickerDayTemplate: p.datePickerDayTemplate,
    datePickerUnavailableDayTemplate: p.datePickerUnavailableDayTemplate,
    datePickerLoadingDayTemplate: p.datePickerLoadingDayTemplate,
    dateConfirmationNote: p.dateConfirmationNote,
  };
}

interface ConsultationsBookingProps {
  locale: Locale;
  content: ConsultationsBookingContent;
  bookingModalContent: BookingModalContent;
  thankYouWhatsappHref?: string;
  thankYouWhatsappCtaLabel?: string;
  commonAccessibility?: CommonAccessibilityContent;
}

export function ConsultationsBooking({
  locale,
  content,
  bookingModalContent,
  thankYouWhatsappHref,
  thankYouWhatsappCtaLabel,
  commonAccessibility = enContent.common.accessibility,
}: ConsultationsBookingProps) {
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [calendarBlockersStatus, setCalendarBlockersStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [calendarAvailability, setCalendarAvailability] = useState(() => ({
    unavailable_slots: [] as { date: string; period: 'am' | 'pm' | 'both' }[],
  }));
  const [thankYouSummary, setThankYouSummary] = useState<ReservationSummary | null>(
    null,
  );
  const [isThankYouOpen, setIsThankYouOpen] = useState(false);

  const [selectedFocusId, setSelectedFocusId] = useState(
    () => content.focusAreas[0]?.id ?? '',
  );
  const [selectedLevelId, setSelectedLevelId] = useState(
    () => content.levels[0]?.id ?? '',
  );
  const [hasUserChangedLevelSelection, setHasUserChangedLevelSelection] =
    useState(false);
  const [consultationModalLevelFeaturesAnimNonce, setConsultationModalLevelFeaturesAnimNonce] =
    useState(0);

  useEffect(() => {
    if (!isBookingModalOpen) {
      return;
    }
    // Per-attempt timeout and retry live inside the fetcher; this controller only
    // signals unmount / modal close.
    const controller = new AbortController();

    let cancelled = false;
    void fetchConsultationCalendarBlockersSlots(controller.signal).then((result) => {
      if (cancelled || controller.signal.aborted) {
        return;
      }
      setCalendarAvailability({ unavailable_slots: result.slots });
      setCalendarBlockersStatus(result.fetchFailed ? 'error' : 'ready');
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isBookingModalOpen]);

  useBookingThankYouView({
    isOpen: isThankYouOpen,
    reservationSummary: thankYouSummary,
    sectionId: 'consultations-booking',
  });

  const reservationForModal: ConsultationsBookingReservationContent = useMemo(() => {
    return {
      ...content.reservation,
      bookingTier: mapLevelIdToBookingTier(selectedLevelId),
    };
  }, [content.reservation, selectedLevelId]);

  const selectionLabels = useMemo(() => {
    const focus = content.focusAreas.find((a) => a.id === selectedFocusId);
    const level = content.levels.find((l) => l.id === selectedLevelId);
    return {
      focusLabel: focus?.title ?? '',
      levelLabel: level?.title ?? '',
    };
  }, [content.focusAreas, content.levels, selectedFocusId, selectedLevelId]);

  const bookingPayload = isBookingModalOpen
    ? buildConsultationsBookingModalPayload(reservationForModal, locale)
    : null;

  const modalSelectionInfo: ConsultationBookingModalSelectionInfo | undefined =
    useMemo(() => {
      const focus = content.focusAreas.find((a) => a.id === selectedFocusId);
      const level = content.levels.find((l) => l.id === selectedLevelId);
      if (!focus || !level) return undefined;
      return {
        focusLabel: focus.title,
        levelId: level.id,
        levelLabel: level.title,
        levelFeatures: level.features,
        focusLabelFormatted: formatContentTemplate(
          content.reservation.modalFocusLabelTemplate,
          { focus: focus.title },
        ),
        upgradeToDeepDiveLabel: content.reservation.upgradeToDeepDiveLabel,
      };
    }, [content.focusAreas, content.levels, content.reservation, selectedFocusId, selectedLevelId]);

  function handleUpgradeToDeepDive() {
    setConsultationModalLevelFeaturesAnimNonce((n) => n + 1);
    setSelectedLevelId('deep-dive');
  }

  const consultationPickerContent = useMemo(() => {
    return buildConsultationPickerContent(bookingModalContent.paymentModal);
  }, [bookingModalContent.paymentModal]);

  const isMdUp = useMatchMedia(MD_UP_MEDIA_QUERY);

  const levelDescriptionShellRef = useHeightTransitionOnChange(
    isMdUp,
    selectedLevelId,
  );

  const { carouselRef: focusCarouselRef } =
    useHorizontalCarousel<HTMLDivElement>({
      itemCount: content.focusAreas.length,
      enabled: !isMdUp,
      snapToItem: true,
    });

  const selectedLevel = useMemo(() => {
    return content.levels.find((l) => l.id === selectedLevelId) ?? null;
  }, [content.levels, selectedLevelId]);

  return (
    <>
      <SectionShell
        id='consultations-booking'
        ariaLabel={content.title}
        dataFigmaNode='consultations-booking'
        className={mergeClassNames(
          'es-section-bg-overlay',
          'es-my-best-auntie-booking-section',
        )}
      >
        <SectionContainer>
          <SectionHeader
            eyebrow={content.eyebrow}
            title={content.title}
            titleClassName='es-my-best-auntie-booking-heading'
          />

          <div className='mt-12'>
            <h3 className='text-xl font-semibold es-type-body'>
              {content.step1Title}
            </h3>
            <div className='relative mt-6'>
              {!isMdUp ? (
                <div className='relative'>
                  <CarouselTrack
                    carouselRef={focusCarouselRef}
                    testId='consultations-booking-focus-carousel'
                    ariaLabel={formatContentTemplate(
                      commonAccessibility.carouselLabelTemplate,
                      { title: content.step1Title },
                    )}
                    ariaRoleDescription={commonAccessibility.carouselRoleDescription}
                    className='pb-2'
                  >
                    <ul className='flex min-w-0 list-none items-stretch gap-6 ps-0'>
                      {content.focusAreas.map((area) => {
                        const isSelected = area.id === selectedFocusId;
                        return (
                          <li
                            key={area.id}
                            className={MOBILE_CAROUSEL_SLIDE_LI_CLASSNAME}
                          >
                            <ButtonPrimitive
                              type='button'
                              variant='selection'
                              state={isSelected ? 'active' : 'inactive'}
                              aria-pressed={isSelected}
                              aria-label={area.title}
                              onClick={() => {
                                setSelectedFocusId(area.id);
                              }}
                              className={mergeClassNames(
                                FOCUS_CARD_CLASSNAME,
                                'flex h-full min-h-0 flex-1 flex-col',
                              )}
                            >
                              <div className='flex justify-center'>
                                <span
                                  aria-hidden='true'
                                  className={CONSULTATIONS_BOOKING_ICON_CIRCLE_CLASSNAME}
                                >
                                  <img
                                    src={area.iconSrc}
                                    alt=''
                                    width={44}
                                    height={44}
                                    className={mergeClassNames(
                                      'h-11 w-11 shrink-0 object-contain transition-[filter] duration-200',
                                      isSelected
                                        ? 'es-consultations-booking-selection-icon-active'
                                        : 'es-consultations-booking-selection-icon-inactive',
                                    )}
                                  />
                                </span>
                              </div>
                              <h4 className='mt-5 text-lg font-bold es-text-heading'>
                                {area.title}
                              </h4>
                              <p className='mt-2 es-type-body es-text-dim'>
                                {area.description}
                              </p>
                            </ButtonPrimitive>
                          </li>
                        );
                      })}
                    </ul>
                  </CarouselTrack>
                </div>
              ) : (
                <div
                  role='group'
                  aria-label={content.step1Title}
                  data-testid='consultations-booking-focus-grid'
                >
                  <ul className='grid list-none grid-cols-3 gap-6 ps-0'>
                    {content.focusAreas.map((area) => {
                      const isSelected = area.id === selectedFocusId;
                      return (
                        <li key={area.id} className={GRID_CARD_LI_CLASSNAME}>
                          <ButtonPrimitive
                            type='button'
                            variant='selection'
                            state={isSelected ? 'active' : 'inactive'}
                            aria-pressed={isSelected}
                            aria-label={area.title}
                            onClick={() => {
                              setSelectedFocusId(area.id);
                            }}
                            className={mergeClassNames(
                              FOCUS_CARD_CLASSNAME,
                              'flex h-full min-h-0 flex-col',
                            )}
                          >
                            <div className='flex justify-center'>
                              <span
                                aria-hidden='true'
                                className={CONSULTATIONS_BOOKING_ICON_CIRCLE_CLASSNAME}
                              >
                                <img
                                  src={area.iconSrc}
                                  alt=''
                                  width={44}
                                  height={44}
                                  className={mergeClassNames(
                                    'h-11 w-11 shrink-0 object-contain transition-[filter] duration-200',
                                    isSelected
                                      ? 'es-consultations-booking-selection-icon-active'
                                      : 'es-consultations-booking-selection-icon-inactive',
                                  )}
                                />
                              </span>
                            </div>
                            <h4 className='mt-5 text-lg font-bold es-text-heading'>
                              {area.title}
                            </h4>
                            <p className='mt-2 es-type-body es-text-dim'>
                              {area.description}
                            </p>
                          </ButtonPrimitive>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className='mt-12'>
            <h3 className='text-xl font-semibold es-type-body md:hidden'>
              {content.step2Title}
            </h3>
            <div
              data-testid='consultations-booking-level-block'
              className={mergeClassNames(
                'mt-6 flex flex-col gap-6 md:mt-6',
                CONSULTATIONS_BOOKING_LEVEL_BLOCK_CLASSNAME,
              )}
            >
              <h3 className='hidden text-xl font-semibold es-type-body md:block'>
                {content.step2Title}
              </h3>
              <div
                role='group'
                aria-label={content.step2Title}
                data-testid='consultations-booking-level-grid'
                className='flex flex-col gap-6'
              >
                <ul className='grid list-none grid-cols-2 gap-3 ps-0 sm:gap-4'>
                  {content.levels.map((level) => {
                    const isSelected = level.id === selectedLevelId;
                    return (
                      <li key={level.id} className={LEVEL_COMPACT_LI_CLASSNAME}>
                        <ButtonPrimitive
                          type='button'
                          variant='selection'
                          state={isSelected ? 'active' : 'inactive'}
                          aria-pressed={isSelected}
                          aria-label={level.title}
                          onClick={() => {
                            if (level.id !== selectedLevelId) {
                              setHasUserChangedLevelSelection(true);
                            }
                            setSelectedLevelId(level.id);
                          }}
                          className={LEVEL_COMPACT_SELECTOR_CLASSNAME}
                        >
                          <span
                            aria-hidden='true'
                            className={CONSULTATIONS_BOOKING_ICON_CIRCLE_CLASSNAME}
                          >
                            <img
                              src={level.iconSrc}
                              alt=''
                              width={44}
                              height={44}
                              className={mergeClassNames(
                                'h-11 w-11 shrink-0 object-contain transition-[filter] duration-200',
                                isSelected
                                  ? 'es-consultations-booking-selection-icon-active'
                                  : 'es-consultations-booking-selection-icon-inactive',
                              )}
                            />
                          </span>
                          <span className='w-full min-w-0 max-w-full break-words text-center text-sm font-bold leading-tight es-text-heading sm:text-base'>
                            {level.title}
                          </span>
                        </ButtonPrimitive>
                      </li>
                    );
                  })}
                </ul>
                <div
                  ref={levelDescriptionShellRef}
                  className={mergeClassNames('min-w-0', isMdUp && 'overflow-hidden')}
                  aria-live='polite'
                  aria-atomic='true'
                  data-testid='consultations-booking-level-description'
                >
                  {selectedLevel ? (
                    <div
                      key={selectedLevel.id}
                      className={
                        hasUserChangedLevelSelection
                          ? 'es-consultations-booking-level-description-enter'
                          : undefined
                      }
                    >
                      <ConsultationsBookingLevelDescription
                        whatYouGetHeading={content.whatYouGetHeading}
                        level={selectedLevel}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className='mt-12 flex justify-center'>
            <ButtonPrimitive
              type='button'
              variant='primary'
              className='w-full max-w-[488px]'
              onClick={() => {
                const tier = selectedLevelId === 'deep-dive'
                  ? content.reservation.deepDive
                  : content.reservation.essentials;
                trackBookingBeginCheckout({
                  sectionId: 'consultations-booking',
                  ctaLocation: 'booking_section',
                  value: tier.priceHkd,
                  cohortLabel: selectionLabels.levelLabel,
                  cohortDate: tier.dateParts[0]?.startDateTime?.split('T')[0] ?? '',
                  items: [{
                    item_id: `consultation-${selectedLevelId}`,
                    item_name: content.reservation.modalTitle,
                    item_category: selectionLabels.focusLabel,
                    price: tier.priceHkd,
                    quantity: 1,
                  }],
                });
                trackMetaPixelEvent('InitiateCheckout', {
                  content_name: PIXEL_CONTENT_NAME.consultation_booking,
                });
                setIsBookingModalOpen(true);
                setCalendarBlockersStatus('loading');
              }}
            >
              {content.reservation.ctaLabel}
            </ButtonPrimitive>
          </div>
        </SectionContainer>
      </SectionShell>

      {bookingPayload ? (
        <ConsultationBookingModal
          locale={locale}
          paymentModalContent={bookingModalContent.paymentModal}
          bookingPayload={bookingPayload}
          calendarAvailability={calendarAvailability}
          calendarBlockersStatus={calendarBlockersStatus}
          calendarBlockersLoadingMessage={content.calendarBlockersLoadingMessage}
          calendarBlockersErrorMessage={content.calendarBlockersErrorMessage}
          pickerContent={consultationPickerContent}
          selectionInfo={modalSelectionInfo}
          levelFeaturesEnterAnimationNonce={consultationModalLevelFeaturesAnimNonce}
          analyticsSectionId='consultations-booking'
          metaPixelContentName={PIXEL_CONTENT_NAME.consultation_booking}
          captchaWidgetAction='consultation_reservation_submit'
          thankYouRecapLabels={buildThankYouRecapLabels(bookingModalContent.thankYouModal)}
          onClose={() => {
            setIsBookingModalOpen(false);
            setCalendarBlockersStatus('idle');
            setConsultationModalLevelFeaturesAnimNonce(0);
          }}
          onSubmitReservation={(summary) => {
            setIsBookingModalOpen(false);
            setCalendarBlockersStatus('idle');
            setThankYouSummary(summary);
            setIsThankYouOpen(true);
          }}
          onUpgradeToDeepDive={handleUpgradeToDeepDive}
        />
      ) : null}

      {isThankYouOpen && (
        <ConsultationsThankYouModal
          locale={locale}
          content={bookingModalContent.thankYouModal}
          summary={thankYouSummary}
          whatsappHref={thankYouWhatsappHref}
          whatsappCtaLabel={thankYouWhatsappCtaLabel}
          onClose={() => {
            setIsThankYouOpen(false);
          }}
        />
      )}
    </>
  );
}
