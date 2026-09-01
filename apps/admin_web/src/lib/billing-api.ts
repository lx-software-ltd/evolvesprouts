import { appendRelatedPartyQuery, type RelatedPartyQuery } from '@/lib/contact-related-links';
import { adminApiRequest } from '@/lib/api-admin-client';
import { unwrapPayload } from '@/lib/api-payload';
import { getAdminDefaultCurrencyCode } from '@/lib/config';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export type CustomerPaymentSummary = ApiSchemas['CustomerPaymentSummary'];

export type CustomerPaymentDetail = CustomerPaymentSummary & {
  allocationInvoices?: { invoiceId: string; invoiceNumber: string | null }[];
};

export type CustomerInvoiceSummary = ApiSchemas['CustomerInvoiceSummary'];

export type CustomerInvoiceDetail = ApiSchemas['CustomerInvoiceDetail'];

const CUSTOMER_INVOICE_LIST_PAGE_LIMIT = 100;

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
  const query = new URLSearchParams();
  if (params.status) {
    query.set('status', params.status);
  }
  if (params.settlement) {
    query.set('settlement', params.settlement);
  }
  if (params.currency && params.currency.trim() !== '') {
    query.set('currency', params.currency.trim().toUpperCase());
  }
  const qTrimmed = params.q?.trim() ?? '';
  if (qTrimmed !== '') {
    query.set('q', qTrimmed);
  }
  appendRelatedPartyQuery(query, params);
  if (params.cursor) {
    query.set('cursor', params.cursor);
  }
  if (params.limit != null) {
    query.set(
      'limit',
      String(Math.min(Math.floor(params.limit), CUSTOMER_INVOICE_LIST_PAGE_LIMIT)),
    );
  }
  const qs = query.toString();
  const payload = await adminApiRequest<{
    items?: CustomerInvoiceSummary[];
    next_cursor?: string | null;
  }>({
    endpointPath: qs ? `/v1/admin/billing/invoices?${qs}` : '/v1/admin/billing/invoices',
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return {
    items: Array.isArray(root.items) ? root.items : [],
    next_cursor: root.next_cursor ?? null,
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
        limit: CUSTOMER_INVOICE_LIST_PAGE_LIMIT,
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
  const root = unwrapPayload(payload);
  if (!root.invoice) {
    throw new Error('Invoice response missing invoice.');
  }
  return root.invoice;
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
  const root = unwrapPayload(payload);
  const downloadUrl = root.downloadUrl;
  const expiresAt = root.expiresAt;
  if (!downloadUrl || !expiresAt) {
    throw new Error('Invoice PDF response missing download URL.');
  }
  return { downloadUrl, expiresAt };
}

export async function listCustomerPayments(
  params: { invoiceId?: string } = {},
  signal?: AbortSignal,
): Promise<CustomerPaymentSummary[]> {
  const query = new URLSearchParams();
  const inv = params.invoiceId?.trim();
  if (inv) {
    query.set('invoice_id', inv);
  }
  const qs = query.toString();
  const payload = await adminApiRequest<{ items?: CustomerPaymentSummary[] }>({
    endpointPath: qs ? `/v1/admin/billing/payments?${qs}` : '/v1/admin/billing/payments',
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return Array.isArray(root.items) ? root.items : [];
}

export async function getCustomerPayment(id: string, signal?: AbortSignal): Promise<CustomerPaymentDetail> {
  const payload = await adminApiRequest<CustomerPaymentDetail>({
    endpointPath: `/v1/admin/billing/payments/${id}`,
    method: 'GET',
    signal,
  });
  return unwrapPayload(payload);
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
  const root = unwrapPayload(payload);
  if (!root.payment) {
    throw new Error('Confirm payment response missing payment.');
  }
  return root.payment;
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
  const root = unwrapPayload(payload);
  if (!root.payment) {
    throw new Error('Refund response missing payment.');
  }
  return root.payment;
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
  const root = unwrapPayload(payload);
  if (!root.payment) {
    throw new Error('Create payment response missing payment.');
  }
  return root.payment;
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
  const root = unwrapPayload(payload);
  if (!root.payment) {
    throw new Error('Update payment response missing payment.');
  }
  return root.payment;
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
    const query = new URLSearchParams();
    query.set('limit', '500');
    if (params?.q != null && params.q.trim() !== '') {
      query.set('q', params.q.trim());
    }
    if (cursor) {
      query.set('cursor', cursor);
    }
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
        endpointPath: `/v1/admin/billing/enrollments/recent-for-invoicing?${query.toString()}`,
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
    const root = unwrapPayload(payload);
    const page = Array.isArray(root.items) ? root.items : [];
    merged.push(...page);
    if (root.truncated) {
      truncatedOverall = true;
    }
    const next =
      typeof root.next_cursor === 'string' && root.next_cursor.trim() !== ''
        ? root.next_cursor.trim()
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
  const root = unwrapPayload(payload);
  const invoiceId = typeof root.invoiceId === 'string' ? root.invoiceId : '';
  if (!invoiceId) {
    throw new Error('Create invoice response missing invoiceId.');
  }
  return { invoiceId, status: typeof root.status === 'string' ? root.status : 'draft' };
}

export async function issueInvoice(invoiceId: string): Promise<{
  invoiceId: string;
  invoiceNumber?: string;
  issuedPdfSha256?: string | null;
}> {
  const payload = await adminApiRequest<{
    invoiceId?: string;
    invoiceNumber?: string;
    issuedPdfSha256?: string | null;
  }>({
    endpointPath: `/v1/admin/billing/invoices/${invoiceId}/issue`,
    method: 'POST',
  });
  const root = unwrapPayload(payload);
  const id =
    typeof root.invoiceId === 'string' && root.invoiceId.trim() !== '' ? root.invoiceId : invoiceId;
  if (!id) {
    throw new Error('Issue invoice response missing invoiceId.');
  }
  return {
    invoiceId: id,
    invoiceNumber: root.invoiceNumber,
    issuedPdfSha256: root.issuedPdfSha256,
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
  const root = unwrapPayload(payload);
  const id = typeof root.invoiceId === 'string' ? root.invoiceId : invoiceId;
  return { invoiceId: id, status: typeof root.status === 'string' ? root.status : 'void' };
}

export async function emailInvoice(invoiceId: string, toEmail: string): Promise<{ sent: boolean }> {
  const payload = await adminApiRequest<{ sent?: boolean }>({
    endpointPath: `/v1/admin/billing/invoices/${invoiceId}/email`,
    method: 'POST',
    body: { toEmail },
  });
  const root = unwrapPayload(payload);
  return { sent: Boolean(root.sent) };
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
  const root = unwrapPayload(payload);
  const allocationId = typeof root.allocationId === 'string' ? root.allocationId : '';
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
  const root = unwrapPayload(payload);
  if (!root.familyPrimaryContactById || !root.organizationPrimaryContactById) {
    throw new Error('Resolve bill-to primary contacts response missing maps.');
  }
  return root;
}

export async function exportBillingCsv(
  exportVersion: '1' | '2' = '2',
  signal?: AbortSignal,
): Promise<string> {
  const query = new URLSearchParams();
  query.set('exportVersion', exportVersion);
  const payload = await adminApiRequest<{ csv?: string }>({
    endpointPath: `/v1/admin/billing/export?${query.toString()}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  if (typeof root.csv !== 'string') {
    throw new Error('Export response missing csv.');
  }
  return root.csv;
}
