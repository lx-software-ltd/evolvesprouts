'use client';

import { useId, useMemo, useState } from 'react';

import { DashboardCard } from '@/components/admin/dashboard/dashboard-card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFxMultipliersForCurrencies } from '@/hooks/use-fx-multipliers-for-currencies';
import {
  ADMIN_TAX_FISCAL_YEAR_EMPTY_MESSAGE,
  MIN_ADMIN_TAX_FISCAL_YEAR_START,
  enumerateAdminTaxFiscalYearStartYears,
} from '@/lib/admin-tax-fiscal-year';
import { getAdminDefaultCurrencyCode } from '@/lib/config';
import type { CustomerInvoiceSummary } from '@/lib/billing-api';
import { sumTaxFiscalYearKindWithFxCoverage } from '@/lib/dashboard-tax-position-sums';
import { getFiscalYearRangeInclusive } from '@/lib/fiscal-year';
import {
  DEFAULT_TAX_FISCAL_YEAR_STATUS_FILTER,
  buildTaxFiscalYearRows,
  defaultFiscalYearStartYear,
} from '@/lib/tax-fiscal-year-report';
import { formatAmountInDefaultCurrency } from '@/lib/vendor-spend';
import type { Expense } from '@/types/expenses';

export interface TaxPositionCardProps {
  expenses: Expense[] | null;
  issuedInvoices: CustomerInvoiceSummary[] | null;
  loadError: string;
  isLoading: boolean;
}

export function TaxPositionCard({
  expenses: expensesPayload,
  issuedInvoices: issuedInvoicesPayload,
  loadError,
  isLoading,
}: TaxPositionCardProps) {
  const selectId = useId();
  const defaultCurrency = useMemo(() => getAdminDefaultCurrencyCode(), []);
  const [fyStartYear, setFyStartYear] = useState(
    () => Math.max(MIN_ADMIN_TAX_FISCAL_YEAR_START, defaultFiscalYearStartYear()),
  );

  const fyYearOptions = useMemo(() => enumerateAdminTaxFiscalYearStartYears(), []);

  const rows = useMemo(() => {
    if (!expensesPayload || !issuedInvoicesPayload) {
      return [];
    }
    return buildTaxFiscalYearRows(
      expensesPayload,
      issuedInvoicesPayload,
      fyStartYear,
      DEFAULT_TAX_FISCAL_YEAR_STATUS_FILTER,
    );
  }, [expensesPayload, issuedInvoicesPayload, fyStartYear]);

  const foreignFxCodes = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      const c = row.currency?.trim().toUpperCase() || defaultCurrency;
      if (c !== defaultCurrency) {
        set.add(c);
      }
    }
    return Array.from(set);
  }, [rows, defaultCurrency]);

  const taxFxEnabled =
    foreignFxCodes.length > 0 && Boolean(expensesPayload && issuedInvoicesPayload && !isLoading);

  const { fxMultipliers, fxError } = useFxMultipliersForCurrencies(foreignFxCodes, taxFxEnabled);

  const multipliersForSum = useMemo(
    () => fxMultipliers ?? new Map<string, number>(),
    [fxMultipliers],
  );
  const sumsReady = !taxFxEnabled || fxMultipliers !== null;

  const revenueResult = useMemo(
    () => sumTaxFiscalYearKindWithFxCoverage(rows, 'revenue', multipliersForSum, defaultCurrency),
    [rows, multipliersForSum, defaultCurrency],
  );
  const expenseResult = useMemo(
    () => sumTaxFiscalYearKindWithFxCoverage(rows, 'expense', multipliersForSum, defaultCurrency),
    [rows, multipliersForSum, defaultCurrency],
  );

  const revenueTotal = revenueResult.total;
  const expenseTotal = expenseResult.total;
  const netTotal = revenueTotal - expenseTotal;

  const skippedFxCodes = useMemo(() => {
    const merged = new Set<string>([
      ...revenueResult.skippedForeignCurrencies,
      ...expenseResult.skippedForeignCurrencies,
    ]);
    return Array.from(merged).sort();
  }, [revenueResult.skippedForeignCurrencies, expenseResult.skippedForeignCurrencies]);

  const fxGapMessage =
    skippedFxCodes.length > 0
      ? `FX unavailable for ${skippedFxCodes.join(', ')}. Amounts in those currencies are excluded from totals.`
      : '';

  const blockingError = [loadError, taxFxEnabled ? fxError : ''].filter(Boolean).join(' • ');

  const disableControls = isLoading || Boolean(loadError) || Boolean(taxFxEnabled && fxError);

  return (
    <DashboardCard width='half' title='Tax Position'>
      <div className='space-y-4'>
        <div className='min-w-0'>
          <Label htmlFor={selectId}>Fiscal year</Label>
          <Select
            id={selectId}
            value={String(fyStartYear)}
            disabled={disableControls}
            onChange={(event) => {
              setFyStartYear(Number.parseInt(event.target.value, 10));
            }}
          >
            {fyYearOptions.map((y) => {
              const range = getFiscalYearRangeInclusive(y);
              const label = `${range.start.slice(0, 4)} - ${range.end.slice(0, 4)}`;
              return (
                <option key={y} value={y}>
                  {label}
                </option>
              );
            })}
          </Select>
        </div>

        {isLoading || !sumsReady ? (
          <div className='h-14 animate-pulse rounded-md bg-slate-100' aria-hidden />
        ) : blockingError ? (
          <p className='text-sm text-red-600'>{blockingError}</p>
        ) : rows.length === 0 ? (
          <p className='text-sm text-slate-600'>{ADMIN_TAX_FISCAL_YEAR_EMPTY_MESSAGE}</p>
        ) : (
          <>
            {fxGapMessage ? (
              <p className='text-sm font-medium text-amber-800' role='status'>
                {fxGapMessage}
              </p>
            ) : null}
            <dl className='grid grid-cols-[minmax(0,auto)_1fr] gap-x-4 gap-y-2 text-sm'>
              <dt className='text-slate-600'>Revenue</dt>
              <dd className='text-right font-medium tabular-nums text-slate-900'>
                {formatAmountInDefaultCurrency(revenueTotal)}
              </dd>
              <dt className='text-slate-600'>Expense</dt>
              <dd className='text-right font-medium tabular-nums text-slate-900'>
                {formatAmountInDefaultCurrency(expenseTotal)}
              </dd>
              <dt className='text-slate-600'>Net</dt>
              <dd
                className={
                  netTotal >= 0
                    ? 'text-right font-semibold tabular-nums text-emerald-700'
                    : 'text-right font-semibold tabular-nums text-red-600'
                }
              >
                <span className='sr-only'>{netTotal >= 0 ? 'Surplus' : 'Loss'}</span>
                <span aria-hidden className='mr-0.5'>
                  {netTotal >= 0 ? '+' : '−'}
                </span>
                {formatAmountInDefaultCurrency(Math.abs(netTotal))}
                {netTotal < 0 ? (
                  <span className='font-medium text-slate-800'> (loss)</span>
                ) : null}
              </dd>
            </dl>
          </>
        )}
      </div>
    </DashboardCard>
  );
}
