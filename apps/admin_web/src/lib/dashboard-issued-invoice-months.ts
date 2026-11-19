import type { CustomerInvoiceSummary } from '@/lib/billing-api';
import {
  formatInstantAsHongKongDateString,
  parseIsoDateOnly,
  todayHongKongDateString,
} from '@/lib/fiscal-year';
import { parseMoneyAmountString } from '@/lib/vendor-spend';

export const ISSUED_INVOICE_MONTH_COUNT = 6;

const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface IssuedInvoiceMonthTotal {
  /** `YYYY-MM` in the Hong Kong calendar. */
  monthKey: string;
  label: string;
  total: number;
}

export interface IssuedInvoiceMonthReport {
  /** Current month first, then the five preceding months. */
  months: IssuedInvoiceMonthTotal[];
  skippedForeignCurrencies: string[];
}

interface YearMonth {
  year: number;
  month: number;
}

function yearMonthFromHongKongDate(date: string): YearMonth {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
  };
}

function addMonths(origin: YearMonth, delta: number): YearMonth {
  const absolute = origin.year * 12 + (origin.month - 1) + delta;
  const year = Math.floor(absolute / 12);
  const monthIndex = absolute - year * 12;
  return { year, month: monthIndex + 1 };
}

function toMonthKey(value: YearMonth): string {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}`;
}

function toMonthLabel(value: YearMonth): string {
  return `${MONTH_ABBREVIATIONS[value.month - 1]} ${value.year}`;
}

function recentIssuedInvoiceMonths(now: Date): YearMonth[] {
  const anchor = yearMonthFromHongKongDate(todayHongKongDateString(now));
  const months: YearMonth[] = [];
  for (let offset = 0; offset < ISSUED_INVOICE_MONTH_COUNT; offset += 1) {
    months.push(addMonths(anchor, -offset));
  }
  return months;
}

function classificationDate(invoice: CustomerInvoiceSummary): string | null {
  return (
    parseIsoDateOnly(invoice.invoiceDate ?? null) ??
    formatInstantAsHongKongDateString(invoice.issuedAt ?? null)
  );
}

function windowKeysFor(now: Date): Set<string> {
  return new Set(recentIssuedInvoiceMonths(now).map(toMonthKey));
}

function invoiceCountsInWindow(
  invoice: CustomerInvoiceSummary,
  keys: Set<string>,
): string | null {
  if (invoice.status !== 'issued') {
    return null;
  }
  const date = classificationDate(invoice);
  if (!date) {
    return null;
  }
  const key = date.slice(0, 7);
  return keys.has(key) ? key : null;
}

export function collectIssuedInvoiceMonthForeignCurrencies(
  invoices: CustomerInvoiceSummary[],
  targetCurrencyCode: string,
  now: Date = new Date(),
): string[] {
  const target = targetCurrencyCode.trim().toUpperCase();
  const keys = windowKeysFor(now);
  const codes = new Set<string>();
  for (const invoice of invoices) {
    if (!invoiceCountsInWindow(invoice, keys)) {
      continue;
    }
    if (parseMoneyAmountString(invoice.total ?? null) == null) {
      continue;
    }
    const currency = invoice.currency?.trim().toUpperCase() || target;
    if (currency !== target) {
      codes.add(currency);
    }
  }
  return Array.from(codes).sort();
}

export function buildIssuedInvoiceMonthTotals(
  invoices: CustomerInvoiceSummary[],
  multipliersToTarget: Map<string, number>,
  targetCurrencyCode: string,
  now: Date = new Date(),
): IssuedInvoiceMonthReport {
  const target = targetCurrencyCode.trim().toUpperCase();
  const months = recentIssuedInvoiceMonths(now);
  const totals = new Map(months.map((month) => [toMonthKey(month), 0]));
  const keys = new Set(totals.keys());
  const skipped = new Set<string>();

  for (const invoice of invoices) {
    const key = invoiceCountsInWindow(invoice, keys);
    if (!key) {
      continue;
    }
    const amount = parseMoneyAmountString(invoice.total ?? null);
    if (amount == null) {
      continue;
    }
    const currency = invoice.currency?.trim().toUpperCase() || target;
    if (currency === target) {
      totals.set(key, (totals.get(key) ?? 0) + amount);
      continue;
    }
    const multiplier = multipliersToTarget.get(currency);
    if (multiplier == null || !Number.isFinite(multiplier)) {
      skipped.add(currency);
      continue;
    }
    totals.set(key, (totals.get(key) ?? 0) + amount * multiplier);
  }

  return {
    months: months.map((month) => {
      const monthKey = toMonthKey(month);
      return {
        monthKey,
        label: toMonthLabel(month),
        total: totals.get(monthKey) ?? 0,
      };
    }),
    skippedForeignCurrencies: Array.from(skipped).sort(),
  };
}
