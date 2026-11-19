'use client';

import { Fragment, useMemo, useState } from 'react';

import { DashboardCard } from '@/components/admin/dashboard/dashboard-card';
import { useIssuedInvoiceMonthFxRates } from '@/hooks/use-issued-invoice-month-fx-rates';
import type { CustomerInvoiceSummary } from '@/lib/billing-api';
import { getAdminDefaultCurrencyCode } from '@/lib/config';
import {
  buildIssuedInvoiceMonthTotals,
  collectIssuedInvoiceMonthForeignCurrencies,
  issuedInvoiceRateWindow,
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
  const rateWindow = useMemo(() => issuedInvoiceRateWindow(now), [now]);

  const foreignFxCodes = useMemo(() => {
    if (!issuedInvoices) {
      return [];
    }
    return collectIssuedInvoiceMonthForeignCurrencies(issuedInvoices, defaultCurrency, now);
  }, [defaultCurrency, issuedInvoices, now]);

  const fxEnabled =
    foreignFxCodes.length > 0 && Boolean(issuedInvoices && !isLoading && !loadError);

  const { ratesByCurrency } = useIssuedInvoiceMonthFxRates(
    foreignFxCodes,
    rateWindow.startDate,
    rateWindow.endDate,
    defaultCurrency,
    fxEnabled,
  );

  const ratesForSum = useMemo(() => ratesByCurrency ?? new Map(), [ratesByCurrency]);
  const sumsReady = !fxEnabled || ratesByCurrency !== null;

  const report = useMemo(() => {
    if (!issuedInvoices || !sumsReady) {
      return null;
    }
    return buildIssuedInvoiceMonthTotals(issuedInvoices, ratesForSum, defaultCurrency, now);
  }, [defaultCurrency, issuedInvoices, now, ratesForSum, sumsReady]);

  const fxGapMessage =
    report && report.skippedForeignCurrencies.length > 0
      ? `No published rate for ${report.skippedForeignCurrencies.join(', ')} on some issue dates. Those amounts are excluded from the totals.`
      : '';

  return (
    <DashboardCard width='half' title='Invoiced (last 6 months)'>
      <div className='space-y-4'>
        {isLoading || !issuedInvoices || !sumsReady ? (
          <div className='h-36 animate-pulse rounded-md bg-slate-100' aria-hidden />
        ) : loadError ? (
          <p className='text-sm text-red-600'>{loadError}</p>
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
                    {month.excludedOnly ? (
                      <>
                        <span aria-hidden>—</span>
                        <span className='sr-only'>Exchange rate unavailable</span>
                      </>
                    ) : (
                      formatAmountInDefaultCurrency(month.total)
                    )}
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
