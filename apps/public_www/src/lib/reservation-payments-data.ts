import type { CrmApiClient } from '@/lib/crm-api-client';

export const RESERVATION_PAYMENT_INTENT_API_PATH = '/v1/public/reservations/payment-intent';

export interface ReservationPaymentIntentPayload {
  service_tier: string;
  cohort_date: string;
  discount_code?: string;
  service_key?: string;
  cohort_id?: string;
  price: number;
}

interface CreateReservationPaymentIntentOptions {
  payload: ReservationPaymentIntentPayload;
  turnstileToken: string;
  signal?: AbortSignal;
}

export interface ReservationPaymentIntentResponse {
  payment_intent_id: string;
  client_secret: string;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readRequiredText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Missing required payment response field');
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Missing required payment response field');
  }
  return normalized;
}

function normalizePaymentIntentResponse(payload: unknown): ReservationPaymentIntentResponse {
  const record = toRecord(payload);
  if (!record) {
    throw new Error('Unexpected payment intent response');
  }

  return {
    payment_intent_id: readRequiredText(record.payment_intent_id),
    client_secret: readRequiredText(record.client_secret),
  };
}

export async function createReservationPaymentIntent(
  crmApiClient: CrmApiClient,
  options: CreateReservationPaymentIntentOptions,
): Promise<ReservationPaymentIntentResponse> {
  const normalizedTurnstileToken = options.turnstileToken.trim();
  if (!normalizedTurnstileToken) {
    throw new Error('Missing required turnstile token');
  }

  const payload = await crmApiClient.request({
    endpointPath: RESERVATION_PAYMENT_INTENT_API_PATH,
    method: 'POST',
    body: options.payload,
    turnstileToken: normalizedTurnstileToken,
    signal: options.signal,
    expectedSuccessStatuses: [200],
  });

  return normalizePaymentIntentResponse(payload);
}
