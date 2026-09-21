'use client';

import { useMemo } from 'react';

import {
  OverlayDialogPanel,
  OverlayScrollableBody,
} from '@/components/shared/overlay-surface';
import {
  CloseButton,
  ModalOverlay,
} from '@/components/sections/booking-modal/shared';
import { useBookingModalScaffold } from '@/components/sections/booking-modal/use-booking-modal-scaffold';
import {
  type BookingEventDetailPart,
  BookingEventDetails,
} from '@/components/sections/booking-modal/event-details';
import { BookingReservationForm } from '@/components/sections/booking-modal/reservation-form';
import type { MetaPixelContentName } from '@/lib/meta-pixel';
import { PIXEL_CONTENT_NAME } from '@/lib/meta-pixel-taxonomy';
import type {
  BookingThankYouRecapLabelTemplates,
  ReservationSummary,
} from '@/components/sections/booking-modal/types';
import {
  type BookingPaymentModalContent,
  getContent,
  type Locale,
  type MyBestAuntieModalContent,
} from '@/content';
import {
  MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY,
  MY_BEST_AUNTIE_BOOKING_SYSTEM,
  resolveBookingVenueDisplay,
  type MyBestAuntieEventCohort,
} from '@/lib/events-data';
import { formatContentTemplate } from '@/content/content-field-utils';
import {
  formatCohortValue,
  formatPartDateTimeLabel,
} from '@/lib/format';
import { formatMyBestAuntiePhaseWindowDateLabels } from '@/lib/site-datetime';

interface MyBestAuntieBookingModalProps {
  locale?: Locale;
  modalContent: MyBestAuntieModalContent;
  paymentModalContent: BookingPaymentModalContent;
  selectedCohort: MyBestAuntieEventCohort | null;
  selectedCohortDateLabel?: string;
  selectedServiceTierLabel?: string;
  prefilledDiscountCode?: string;
  referralAppliedNote?: string;
  referralAppliedAnnouncement?: string;
  analyticsSectionId?: string;
  metaPixelContentName?: MetaPixelContentName;
  captchaWidgetAction?: string;
  thankYouRecapLabels?: BookingThankYouRecapLabelTemplates;
  onClose: () => void;
  onSubmitReservation: (summary: ReservationSummary) => void;
}

