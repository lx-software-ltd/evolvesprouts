'use client';

import { Fragment, useMemo, useState } from 'react';

import { DashboardCard } from '@/components/admin/dashboard/dashboard-card';
import { useFxMultipliersForCurrencies } from '@/hooks/use-fx-multipliers-for-currencies';
import type { CustomerInvoiceSummary } from '@/lib/billing-api';
import { getAdminDefaultCurrencyCode } from '@/lib/config';
import {
  buildIssuedInvoiceMonthTotals,
  collectIssuedInvoiceMonthForeignCurrencies,
} from '@/lib/dashboard-issued-invoice-months';
import { formatAmountInDefaultCurrency } from '@/lib/vendor-spend';

export interface IssuedInvoiceMonthsCardProps {
  issuedInvoices: CustomerInvoiceSummary[] | null;
  loadError: string;
  isLoading: boolean;
}

export function IssuedInvoiceMonthsCard({
  issuedInvoices,
  loadError,
  isLoading,
}: IssuedInvoiceMonthsCardProps) {
  const [now] = useState(() => new Date());
  const defaultCurrency = useMemo(() => getAdminDefaultCurrencyCode(), []);

  const foreignFxCodes = useMemo(() => {
    if (!issuedInvoices) {
      return [];
    }
    return collectIssuedInvoiceMonthForeignCurrencies(issuedInvoices, defaultCurrency, now);
  }, [defaultCurrency, issuedInvoices, now]);

  const fxEnabled =
    foreignFxCodes.length > 0 && Boolean(issuedInvoices && !isLoading && !loadError);

  const { fxMultipliers, fxError } = useFxMultipliersForCurrencies(foreignFxCodes, fxEnabled);

  const multipliersForSum = useMemo(
    () => fxMultipliers ?? new Map<string, number>(),
    [fxMultipliers],
  );
  const sumsReady = !fxEnabled || fxMultipliers !== null;

  const report = useMemo(() => {
    if (!issuedInvoices || !sumsReady) {
      return null;
    }
    return buildIssuedInvoiceMonthTotals(
      issuedInvoices,
      multipliersForSum,
      defaultCurrency,
      now,
    );
  }, [defaultCurrency, issuedInvoices, multipliersForSum, now, sumsReady]);

  const fxGapMessage =
    report && report.skippedForeignCurrencies.length > 0
      ? `FX unavailable for ${report.skippedForeignCurrencies.join(', ')}. Amounts in those currencies are excluded from totals.`
      : '';

  const blockingError = [loadError, fxEnabled ? fxError : ''].filter(Boolean).join(' • ');

  return (
    <DashboardCard width='half' title='Invoiced (last 6 months)'>
      <div className='space-y-4'>
        {isLoading || !issuedInvoices || !sumsReady ? (
          <div className='h-36 animate-pulse rounded-md bg-slate-100' aria-hidden />
        ) : blockingError ? (
          <p className='text-sm text-red-600'>{blockingError}</p>
        ) : report ? (
          <>
            {fxGapMessage ? (
              <p className='text-sm font-medium text-amber-800' role='status'>
                {fxGapMessage}
              </p>
            ) : null}
            <dl className='grid grid-cols-[minmax(0,auto)_1fr] gap-x-4 gap-y-2 text-sm'>
              {report.months.map((month) => (
                <Fragment key={month.monthKey}>
                  <dt className='text-slate-600'>{month.label}</dt>
                  <dd className='text-right font-medium tabular-nums text-slate-900'>
                    {formatAmountInDefaultCurrency(month.total)}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </>
        ) : null}
      </div>
    </DashboardCard>
  );
}
