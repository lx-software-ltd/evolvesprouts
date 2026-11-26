import type { CrmApiClient } from '@/lib/crm-api-client';

export const RESERVATIONS_API_PATH = '/v1/public/reservations';

/** Machine code for how the attendee will pay; matches booking modal analytics. */
export type ReservationPaymentMethodCode =
  | 'fps_qr'
  | 'bank_transfer'
  | 'stripe'
  | 'free';

export interface ReservationSubmissionPayload {
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone: string;
  /** ISO 3166-1 alpha-2; optional — server defaults when omitted. */
  attendeeCountry?: string;
  /**
   * Parent-facing tier label; optional. Omit for flows without a tier selector (e.g. events);
   * flows that collect a label (MBA, consultation) send the selected value as `serviceTier`.
   */
  serviceTier?: string;
  /** Optional display label only (not identity). */
  cohortDate?: string;
  interestedTopics?: string;
  discountCode?: string;
  totalAmount: number;
  reservationPendingUntilPaymentConfirmed: boolean;
  agreedToTermsAndConditions: boolean;
  paymentMethod: ReservationPaymentMethodCode;
  stripePaymentIntentId?: string;
  marketingOptIn?: boolean;
  locale?: string;
  title?: string;
  /** Parent service public key (required for all booking systems). */
  serviceKey: string;
  /** Optional booking flow code (e.g. event vs MBA vs consultation). */
  bookingSystem?: string;
  /**
   * Public `service_instances.slug` for event-booking and my-best-auntie-booking.
   * Omit for consultation-booking and intro-call-booking (resolved by `serviceKey` only).
   */
  serviceInstanceSlug?: string;
  /**
   * Optional cohort display label for the selected instance (e.g. MBA cohort title).
   * Shown on internal sales recap; not used for booking identity.
   */
  serviceInstanceCohort?: string;
  scheduleDate?: string;
  scheduleTime?: string;
  /** Consultation booking: writing focus title for confirmation email Details row. */
  consultationWritingFocusLabel?: string;
  /** Consultation booking: level title for confirmation email Details row. */
  consultationLevelLabel?: string;
  /**
   * Label for the free-text question field (topics / notes). Sent for internal sales recap.
   */
  commentsFieldLabel?: string;
  locationName?: string;
  /** Venue address line for confirmation email (combined with locationName). */
  locationAddress?: string;
  /**
   * Primary session start as ISO 8601 (e.g. from course session datetime).
   * Used for HKT date/time in the confirmation email when the venue is in Hong Kong.
   */
  primarySessionStartIso?: string;
  /** Primary session end as ISO 8601 when known (e.g. multi-hour session). Used for email .ics DTEND. */
  primarySessionEndIso?: string;
  /** All session parts for multi-line schedule in confirmation email (MBA, etc.). */
  sessionSlots?: Array<{ startIso: string; endIso?: string }>;
  /** Optional UTM / referrer attribution for public intro-call flow. */
  marketingAttribution?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    referrer?: string;
  };
  /** Maps URL for optional "Get directions" link in confirmation email. */
  locationUrl?: string;
  /**
   * PNG data URL from the same FPS QR as the booking modal; backend inlines it
   * in the confirmation email when payment is pending (fps_qr).
   */
  fpsQrImageDataUrl?: string;
}

interface SubmitReservationOptions {
  payload: ReservationSubmissionPayload;
  turnstileToken: string;
}

export async function submitReservation(
  crmApiClient: CrmApiClient,
  options: SubmitReservationOptions,
): Promise<void> {
  await crmApiClient.request({
    endpointPath: RESERVATIONS_API_PATH,
    method: 'POST',
    body: options.payload,
    turnstileToken: options.turnstileToken,
    expectedSuccessStatuses: [200, 202],
  });
}
