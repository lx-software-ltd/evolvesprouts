import type { CustomerInvoiceSummary } from '@/lib/billing-api';
import {
  formatInstantAsHongKongDateString,
  getFiscalYearRangeInclusive,
  inferCurrentFiscalYearStartYear,
  isDateInInclusiveRange,
  parseIsoDateOnly,
  todayHongKongDateString,
} from '@/lib/fiscal-year';
import { formatEnumLabel } from '@/lib/format';
import { getInvoiceSettlementBadgeLabel } from '@/lib/invoice-settlement-display';
import type { Expense, ExpenseStatus } from '@/types/expenses';

export const TAX_FISCAL_YEAR_STATUS_FILTERS = [
  'recognized',
  'in_progress',
  'voided',
  'amended',
  'all',
] as const;

export type TaxFiscalYearStatusFilter = (typeof TAX_FISCAL_YEAR_STATUS_FILTERS)[number];

export const DEFAULT_TAX_FISCAL_YEAR_STATUS_FILTER: TaxFiscalYearStatusFilter = 'recognized';

export interface TaxFiscalYearRow {
  kind: 'expense' | 'revenue';
  classificationDate: string;
  description: string;
  currency: string;
  amount: string;
  tax: string;
  status: string;
  referenceId: string;
  needsInvoiceDateWarning: boolean;
  invoiceNumber: string | null;
}

function expenseClassificationDate(expense: Expense): {
  date: string | null;
  needsInvoiceDateWarning: boolean;
} {
  const invoiceOk = parseIsoDateOnly(expense.invoiceDate);
  if (invoiceOk) {
    return { date: invoiceOk, needsInvoiceDateWarning: false };
  }
  const paid = formatInstantAsHongKongDateString(expense.paidAt ?? null);
  return { date: paid, needsInvoiceDateWarning: true };
}

function revenueClassificationDate(inv: CustomerInvoiceSummary): {
  date: string | null;
  needsInvoiceDateWarning: boolean;
} {
  const invoiceOk = parseIsoDateOnly(inv.invoiceDate ?? null);
  if (invoiceOk) {
    return { date: invoiceOk, needsInvoiceDateWarning: false };
  }
  const issued = formatInstantAsHongKongDateString(inv.issuedAt ?? null);
  return { date: issued, needsInvoiceDateWarning: true };
}

function expenseMatchesStatusFilter(
  status: ExpenseStatus,
  filter: TaxFiscalYearStatusFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'recognized':
      return status === 'paid';
    case 'in_progress':
      return status === 'draft' || status === 'submitted';
    case 'voided':
      return status === 'voided';
    case 'amended':
      return status === 'amended';
  }
}

function invoiceMatchesStatusFilter(
  status: string | null | undefined,
  filter: TaxFiscalYearStatusFilter,
): boolean {
  const st = (status ?? '').trim().toLowerCase();
  switch (filter) {
    case 'all':
      return true;
    case 'recognized':
      return st === 'issued';
    case 'in_progress':
      return st === 'draft';
    case 'voided':
      return st === 'void';
    case 'amended':
      return false;
  }
}

export function buildTaxFiscalYearRows(
  expenses: Expense[],
  invoices: CustomerInvoiceSummary[],
  fyStartYear: number,
  statusFilter: TaxFiscalYearStatusFilter,
): TaxFiscalYearRow[] {
  const { start, end } = getFiscalYearRangeInclusive(fyStartYear);

  const expenseRows: TaxFiscalYearRow[] = [];
  for (const expense of expenses) {
    if (!expenseMatchesStatusFilter(expense.status, statusFilter)) {
      continue;
    }
    const { date, needsInvoiceDateWarning } = expenseClassificationDate(expense);
    if (!date || !isDateInInclusiveRange(date, start, end)) {
      continue;
    }
    const vendor = expense.vendorName?.trim() ?? '';
    expenseRows.push({
      kind: 'expense',
      classificationDate: date,
      description: vendor !== '' ? vendor : 'Expense',
      currency: expense.currency?.trim().toUpperCase() ?? '',
      amount: expense.total?.trim() ?? '',
      tax: expense.tax?.trim() ?? '',
      status: formatEnumLabel(expense.status),
      referenceId: expense.id,
      needsInvoiceDateWarning,
      invoiceNumber: expense.invoiceNumber?.trim() ?? null,
    });
  }

  const revenueRows: TaxFiscalYearRow[] = [];
  for (const inv of invoices) {
    const invId = inv.id?.trim() ?? '';
    if (invId === '') {
      continue;
    }
    if (!invoiceMatchesStatusFilter(inv.status, statusFilter)) {
      continue;
    }
    const { date: revenueDate, needsInvoiceDateWarning } = revenueClassificationDate(inv);
    if (!revenueDate || !isDateInInclusiveRange(revenueDate, start, end)) {
      continue;
    }
    const name = inv.billToDisplayName?.trim() ?? '';
    const num = inv.invoiceNumber?.trim() ?? '';
    const description =
      name !== '' && num !== '' ? `${name} (${num})` : name !== '' ? name : num !== '' ? num : 'Invoice';
    revenueRows.push({
      kind: 'revenue',
      classificationDate: revenueDate,
      description,
      currency: inv.currency?.trim().toUpperCase() ?? '',
      amount: inv.total?.trim() ?? '',
      tax: inv.taxTotal?.trim() ?? '',
      status: getInvoiceSettlementBadgeLabel(inv),
      referenceId: invId,
      needsInvoiceDateWarning,
      invoiceNumber: inv.invoiceNumber ?? null,
    });
  }

  const merged = [...expenseRows, ...revenueRows];
  merged.sort((a, b) => {
    const d = b.classificationDate.localeCompare(a.classificationDate);
    if (d !== 0) {
      return d;
    }
    return `${a.kind}:${a.referenceId}`.localeCompare(`${b.kind}:${b.referenceId}`);
  });
  return merged;
}

export function defaultFiscalYearStartYear(now: Date = new Date()): number {
  return inferCurrentFiscalYearStartYear(todayHongKongDateString(now));
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function taxFiscalYearRowsToCsv(rows: TaxFiscalYearRow[]): string {
  const headers = [
    'kind',
    'classification_date',
    'description',
    'currency',
    'amount',
    'tax',
    'status',
    'invoice_number',
    'reference_id',
    'needs_invoice_date_warning',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    const cells = [
      row.kind,
      row.classificationDate,
      row.description,
      row.currency,
      row.amount,
      row.tax,
      row.status,
      row.invoiceNumber ?? '',
      row.referenceId,
      row.needsInvoiceDateWarning ? 'yes' : 'no',
    ].map((c) => csvEscape(c));
    lines.push(cells.join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
