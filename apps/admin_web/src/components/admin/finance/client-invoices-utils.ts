import { formatTruncatedId } from '@/components/admin/finance/client-invoices-format-helpers';
import {
  formatBillingEnrollmentPartyCell,
  formatEnrollmentPickerInstanceServiceDisplay,
  formatTierCohortDisplay,
} from '@/lib/format';
import type {
  BillingEnrollmentPickerRow,
  CustomerInvoiceDetail,
  CustomerPaymentDetail,
  CustomerPaymentSummary,
} from '@/lib/billing-api';

export const DRAFT_FORM_ID = 'client-billing-draft-invoice-form';
export const ALLOCATE_FORM_ID = 'client-billing-allocate-form';
export const REFUND_FORM_ID = 'client-billing-refund-form';
export const MANUAL_PAYMENT_FORM_ID = 'client-billing-manual-payment-form';
export const NO_ENROLLMENT_OPTION_VALUE = '__none__';
export const INVOICE_LIST_SEARCH_DEBOUNCE_MS = 350;

export type CustomerInvoiceLineRow = NonNullable<
  CustomerInvoiceDetail['lines']
>[number];

export function isManualInboundPaymentEditable(
  payment: CustomerPaymentSummary | CustomerPaymentDetail | null | undefined,
): boolean {
  if (!payment?.id) {
    return false;
  }
  if (payment.direction !== 'inbound') {
    return false;
  }
  const stripe = payment.stripePaymentIntentId?.trim() ?? '';
  if (stripe !== '') {
    return false;
  }
  return true;
}

export function invoiceLineSortKey(line: CustomerInvoiceLineRow): number {
  const order = line.lineOrder;
  if (typeof order === 'number' && Number.isFinite(order)) {
    return order;
  }
  return 0;
}

export function formatAllocateLineOptionLabel(
  line: CustomerInvoiceLineRow,
  index: number,
  descriptionCounts: Map<string, number>,
): string {
  const desc = line.description?.trim() ?? '';
  const base = desc !== '' ? desc : `Line ${String(index + 1)}`;
  const id = line.id?.trim() ?? '';
  if (desc !== '' && (descriptionCounts.get(desc) ?? 0) > 1 && id !== '') {
    return `${base} (${formatTruncatedId(id)})`;
  }
  return base;
}

export function formatRecentEnrollmentPaymentSelectLabel(
  row: BillingEnrollmentPickerRow,
): string {
  const party = formatBillingEnrollmentPartyCell(row).trim();
  const inst = formatEnrollmentPickerInstanceServiceDisplay(row).trim();
  if (party !== '' && inst !== '') {
    return `${party} · ${inst}`;
  }
  if (party !== '') {
    return party;
  }
  if (inst !== '') {
    return inst;
  }
  return 'Enrollment';
}

export function formatManualPaymentEnrollmentEditLabel(
  row: BillingEnrollmentPickerRow | undefined,
  partyFallback: string,
): string {
  const party = row ? formatBillingEnrollmentPartyCell(row).trim() : '';
  const inst = row
    ? formatEnrollmentPickerInstanceServiceDisplay(row).trim()
    : '';
  const tierCohort = row
    ? formatTierCohortDisplay(row.serviceTierName, row.instanceCohort).trim()
    : '';
  const parts: string[] = [];
  if (party !== '') {
    parts.push(party);
  }
  if (inst !== '') {
    parts.push(inst);
  }
  if (tierCohort !== '') {
    parts.push(tierCohort);
  }
  if (parts.length > 0) {
    return parts.join(' · ');
  }
  const fallback = partyFallback.trim();
  return fallback !== '' ? fallback : '—';
}

export function formatAmountSeedTwoDecimals(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return '';
  }
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) {
    return trimmed;
  }
  return value.toFixed(2);
}

export function currencySelectValue(
  code: string,
  options: readonly { value: string }[],
  fallback: string,
): string {
  const normalized = code.trim().toUpperCase() || fallback;
  return options.some((option) => option.value === normalized)
    ? normalized
    : fallback;
}

export function enrollmentNeedsAmountConfirmation(
  row: BillingEnrollmentPickerRow,
): boolean {
  const amountPaid = row.amountPaid?.trim() ?? '';
  if (amountPaid === '') {
    return true;
  }
  const value = Number.parseFloat(amountPaid);
  return Number.isNaN(value);
}

export function parseAmountInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const value = Number.parseFloat(trimmed);
  return Number.isNaN(value) ? null : value;
}

export function defaultLineAmount(row: BillingEnrollmentPickerRow): string {
  return row.amountPaid != null && row.amountPaid.trim() !== ''
    ? row.amountPaid.trim()
    : '0';
}

export function lineAmountsDiffer(
  input: string,
  row: BillingEnrollmentPickerRow,
): boolean {
  const trimmed = input.trim();
  const baseline = defaultLineAmount(row);
  const a = Number.parseFloat(trimmed === '' ? baseline : trimmed);
  const b = Number.parseFloat(baseline);
  if (!Number.isNaN(a) && !Number.isNaN(b)) {
    return Math.abs(a - b) > 1e-9;
  }
  return trimmed !== '' && trimmed !== baseline;
}

export function normalizeInvoiceRecipientList(raw: string): string {
  return raw
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(', ');
}