export function MyBestAuntieBookingModal({
  locale = 'en',
  modalContent,
  paymentModalContent,
  selectedCohort,
  selectedCohortDateLabel = '',
  selectedServiceTierLabel = '',
  prefilledDiscountCode = '',
  referralAppliedNote = '',
  referralAppliedAnnouncement = '',
  analyticsSectionId = 'my-best-auntie-booking',
  metaPixelContentName = PIXEL_CONTENT_NAME.my_best_auntie,
  captchaWidgetAction = 'mba_reservation_submit',
  thankYouRecapLabels,
  onClose,
  onSubmitReservation,
}: MyBestAuntieBookingModalProps) {
  const {
    modalPanelRef,
    closeButtonRef,
    dialogTitleId,
    dialogDescriptionId,
  } = useBookingModalScaffold(onClose);

  const originalAmount = selectedCohort?.price ?? 0;

  const activePartRows = useMemo<BookingEventDetailPart[]>(() => {
    return (selectedCohort?.dates ?? []).map((part) => {
      const phaseWindow = formatMyBestAuntiePhaseWindowDateLabels(
        part.start_datetime,
        locale,
      );
      const dateLabel =
        phaseWindow !== null
          ? formatContentTemplate(modalContent.weekRangeHeadlineTemplate, {
              startDate: phaseWindow.startLabel,
              endDate: phaseWindow.endLabel,
            })
          : formatPartDateTimeLabel(part.start_datetime, locale);
      const groupSessionDateTime = formatPartDateTimeLabel(
        part.start_datetime,
        locale,
      );
      const description = formatContentTemplate(
        modalContent.partScheduleBlockTemplate,
        {
          groupSessionDateTime,
        },
      );
      return {
        date: dateLabel,
        description,
      };
    });
  }, [selectedCohort, modalContent.weekRangeHeadlineTemplate, modalContent.partScheduleBlockTemplate, locale]);

  const selectedDateStartTime = selectedCohort?.dates[0]?.start_datetime ?? '';
  const selectedDateEndTime = selectedCohort?.dates[0]?.end_datetime ?? '';
  const selectedCohortDateLabelText =
    selectedCohortDateLabel || formatCohortValue(selectedCohort?.cohort ?? '', locale);
  const selectedServiceTierLabelText = selectedServiceTierLabel.trim();
  const detailsTitle = selectedServiceTierLabelText
    ? formatContentTemplate(paymentModalContent.selectedAgeGroupTitleTemplate ?? '', {
        title: modalContent.title,
        ageGroupLabel: selectedServiceTierLabelText,
      }) || modalContent.title
    : modalContent.title;
  const {
    venueName: selectedVenueName,
    venueAddress: selectedVenueAddress,
    directionHref: selectedVenueDirectionHref,
  } = resolveBookingVenueDisplay({
    isVirtual: selectedCohort?.location === 'virtual',
    locationTbc: selectedCohort?.location_tbc,
    locationName: selectedCohort?.location_name,
    locationAddress: selectedCohort?.location_address,
    directionHref: selectedCohort?.location_url,
    toBeConfirmedLabel: getContent(locale).common.locationToBeConfirmedLabel,
  });

  return (
    <ModalOverlay
      onClose={onClose}
      overlayAriaLabel={paymentModalContent.closeOverlayLabel}
    >
      <OverlayDialogPanel
        panelRef={modalPanelRef}
        ariaLabelledBy={dialogTitleId}
        ariaDescribedBy={dialogDescriptionId}
        tabIndex={-1}
        className='es-booking-modal-panel overflow-visible'
      >
        <header className='flex justify-end px-4 pb-8 pt-6 sm:px-8 sm:pt-7'>
          <CloseButton
            label={paymentModalContent.closeLabel}
            onClose={onClose}
            buttonRef={closeButtonRef}
          />
        </header>
        <OverlayScrollableBody className='pb-5 sm:pb-8'>
          <div className='relative z-10 flex flex-col gap-8 pb-9 lg:flex-row lg:gap-10 lg:pb-[72px]'>
            <BookingEventDetails
              locale={locale}
              headingId={dialogTitleId}
              title={detailsTitle}
              subtitle={modalContent.subtitle}
              content={paymentModalContent}
              activePartRows={activePartRows}
              originalAmount={originalAmount}
              venueName={selectedVenueName}
              venueAddress={selectedVenueAddress}
              directionHref={selectedVenueDirectionHref}
              detailsVariant='my-best-auntie'
            />
            <BookingReservationForm
              // Modal open implies user intent; pre-mount Turnstile to keep Stripe PaymentIntent prefetch.
              initiallyInteracted
              locale={locale}
              content={paymentModalContent}
              eventTitle={modalContent.title}
              serviceKey={MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY}
              cohortId={selectedCohort?.slug ?? ''}
              serviceTypeLabelKey='training-course'
              bookingSystem={MY_BEST_AUNTIE_BOOKING_SYSTEM}
              serviceInstanceSlug={selectedCohort?.slug ?? ''}
              prefilledDiscountCode={prefilledDiscountCode}
              referralAppliedNote={referralAppliedNote}
              referralAppliedAnnouncement={referralAppliedAnnouncement}
              eventSubtitle={modalContent.subtitle}
              sessionSlots={(selectedCohort?.dates ?? []).map((part) => {
                return {
                  dateStartTime: part.start_datetime,
                  dateEndTime: part.end_datetime,
                };
              })}
              selectedServiceTierLabel={selectedServiceTierLabel}
              selectedCohortDateLabel={selectedCohortDateLabelText}
              selectedDateStartTime={selectedDateStartTime}
              originalPriceAmount={originalAmount}
              venueName={selectedVenueName}
              venueAddress={selectedVenueAddress}
              venueDirectionHref={selectedVenueDirectionHref}
              dateEndTime={selectedDateEndTime}
              descriptionId={dialogDescriptionId}
              analyticsSectionId={analyticsSectionId}
              metaPixelContentName={metaPixelContentName}
              captchaWidgetAction={captchaWidgetAction}
              thankYouRecapLabels={thankYouRecapLabels}
              onSubmitReservation={onSubmitReservation}
            />
          </div>

        </OverlayScrollableBody>
      </OverlayDialogPanel>
    </ModalOverlay>
  );
}
