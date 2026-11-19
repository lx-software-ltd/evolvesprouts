import type { CustomerInvoiceSummary } from '@/lib/billing-api';
import {
  formatInstantAsHongKongDateString,
  parseIsoDateOnly,
  todayHongKongDateString,
} from '@/lib/fiscal-year';
import { parseMoneyAmountString } from '@/lib/vendor-spend';

export const ISSUED_INVOICE_MONTH_COUNT = 6;

/** How far before an issue date a published rate may still apply (weekends and holidays). */
export const ISSUED_INVOICE_FX_LOOKBACK_DAYS = 7;

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
  /** True when every amount in the month was skipped for a missing rate. */
  excludedOnly: boolean;
}

export interface IssuedInvoiceMonthReport {
  /** Current month first, then the five preceding months. */
  months: IssuedInvoiceMonthTotal[];
  skippedForeignCurrencies: string[];
}

/** Published rates for one currency, keyed by `YYYY-MM-DD`. */
export type IssuedInvoiceFxSeries = Map<string, Map<string, number>>;

interface YearMonth {
  year: number;
  month: number;
}

interface MonthBucket {
  total: number;
  included: number;
  excluded: number;
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

function addIsoDays(isoDate: string, delta: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return shifted.toISOString().slice(0, 10);
}

function toMonthKey(value: YearMonth): string {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}`;
}

function toMonthLabel(value: YearMonth, isCurrentMonth: boolean): string {
  const label = `${MONTH_ABBREVIATIONS[value.month - 1]} ${value.year}`;
  return isCurrentMonth ? `${label} (so far)` : label;
}

function recentIssuedInvoiceMonths(now: Date): YearMonth[] {
  const anchor = yearMonthFromHongKongDate(todayHongKongDateString(now));
  const months: YearMonth[] = [];
  for (let offset = 0; offset < ISSUED_INVOICE_MONTH_COUNT; offset += 1) {
    months.push(addMonths(anchor, -offset));
  }
  return months;
}

/**
 * Hong Kong date the invoice was issued. `invoiceDate` is only a fallback when
 * `issuedAt` is missing, so a backdated document date does not move the month.
 */
function classificationDate(invoice: CustomerInvoiceSummary): string | null {
  return (
    formatInstantAsHongKongDateString(invoice.issuedAt ?? null) ??
    parseIsoDateOnly(invoice.invoiceDate ?? null)
  );
}

function windowKeysFor(now: Date): Set<string> {
  return new Set(recentIssuedInvoiceMonths(now).map(toMonthKey));
}

function invoiceCountsInWindow(
  invoice: CustomerInvoiceSummary,
  keys: Set<string>,
): { key: string; date: string } | null {
  if (invoice.status !== 'issued') {
    return null;
  }
  const date = classificationDate(invoice);
  if (!date) {
    return null;
  }
  const key = date.slice(0, 7);
  return keys.has(key) ? { key, date } : null;
}

export function issuedInvoiceRateWindow(now: Date = new Date()): { startDate: string; endDate: string } {
  const months = recentIssuedInvoiceMonths(now);
  const oldest = months[months.length - 1];
  return {
    startDate: addIsoDays(`${toMonthKey(oldest)}-01`, -ISSUED_INVOICE_FX_LOOKBACK_DAYS),
    endDate: todayHongKongDateString(now),
  };
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

function rateOnOrBefore(rates: Map<string, number> | undefined, issueDate: string): number | null {
  if (!rates) {
    return null;
  }
  const exact = rates.get(issueDate);
  if (exact != null && Number.isFinite(exact)) {
    return exact;
  }
  const earliest = addIsoDays(issueDate, -ISSUED_INVOICE_FX_LOOKBACK_DAYS);
  let bestDate: string | null = null;
  let bestRate = 0;
  for (const [date, rate] of rates) {
    if (date < earliest || date > issueDate || !Number.isFinite(rate)) {
      continue;
    }
    if (bestDate == null || date > bestDate) {
      bestDate = date;
      bestRate = rate;
    }
  }
  return bestDate == null ? null : bestRate;
}

export function buildIssuedInvoiceMonthTotals(
  invoices: CustomerInvoiceSummary[],
  ratesByCurrency: IssuedInvoiceFxSeries,
  targetCurrencyCode: string,
  now: Date = new Date(),
): IssuedInvoiceMonthReport {
  const target = targetCurrencyCode.trim().toUpperCase();
  const months = recentIssuedInvoiceMonths(now);
  const buckets = new Map<string, MonthBucket>(
    months.map((month) => [toMonthKey(month), { total: 0, included: 0, excluded: 0 }]),
  );
  const keys = new Set(buckets.keys());
  const skipped = new Set<string>();

  for (const invoice of invoices) {
    const placed = invoiceCountsInWindow(invoice, keys);
    if (!placed) {
      continue;
    }
    const amount = parseMoneyAmountString(invoice.total ?? null);
    if (amount == null) {
      continue;
    }
    const bucket = buckets.get(placed.key);
    if (!bucket) {
      continue;
    }
    const currency = invoice.currency?.trim().toUpperCase() || target;
    if (currency === target) {
      bucket.total += amount;
      bucket.included += 1;
      continue;
    }
    const rate = rateOnOrBefore(ratesByCurrency.get(currency), placed.date);
    if (rate == null) {
      skipped.add(currency);
      bucket.excluded += 1;
      continue;
    }
    bucket.total += amount * rate;
    bucket.included += 1;
  }

  return {
    months: months.map((month, index) => {
      const monthKey = toMonthKey(month);
      const bucket = buckets.get(monthKey) ?? { total: 0, included: 0, excluded: 0 };
      return {
        monthKey,
        label: toMonthLabel(month, index === 0),
        total: bucket.total,
        excludedOnly: bucket.included === 0 && bucket.excluded > 0,
      };
    }),
    skippedForeignCurrencies: Array.from(skipped).sort(),
  };
}
