import { describe, expect, it } from 'vitest';

import type { CustomerInvoiceSummary } from '@/lib/billing-api';
import {
  ISSUED_INVOICE_MONTH_COUNT,
  buildIssuedInvoiceMonthTotals,
  collectIssuedInvoiceMonthForeignCurrencies,
} from '@/lib/dashboard-issued-invoice-months';

const NOW = new Date('2026-11-19T04:00:00.000Z');

function invoice(
  partial: Partial<CustomerInvoiceSummary> & Pick<CustomerInvoiceSummary, 'id'>,
): CustomerInvoiceSummary {
  return {
    status: 'issued',
    currency: 'HKD',
    total: '100',
    invoiceDate: '2026-11-02',
    issuedAt: '2026-11-02T01:00:00.000Z',
    ...partial,
  };
}

describe('buildIssuedInvoiceMonthTotals', () => {
  it('returns the current Hong Kong month and the five months before it, newest first', () => {
    const report = buildIssuedInvoiceMonthTotals([], new Map(), 'HKD', NOW);

    expect(report.months).toHaveLength(ISSUED_INVOICE_MONTH_COUNT);
    expect(report.months.map((month) => month.label)).toEqual([
      'Nov 2026',
      'Oct 2026',
      'Sep 2026',
      'Aug 2026',
      'Jul 2026',
      'Jun 2026',
    ]);
    expect(report.months.every((month) => month.total === 0)).toBe(true);
    expect(report.skippedForeignCurrencies).toEqual([]);
  });

  it('crosses the year boundary from the Hong Kong calendar', () => {
    const report = buildIssuedInvoiceMonthTotals(
      [],
      new Map(),
      'HKD',
      new Date('2026-02-10T02:00:00.000Z'),
    );

    expect(report.months.map((month) => month.monthKey)).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
      '2025-10',
      '2025-09',
    ]);
  });

  it('sums issued invoice totals into the invoice month and ignores other months and statuses', () => {
    const report = buildIssuedInvoiceMonthTotals(
      [
        invoice({ id: 'nov-a', total: '1000.50', invoiceDate: '2026-11-02' }),
        invoice({ id: 'nov-b', total: '20', invoiceDate: '2026-11-28' }),
        invoice({ id: 'jun', total: '200', invoiceDate: '2026-06-15' }),
        invoice({ id: 'may', total: '9999', invoiceDate: '2026-05-31' }),
        invoice({ id: 'draft', status: 'draft', total: '400', invoiceDate: '2026-11-03' }),
        invoice({ id: 'void', status: 'void', total: '400', invoiceDate: '2026-10-03' }),
        invoice({ id: 'bad-total', total: 'not-money', invoiceDate: '2026-10-04' }),
        invoice({ id: 'no-date', invoiceDate: null, issuedAt: null, total: '50' }),
      ],
      new Map(),
      'HKD',
      NOW,
    );

    expect(report.months.find((month) => month.monthKey === '2026-11')?.total).toBeCloseTo(1020.5);
    expect(report.months.find((month) => month.monthKey === '2026-06')?.total).toBeCloseTo(200);
    expect(report.months.find((month) => month.monthKey === '2026-10')?.total).toBe(0);
    expect(report.months.some((month) => month.monthKey === '2026-05')).toBe(false);
  });

  it('uses the Hong Kong date of issuedAt when invoiceDate is missing', () => {
    const report = buildIssuedInvoiceMonthTotals(
      [
        invoice({
          id: 'issued-boundary',
          invoiceDate: null,
          issuedAt: '2026-10-31T16:30:00.000Z',
          total: '15',
        }),
      ],
      new Map(),
      'HKD',
      NOW,
    );

    expect(report.months.find((month) => month.monthKey === '2026-11')?.total).toBeCloseTo(15);
  });

  it('prefers invoiceDate over issuedAt', () => {
    const report = buildIssuedInvoiceMonthTotals(
      [
        invoice({
          id: 'dated',
          invoiceDate: '2026-08-01',
          issuedAt: '2026-11-02T01:00:00.000Z',
          total: '30',
        }),
      ],
      new Map(),
      'HKD',
      NOW,
    );

    expect(report.months.find((month) => month.monthKey === '2026-08')?.total).toBeCloseTo(30);
    expect(report.months.find((month) => month.monthKey === '2026-11')?.total).toBe(0);
  });

  it('converts foreign totals and records currencies with no multiplier', () => {
    const report = buildIssuedInvoiceMonthTotals(
      [
        invoice({ id: 'hkd', total: '22', currency: 'HKD', invoiceDate: '2026-09-01' }),
        invoice({ id: 'usd', total: '10', currency: 'usd', invoiceDate: '2026-09-02' }),
        invoice({ id: 'eur', total: '5', currency: 'EUR', invoiceDate: '2026-09-03' }),
      ],
      new Map([['USD', 7.8]]),
      'HKD',
      NOW,
    );

    expect(report.months.find((month) => month.monthKey === '2026-09')?.total).toBeCloseTo(100);
    expect(report.skippedForeignCurrencies).toEqual(['EUR']);
    expect(
      collectIssuedInvoiceMonthForeignCurrencies(
        [
          invoice({ id: 'usd', total: '10', currency: 'usd', invoiceDate: '2026-09-02' }),
          invoice({ id: 'eur', total: '5', currency: 'EUR', invoiceDate: '2026-09-03' }),
          invoice({ id: 'old', total: '5', currency: 'GBP', invoiceDate: '2026-01-03' }),
        ],
        'HKD',
        NOW,
      ),
    ).toEqual(['EUR', 'USD']);
  });
});
