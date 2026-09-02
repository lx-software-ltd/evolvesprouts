import { adminApiRequest } from '@/lib/api-admin-client';
import { ADMIN_API_MAX_LIST_LIMIT, buildAdminListPath } from '@/lib/admin-list-query';
import { relatedPartyApiFilters, type RelatedPartyQuery } from '@/lib/contact-related-links';
import { getAdminDefaultCurrencyCode } from '@/lib/config';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export type CustomerPaymentSummary = ApiSchemas['CustomerPaymentSummary'];

export type CustomerPaymentDetail = CustomerPaymentSummary & {
  allocationInvoices?: { invoiceId: string; invoiceNumber: string | null }[];
};

export type CustomerInvoiceSummary = ApiSchemas['CustomerInvoiceSummary'];

export type CustomerInvoiceDetail = ApiSchemas['CustomerInvoiceDetail'];

export async function listCustomerInvoices(
  params: {
    status?: 'draft' | 'issued' | 'void';
    settlement?: 'open' | 'partially_paid' | 'paid' | 'no_charge' | 'not_completed';
    currency?: string;
    /** Case-insensitive substring on invoice number, bill-to fields, and ISO invoice date. */
    q?: string;
    cursor?: string | null;
    limit?: number;
  } & RelatedPartyQuery = {},
  signal?: AbortSignal,
): Promise<{ items: CustomerInvoiceSummary[]; next_cursor: string | null }> {
  const payload = await adminApiRequest<{
    items?: CustomerInvoiceSummary[];
    next_cursor?: string | null;
  }>({
    endpointPath: buildAdminListPath('/v1/admin/billing/invoices', {
      filters: {
        status: params.status,
        settlement: params.settlement,
        currency: params.currency?.trim().toUpperCase(),
        q: params.q,
        ...relatedPartyApiFilters(params),
      },
      cursor: params.cursor,
      limit: params.limit,
    }),
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    next_cursor: payload.next_cursor ?? null,
  };
}

/** Fetches every invoice page (for fiscal-year tax summaries). */
export async function listAllCustomerInvoices(
  params: Omit<
    Parameters<typeof listCustomerInvoices>[0],
    'cursor' | 'limit'
  > = {},
  signal?: AbortSignal,
): Promise<CustomerInvoiceSummary[]> {
  const all: CustomerInvoiceSummary[] = [];
  let cursor: string | null = null;
  do {
    const page = await listCustomerInvoices(
      {
        ...params,
        cursor,
        limit: ADMIN_API_MAX_LIST_LIMIT,
      },
      signal,
    );
    all.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return all;
}

export async function getCustomerInvoice(id: string, signal?: AbortSignal): Promise<CustomerInvoiceDetail> {
  const payload = await adminApiRequest<{ invoice?: CustomerInvoiceDetail }>({
    endpointPath: `/v1/admin/billing/invoices/${id}`,
    method: 'GET',
    signal,
  });
  if (!payload.invoice) {
    throw new Error('Invoice response missing invoice.');
  }
  return payload.invoice;
}

export async function getCustomerInvoicePdfDownload(
  id: string,
  signal?: AbortSignal,
): Promise<{ downloadUrl: string; expiresAt: string }> {
  const payload = await adminApiRequest<{ downloadUrl?: string; expiresAt?: string }>({
    endpointPath: `/v1/admin/billing/invoices/${id}/pdf`,
    method: 'GET',
    signal,
  });
  const downloadUrl = payload.downloadUrl;
  const expiresAt = payload.expiresAt;
  if (!downloadUrl || !expiresAt) {
    throw new Error('Invoice PDF response missing download URL.');
  }
  return { downloadUrl, expiresAt };
}

export async function listCustomerPayments(
  params: { invoiceId?: string; cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<{ items: CustomerPaymentSummary[]; next_cursor: string | null }> {
  const payload = await adminApiRequest<{
    items?: CustomerPaymentSummary[];
    next_cursor?: string | null;
  }>({
    endpointPath: buildAdminListPath('/v1/admin/billing/payments', {
      filters: { invoice_id: params.invoiceId },
      cursor: params.cursor,
      limit: params.limit,
    }),
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    next_cursor: payload.next_cursor ?? null,
  };
}

export async function getCustomerPayment(id: string, signal?: AbortSignal): Promise<CustomerPaymentDetail> {
  const payload = await adminApiRequest<CustomerPaymentDetail>({
    endpointPath: `/v1/admin/billing/payments/${id}`,
    method: 'GET',
    signal,
  });
  return payload;
}

export async function confirmCustomerPayment(
  id: string,
  body?: { externalReference?: string },
): Promise<CustomerPaymentSummary> {
  const payload = await adminApiRequest<{ payment?: CustomerPaymentSummary }>({
    endpointPath: `/v1/admin/billing/payments/${id}/confirm`,
    method: 'POST',
    body: body && Object.keys(body).length > 0 ? body : undefined,
  });
  if (!payload.payment) {
    throw new Error('Confirm payment response missing payment.');
  }
  return payload.payment;
}

export async function deleteCustomerPayment(id: string): Promise<void> {
  await adminApiRequest<unknown>({
    endpointPath: `/v1/admin/billing/payments/${id}`,
    method: 'DELETE',
  });
}

export async function createCustomerRefund(
  body: ApiSchemas['CreateCustomerRefundRequest'],
): Promise<CustomerPaymentSummary> {
  const payload = await adminApiRequest<{ payment?: CustomerPaymentSummary }>({
    endpointPath: '/v1/admin/billing/payments',
    method: 'POST',
    body,
    expectedSuccessStatuses: [201],
  });
  if (!payload.payment) {
    throw new Error('Refund response missing payment.');
  }
  return payload.payment;
}

export async function createManualInboundCustomerPayment(
  body: ApiSchemas['CreateManualInboundCustomerPaymentRequest'],
): Promise<CustomerPaymentSummary> {
  const payload = await adminApiRequest<{ payment?: CustomerPaymentSummary }>({
    endpointPath: '/v1/admin/billing/payments',
    method: 'POST',
    body,
    expectedSuccessStatuses: [201],
  });
  if (!payload.payment) {
    throw new Error('Create payment response missing payment.');
  }
  return payload.payment;
}

export async function updateManualInboundCustomerPayment(
  id: string,
  body: ApiSchemas['UpdateManualInboundCustomerPaymentRequest'],
): Promise<CustomerPaymentSummary> {
  const payload = await adminApiRequest<{ payment?: CustomerPaymentSummary }>({
    endpointPath: `/v1/admin/billing/payments/${id}`,
    method: 'PATCH',
    body,
  });
  if (!payload.payment) {
    throw new Error('Update payment response missing payment.');
  }
  return payload.payment;
}

/**
 * After Services creates an enrollment, record a matching inbound customer payment:
 * pending `bank_transfer` when amount is positive, or succeeded `free` at zero when amount is empty/zero.
 */
export async function createInitialCustomerPaymentAfterEnrollmentCreate(enrollment: {
  id?: string | null;
  amountPaid?: string | null;
  currency?: string | null;
}): Promise<void> {
  const enrollmentId = enrollment.id?.trim() ?? '';
  if (enrollmentId === '') {
    throw new Error('Enrollment id is required to record customer payment.');
  }
  const amountRaw = enrollment.amountPaid?.trim() ?? '';
  const parsed = amountRaw === '' ? 0 : Number.parseFloat(amountRaw);
  const isZero = amountRaw === '' || (Number.isFinite(parsed) && Math.abs(parsed) < 1e-12);
  const cur = enrollment.currency?.trim().toUpperCase() ?? '';
  const currency = cur !== '' ? cur : getAdminDefaultCurrencyCode();

  if (isZero) {
    await createManualInboundCustomerPayment({
      direction: 'inbound',
      enrollmentId,
      amount: '0',
      currency,
      method: 'free',
      status: 'succeeded',
      externalReference: null,
    });
    return;
  }

  const amount = Number.isFinite(parsed) ? String(amountRaw) : amountRaw;
  await createManualInboundCustomerPayment({
    direction: 'inbound',
    enrollmentId,
    amount,
    currency,
    method: 'bank_transfer',
    status: 'pending',
    externalReference: null,
  });
}

export type BillingEnrollmentPickerRow = ApiSchemas['BillingEnrollmentPickerRow'];

/** Newest `enrolledAt` first; rows without a date sort after dated rows. */
export function compareBillingEnrollmentPickerRowsByEnrolledAtDesc(
  a: BillingEnrollmentPickerRow,
  b: BillingEnrollmentPickerRow,
): number {
  const ta = (a.enrolledAt ?? '').trim();
  const tb = (b.enrolledAt ?? '').trim();
  if (ta !== '' && tb !== '') {
    const byTime = tb.localeCompare(ta);
    if (byTime !== 0) {
      return byTime;
    }
  } else if (ta !== '' && tb === '') {
    return -1;
  } else if (ta === '' && tb !== '') {
    return 1;
  }
  return String(b.enrollmentId).localeCompare(String(a.enrollmentId));
}

const RECENT_ENROLLMENTS_PAGE_LIMIT = 500;

export async function listRecentEnrollmentsForInvoicing(
  signal?: AbortSignal,
  params?: { q?: string },
): Promise<{ items: BillingEnrollmentPickerRow[]; truncated: boolean }> {
  const merged: BillingEnrollmentPickerRow[] = [];
  let truncatedOverall = false;
  let cursor: string | null = null;
  let guard = 0;
  while (guard < 200) {
    guard += 1;
    let payload: {
      items?: BillingEnrollmentPickerRow[];
      truncated?: boolean;
      next_cursor?: string | null;
    };
    try {
      payload = await adminApiRequest<{
        items?: BillingEnrollmentPickerRow[];
        truncated?: boolean;
        next_cursor?: string | null;
      }>({
        endpointPath: buildAdminListPath('/v1/admin/billing/enrollments/recent-for-invoicing', {
          // This endpoint allows up to 500 rows per page, above the general admin list cap.
          filters: { limit: RECENT_ENROLLMENTS_PAGE_LIMIT, q: params?.q },
          cursor,
        }),
        method: 'GET',
        signal,
      });
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') {
        throw caught;
      }
      if (merged.length > 0) {
        truncatedOverall = true;
        break;
      }
      throw caught;
    }
    const page = Array.isArray(payload.items) ? payload.items : [];
    merged.push(...page);
    if (payload.truncated) {
      truncatedOverall = true;
    }
    const next =
      typeof payload.next_cursor === 'string' && payload.next_cursor.trim() !== ''
        ? payload.next_cursor.trim()
        : null;
    if (!next) {
      break;
    }
    cursor = next;
  }

  merged.sort(compareBillingEnrollmentPickerRowsByEnrolledAtDesc);
  return { items: merged, truncated: truncatedOverall };
}

export async function createDraftInvoice(
  body:
    | ApiSchemas['CreateDraftInvoiceRequest']
    | ApiSchemas['CreateCustomizedDraftInvoiceRequest'],
): Promise<{ invoiceId: string; status: string }> {
  const payload = await adminApiRequest<{
    invoiceId?: string;
    status?: string;
  }>({
    endpointPath: '/v1/admin/billing/invoices',
    method: 'POST',
    body,
    expectedSuccessStatuses: [201],
  });
  const invoiceId = typeof payload.invoiceId === 'string' ? payload.invoiceId : '';
  if (!invoiceId) {
    throw new Error('Create invoice response missing invoiceId.');
  }
  return { invoiceId, status: typeof payload.status === 'string' ? payload.status : 'draft' };
}

export async function issueInvoice(invoiceId: string): Promise<{
  invoiceId: string;
  invoiceNumber?: string;
  issuedPdfSha256?: string | null;
  paymentId?: string | null;
}> {
  const payload = await adminApiRequest<{
    invoiceId?: string;
    invoiceNumber?: string;
    issuedPdfSha256?: string | null;
    paymentId?: string | null;
  }>({
    endpointPath: `/v1/admin/billing/invoices/${invoiceId}/issue`,
    method: 'POST',
  });
  const id =
    typeof payload.invoiceId === 'string' && payload.invoiceId.trim() !== '' ? payload.invoiceId : invoiceId;
  if (!id) {
    throw new Error('Issue invoice response missing invoiceId.');
  }
  return {
    invoiceId: id,
    invoiceNumber: payload.invoiceNumber,
    issuedPdfSha256: payload.issuedPdfSha256,
    paymentId: payload.paymentId,
  };
}

export async function deleteDraftCustomerInvoice(invoiceId: string): Promise<void> {
  await adminApiRequest<unknown>({
    endpointPath: `/v1/admin/billing/invoices/${invoiceId}`,
    method: 'DELETE',
  });
}

export async function voidInvoice(invoiceId: string, reason: string): Promise<{ invoiceId: string; status: string }> {
  const payload = await adminApiRequest<{
    invoiceId?: string;
    status?: string;
  }>({
    endpointPath: `/v1/admin/billing/invoices/${invoiceId}/void`,
    method: 'POST',
    body: { reason },
  });
  const id = typeof payload.invoiceId === 'string' ? payload.invoiceId : invoiceId;
  return { invoiceId: id, status: typeof payload.status === 'string' ? payload.status : 'void' };
}

export async function emailInvoice(invoiceId: string, toEmail: string): Promise<{ sent: boolean }> {
  const payload = await adminApiRequest<{ sent?: boolean }>({
    endpointPath: `/v1/admin/billing/invoices/${invoiceId}/email`,
    method: 'POST',
    body: { toEmail },
  });
  return { sent: Boolean(payload.sent) };
}

export async function createPaymentAllocation(
  body: ApiSchemas['CreatePaymentAllocationRequest'],
): Promise<{ allocationId: string }> {
  const payload = await adminApiRequest<{ allocationId?: string }>({
    endpointPath: '/v1/admin/billing/allocations',
    method: 'POST',
    body,
    expectedSuccessStatuses: [201],
  });
  const allocationId = typeof payload.allocationId === 'string' ? payload.allocationId : '';
  if (!allocationId) {
    throw new Error('Allocation response missing allocationId.');
  }
  return { allocationId };
}

export async function resolveBillToPrimaryContacts(
  body: ApiSchemas['ResolveBillToPrimaryContactsRequest'],
  signal?: AbortSignal,
): Promise<ApiSchemas['ResolveBillToPrimaryContactsResponse']> {
  const payload = await adminApiRequest<ApiSchemas['ResolveBillToPrimaryContactsResponse']>({
    endpointPath: '/v1/admin/billing/dashboard/resolve-bill-to-primary-contacts',
    method: 'POST',
    body,
    signal,
  });
  if (!payload.familyPrimaryContactById || !payload.organizationPrimaryContactById) {
    throw new Error('Resolve bill-to primary contacts response missing maps.');
  }
  return payload;
}

export async function exportBillingCsv(
  exportVersion: '1' | '2' = '2',
  signal?: AbortSignal,
): Promise<string> {
  const payload = await adminApiRequest<{ csv?: string }>({
    endpointPath: buildAdminListPath('/v1/admin/billing/export', {
      filters: { exportVersion },
    }),
    method: 'GET',
    signal,
  });
  if (typeof payload.csv !== 'string') {
    throw new Error('Export response missing csv.');
  }
  return payload.csv;
}
