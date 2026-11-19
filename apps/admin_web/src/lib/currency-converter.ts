/**
 * Frankfurter-based FX helpers for the admin portal.
 * Use {@link getCurrencyConversionMultiplier} to convert amounts between ISO 4217 codes.
 */

const DEFAULT_FRANKFURTER_API_ORIGIN = 'https://api.frankfurter.dev';

function getFrankfurterApiOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_FRANKFURTER_API_ORIGIN?.trim();
  if (fromEnv) {
    try {
      const url = new URL(fromEnv);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        return url.origin;
      }
    } catch {
      // fall through
    }
  }
  return DEFAULT_FRANKFURTER_API_ORIGIN;
}

type FrankfurterRateRow = {
  date?: string;
  base?: string;
  quote?: string;
  rate: number;
};

function isFrankfurterRateRow(value: unknown): value is FrankfurterRateRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FrankfurterRateRow).rate === 'number' &&
    Number.isFinite((value as FrankfurterRateRow).rate)
  );
}

const conversionRateCache = new Map<string, Promise<number>>();
const conversionSeriesCache = new Map<string, Map<string, number>>();
const conversionSeriesInflight = new Map<string, Promise<Map<string, number>>>();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the multiplier so that `amountInFrom * multiplier` equals the value in `toCurrency`
 * (Frankfurter daily rate: base = from, quote = to).
 */
export function getCurrencyConversionMultiplier(fromCurrency: string, toCurrency: string): Promise<number> {
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (!from || !to || from === to) {
    return Promise.resolve(1);
  }

  const cacheKey = `${from}->${to}`;
  const cached = conversionRateCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = (async () => {
    const origin = getFrankfurterApiOrigin();
    const url = `${origin}/v2/rates?base=${encodeURIComponent(from)}&quotes=${encodeURIComponent(to)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Frankfurter request failed (${response.status}).`);
    }
    const data: unknown = await response.json();
    if (!Array.isArray(data) || data.length === 0 || !isFrankfurterRateRow(data[0])) {
      throw new Error('Unexpected Frankfurter response shape.');
    }
    return data[0].rate;
  })();

  conversionRateCache.set(cacheKey, request);
  return request;
}

function frankfurterRateSeries(data: unknown, from: string, to: string): Map<string, number> {
  if (!Array.isArray(data)) {
    throw new Error('Unexpected Frankfurter response shape.');
  }
  const rates = new Map<string, number>();
  for (const row of data) {
    if (!isFrankfurterRateRow(row)) {
      continue;
    }
    const date = typeof row.date === 'string' ? row.date : '';
    const base = row.base?.trim().toUpperCase();
    const quote = row.quote?.trim().toUpperCase();
    if (!ISO_DATE.test(date) || base !== from || quote !== to) {
      continue;
    }
    rates.set(date, row.rate);
  }
  return rates;
}

/**
 * Daily multipliers for `fromCurrency` into `toCurrency` from `fromDate` through `toDate`
 * (inclusive). `amount * rate` is the value in `toCurrency` on that published date.
 * A failed request is not cached.
 */
export async function getCurrencyConversionRatesByDate(
  fromCurrency: string,
  toCurrency: string,
  fromDate: string,
  toDate: string,
): Promise<Map<string, number>> {
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (!from || !to) {
    throw new Error('Currency codes are required.');
  }
  if (!ISO_DATE.test(fromDate) || !ISO_DATE.test(toDate) || fromDate > toDate) {
    throw new Error('FX rate range is invalid.');
  }
  if (from === to) {
    return new Map();
  }

  const cacheKey = `${from}->${to}@${fromDate}..${toDate}`;
  const cached = conversionSeriesCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const pending = conversionSeriesInflight.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    const origin = getFrankfurterApiOrigin();
    const url =
      `${origin}/v2/rates?base=${encodeURIComponent(from)}` +
      `&quotes=${encodeURIComponent(to)}` +
      `&from=${encodeURIComponent(fromDate)}` +
      `&to=${encodeURIComponent(toDate)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Frankfurter request failed (${response.status}).`);
    }
    const rates = frankfurterRateSeries(await response.json(), from, to);
    conversionSeriesCache.set(cacheKey, rates);
    return rates;
  })().finally(() => {
    conversionSeriesInflight.delete(cacheKey);
  });

  conversionSeriesInflight.set(cacheKey, request);
  return request;
}

export function clearCurrencyConversionRateCacheForTests(): void {
  conversionRateCache.clear();
  conversionSeriesCache.clear();
  conversionSeriesInflight.clear();
}
