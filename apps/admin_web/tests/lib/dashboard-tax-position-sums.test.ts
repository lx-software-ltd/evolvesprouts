import { describe, expect, it } from 'vitest';

import { sumTaxFiscalYearKindWithFxCoverage } from '@/lib/dashboard-tax-position-sums';
import type { TaxFiscalYearRow } from '@/lib/tax-fiscal-year-report';

function row(
  partial: Pick<TaxFiscalYearRow, 'kind' | 'amount' | 'currency' | 'referenceId'>,
): TaxFiscalYearRow {
  return {
    classificationDate: '2025-06-01',
    description: 'x',
    tax: '0',
    status: '',
    needsInvoiceDateWarning: false,
    invoiceNumber: null,
    ...partial,
  };
}

describe('sumTaxFiscalYearKindWithFxCoverage', () => {
  it('sums target-currency rows for the requested kind', () => {
    const rows: TaxFiscalYearRow[] = [
      row({ kind: 'revenue', amount: '100', currency: 'HKD', referenceId: 'r1' }),
      row({ kind: 'revenue', amount: '50.5', currency: 'HKD', referenceId: 'r2' }),
      row({ kind: 'expense', amount: '999', currency: 'HKD', referenceId: 'e1' }),
    ];
    const empty = new Map<string, number>();
    expect(sumTaxFiscalYearKindWithFxCoverage(rows, 'revenue', empty, 'HKD').total).toBeCloseTo(150.5);
    expect(sumTaxFiscalYearKindWithFxCoverage(rows, 'expense', empty, 'HKD').total).toBeCloseTo(999);
  });

  it('converts foreign currency using multipliers into the target', () => {
    const rows: TaxFiscalYearRow[] = [
      row({ kind: 'revenue', amount: '10', currency: 'USD', referenceId: 'r1' }),
    ];
    const mult = new Map([['USD', 7.8]]);
    const { total, skippedForeignCurrencies } = sumTaxFiscalYearKindWithFxCoverage(
      rows,
      'revenue',
      mult,
      'HKD',
    );
    expect(total).toBeCloseTo(78);
    expect(skippedForeignCurrencies).toEqual([]);
  });

  it('records skipped currencies when a multiplier is missing instead of folding amounts in', () => {
    const rows: TaxFiscalYearRow[] = [
      row({ kind: 'expense', amount: '100', currency: 'USD', referenceId: 'e1' }),
      row({ kind: 'expense', amount: '10', currency: 'HKD', referenceId: 'e2' }),
    ];
    const partial = new Map([['EUR', 9]]);
    const { total, skippedForeignCurrencies } = sumTaxFiscalYearKindWithFxCoverage(
      rows,
      'expense',
      partial,
      'HKD',
    );
    expect(total).toBeCloseTo(10);
    expect(skippedForeignCurrencies).toEqual(['USD']);
  });
});
