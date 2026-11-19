'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';

import { DashboardCard } from '@/components/admin/dashboard/dashboard-card';
import { useIssuedInvoiceMonthFxRates } from '@/hooks/use-issued-invoice-month-fx-rates';
import type { CustomerInvoiceSummary } from '@/lib/billing-api';
import { getAdminDefaultCurrencyCode } from '@/lib/config';
import {
  buildIssuedInvoiceMonthTotals,
  collectIssuedInvoiceMonthForeignCurrencies,
  issuedInvoiceRateWindow,
} from '@/lib/dashboard-issued-invoice-months';
import { nextHongKongMonthBoundary, todayHongKongDateString } from '@/lib/fiscal-year';
import { formatAmountInDefaultCurrency } from '@/lib/vendor-spend';

function useHongKongMonthNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => {
      setNow((current) => {
        const next = new Date();
        const currentKey = todayHongKongDateString(current).slice(0, 7);
        const nextKey = todayHongKongDateString(next).slice(0, 7);
        return currentKey === nextKey ? current : next;
      });
    };
    let timer = 0;
    const arm = () => {
      const delay = Math.max(1_000, nextHongKongMonthBoundary(new Date()).getTime() - Date.now());
      timer = window.setTimeout(() => {
        refresh();
        arm();
      }, delay);
    };
    arm();
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return now;
}

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
  const now = useHongKongMonthNow();
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

  const { ratesByCurrency, failedCurrencies = [] } = useIssuedInvoiceMonthFxRates(
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

  const notices: string[] = [];
  if (report) {
    const failed = [...failedCurrencies].sort();
    const missing = report.skippedForeignCurrencies.filter((code) => !failed.includes(code));
    if (failed.length > 0) {
      notices.push(
        `Could not load exchange rates for ${failed.join(', ')}. Those amounts are excluded from the totals.`,
      );
    }
    if (missing.length > 0) {
      notices.push(
        `No published rate for ${missing.join(', ')} on some issue dates. Those amounts are excluded from the totals.`,
      );
    }
    if (report.assumedDefaultCurrencyCount > 0) {
      const count = report.assumedDefaultCurrencyCount;
      notices.push(
        count === 1
          ? `1 invoice has no currency and was counted as ${defaultCurrency}.`
          : `${count} invoices have no currency and were counted as ${defaultCurrency}.`,
      );
    }
    if (report.priorRateCurrencies.length > 0) {
      const codes = report.priorRateCurrencies.join(', ');
      notices.push(
        report.priorRateCurrencies.length === 1
          ? `Rate for ${codes} is from the previous published date, not the issue date.`
          : `Rates for ${codes} are from the previous published date, not the issue date.`,
      );
    }
  }

  return (
    <DashboardCard width='half' title='Invoiced (last 6 months)'>
      <div className='space-y-4'>
        {isLoading || !issuedInvoices || !sumsReady ? (
          <div className='h-36 animate-pulse rounded-md bg-slate-100' aria-hidden />
        ) : loadError ? (
          <p className='text-sm text-red-600'>{loadError}</p>
        ) : report ? (
          <>
            {notices.map((notice) => (
              <p key={notice} className='text-sm font-medium text-amber-800' role='status'>
                {notice}
              </p>
            ))}
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
