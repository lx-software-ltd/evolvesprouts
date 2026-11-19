import { describe, expect, it } from 'vitest';

import type { CustomerInvoiceSummary } from '@/lib/billing-api';
import {
  ISSUED_INVOICE_MONTH_COUNT,
  buildIssuedInvoiceMonthTotals,
  collectIssuedInvoiceMonthForeignCurrencies,
  issuedInvoiceRateWindow,
  type IssuedInvoiceFxSeries,
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

function monthTotal(report: ReturnType<typeof buildIssuedInvoiceMonthTotals>, key: string) {
  return report.months.find((month) => month.monthKey === key);
}

describe('buildIssuedInvoiceMonthTotals', () => {
  it('returns the current Hong Kong month and the five months before it, newest first', () => {
    const report = buildIssuedInvoiceMonthTotals([], new Map(), 'HKD', NOW);

    expect(report.months).toHaveLength(ISSUED_INVOICE_MONTH_COUNT);
    expect(report.months.map((month) => month.label)).toEqual([
      'Nov 2026 (so far)',
      'Oct 2026',
      'Sep 2026',
      'Aug 2026',
      'Jul 2026',
      'Jun 2026',
    ]);
    expect(report.months.every((month) => month.total === 0 && !month.excludedOnly)).toBe(true);
    expect(report.skippedForeignCurrencies).toEqual([]);
    expect(issuedInvoiceRateWindow(NOW)).toEqual({
      startDate: '2026-05-25',
      endDate: '2026-11-19',
    });
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
    expect(report.months[0]?.label).toBe('Feb 2026 (so far)');
  });

  it('sums issued totals by the Hong Kong issue date and ignores other months and statuses', () => {
    const report = buildIssuedInvoiceMonthTotals(
      [
        invoice({
          id: 'nov-a',
          total: '1000.50',
          invoiceDate: '2026-04-01',
          issuedAt: '2026-11-02T01:00:00.000Z',
        }),
        invoice({ id: 'nov-b', total: '20', issuedAt: '2026-11-18T01:00:00.000Z' }),
        invoice({
          id: 'jun',
          total: '200',
          invoiceDate: '2026-01-01',
          issuedAt: '2026-06-15T02:00:00.000Z',
        }),
        invoice({ id: 'may', total: '9999', issuedAt: '2026-05-31T02:00:00.000Z' }),
        invoice({ id: 'draft', status: 'draft', total: '400', issuedAt: '2026-11-03T01:00:00.000Z' }),
        invoice({ id: 'void', status: 'void', total: '400', issuedAt: '2026-10-03T01:00:00.000Z' }),
        invoice({ id: 'bad-total', total: 'not-money', issuedAt: '2026-10-04T01:00:00.000Z' }),
        invoice({ id: 'no-date', invoiceDate: null, issuedAt: null, total: '50' }),
      ],
      new Map(),
      'HKD',
      NOW,
    );

    expect(monthTotal(report, '2026-11')?.total).toBeCloseTo(1020.5);
    expect(monthTotal(report, '2026-06')?.total).toBeCloseTo(200);
    expect(monthTotal(report, '2026-10')?.total).toBe(0);
    expect(report.months.some((month) => month.monthKey === '2026-05')).toBe(false);
  });

  it('uses the Hong Kong date of issuedAt when it falls on the next calendar day', () => {
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

    expect(monthTotal(report, '2026-11')?.total).toBeCloseTo(15);
  });

  it('prefers issuedAt over invoiceDate and falls back to invoiceDate when issuedAt is missing', () => {
    const report = buildIssuedInvoiceMonthTotals(
      [
        invoice({
          id: 'backdated',
          invoiceDate: '2026-08-01',
          issuedAt: '2026-11-02T01:00:00.000Z',
          total: '30',
        }),
        invoice({
          id: 'fallback',
          invoiceDate: '2026-06-15',
          issuedAt: null,
          total: '40',
        }),
      ],
      new Map(),
      'HKD',
      NOW,
    );

    expect(monthTotal(report, '2026-11')?.total).toBeCloseTo(30);
    expect(monthTotal(report, '2026-08')?.total).toBe(0);
    expect(monthTotal(report, '2026-06')?.total).toBeCloseTo(40);
  });

  it('converts each issue date at that date’s published rate and marks months that were fully excluded', () => {
    const rates: IssuedInvoiceFxSeries = new Map([
      [
        'USD',
        new Map([
          ['2026-06-12', 7.5],
          ['2026-09-01', 7.8],
        ]),
      ],
    ]);
    const report = buildIssuedInvoiceMonthTotals(
      [
        invoice({
          id: 'june-usd',
          total: '10',
          currency: 'USD',
          issuedAt: '2026-06-14T02:00:00.000Z',
        }),
        invoice({
          id: 'sep-usd',
          total: '10',
          currency: 'usd',
          issuedAt: '2026-09-02T02:00:00.000Z',
        }),
        invoice({
          id: 'sep-hkd',
          total: '22',
          currency: 'HKD',
          issuedAt: '2026-09-03T02:00:00.000Z',
        }),
        invoice({
          id: 'sep-eur',
          total: '5',
          currency: 'EUR',
          issuedAt: '2026-09-03T03:00:00.000Z',
        }),
        invoice({
          id: 'aug-stale',
          total: '10',
          currency: 'USD',
          issuedAt: '2026-08-01T02:00:00.000Z',
        }),
      ],
      rates,
      'HKD',
      NOW,
    );

    expect(monthTotal(report, '2026-06')?.total).toBeCloseTo(75);
    expect(monthTotal(report, '2026-09')?.total).toBeCloseTo(100);
    expect(monthTotal(report, '2026-09')?.excludedOnly).toBe(false);
    expect(monthTotal(report, '2026-08')?.total).toBe(0);
    expect(monthTotal(report, '2026-08')?.excludedOnly).toBe(true);
    expect(report.skippedForeignCurrencies).toEqual(['EUR', 'USD']);
    expect(
      collectIssuedInvoiceMonthForeignCurrencies(
        [
          invoice({
            id: 'usd',
            total: '10',
            currency: 'usd',
            issuedAt: '2026-09-02T02:00:00.000Z',
          }),
          invoice({
            id: 'eur',
            total: '5',
            currency: 'EUR',
            issuedAt: '2026-09-03T02:00:00.000Z',
          }),
          invoice({
            id: 'old',
            total: '5',
            currency: 'GBP',
            issuedAt: '2026-01-03T02:00:00.000Z',
          }),
        ],
        'HKD',
        NOW,
      ),
    ).toEqual(['EUR', 'USD']);
  });
});
