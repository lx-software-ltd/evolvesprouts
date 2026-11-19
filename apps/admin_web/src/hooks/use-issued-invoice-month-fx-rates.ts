'use client';

import { useEffect, useMemo, useState } from 'react';

import { getCurrencyConversionRatesByDate } from '@/lib/currency-converter';
import type { IssuedInvoiceFxSeries } from '@/lib/dashboard-issued-invoice-months';

export interface UseIssuedInvoiceMonthFxRatesResult {
  /**
   * Series by currency, or `null` while a request is in flight.
   * Disabled calls stay `null`. An enabled call with no currencies is an empty map.
   * A currency whose request fails is omitted; the other currencies remain.
   */
  ratesByCurrency: IssuedInvoiceFxSeries | null;
  /** Currencies whose whole request failed (network or non-OK). Not the same as a missing published date. */
  failedCurrencies: string[];
}

/**
 * Loads a historical Frankfurter series for each currency into `targetCurrency`.
 * One failed currency does not discard rates that already loaded.
 */
export function useIssuedInvoiceMonthFxRates(
  currencyCodes: string[],
  startDate: string,
  endDate: string,
  targetCurrency: string,
  enabled: boolean,
): UseIssuedInvoiceMonthFxRatesResult {
  const [ratesByCurrency, setRatesByCurrency] = useState<IssuedInvoiceFxSeries | null>(null);
  const [failedCurrencies, setFailedCurrencies] = useState<string[]>([]);

  const codesKey = useMemo(() => {
    const unique = [...new Set(currencyCodes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
    unique.sort();
    return unique.join(',');
  }, [currencyCodes]);

  const target = targetCurrency.trim().toUpperCase();

  useEffect(() => {
    /* Sync reset paths must run in the effect body so cleanup cancellation applies
     * when the window or the currency list changes. */
    /* eslint-disable react-hooks/set-state-in-effect -- intentional synchronous reset */
    if (!enabled) {
      setRatesByCurrency(null);
      setFailedCurrencies([]);
      return;
    }
    if (codesKey.length === 0) {
      setRatesByCurrency(new Map());
      setFailedCurrencies([]);
      return;
    }
    setRatesByCurrency(null);
    setFailedCurrencies([]);
    /* eslint-enable react-hooks/set-state-in-effect */

    const codes = codesKey.split(',').filter(Boolean);
    let cancelled = false;
    void (async () => {
      const next: IssuedInvoiceFxSeries = new Map();
      const failed: string[] = [];
      await Promise.all(
        codes.map(async (code) => {
          try {
            next.set(code, await getCurrencyConversionRatesByDate(code, target, startDate, endDate));
          } catch {
            failed.push(code);
          }
        }),
      );
      if (!cancelled) {
        failed.sort();
        setFailedCurrencies(failed);
        setRatesByCurrency(next);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [codesKey, enabled, endDate, startDate, target]);

  return { ratesByCurrency, failedCurrencies };
}
