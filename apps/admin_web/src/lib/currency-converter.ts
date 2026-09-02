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

export function clearCurrencyConversionRateCacheForTests(): void {
  conversionRateCache.clear();
}
