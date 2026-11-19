import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCurrencyConversionRateCacheForTests,
  getCurrencyConversionMultiplier,
  getCurrencyConversionRatesByDate,
} from '@/lib/currency-converter';

describe('getCurrencyConversionMultiplier', () => {
  beforeEach(() => {
    clearCurrencyConversionRateCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCurrencyConversionRateCacheForTests();
  });

  it('returns 1 when from and to match', async () => {
    expect(await getCurrencyConversionMultiplier('HKD', 'HKD')).toBe(1);
  });

  it('fetches rate from Frankfurter API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ date: '2026-01-01', base: 'EUR', quote: 'HKD', rate: 9.5 }],
      })
    );

    expect(await getCurrencyConversionMultiplier('EUR', 'HKD')).toBe(9.5);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/v2/rates?base=EUR&quotes=HKD'));
  });
});

describe('getCurrencyConversionRatesByDate', () => {
  beforeEach(() => {
    clearCurrencyConversionRateCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCurrencyConversionRateCacheForTests();
  });

  it('loads the published rate for each date in the range and caches the success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { date: '2026-06-15', base: 'USD', quote: 'HKD', rate: 7.5 },
        { date: '2026-06-16', base: 'USD', quote: 'EUR', rate: 0.9 },
        { date: 'not-a-date', base: 'USD', quote: 'HKD', rate: 1 },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await getCurrencyConversionRatesByDate('usd', 'HKD', '2026-06-01', '2026-06-30');
    const second = await getCurrencyConversionRatesByDate('USD', 'HKD', '2026-06-01', '2026-06-30');

    expect(first.get('2026-06-15')).toBe(7.5);
    expect(first.has('2026-06-16')).toBe(false);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v2/rates?base=USD&quotes=HKD&from=2026-06-01&to=2026-06-30'),
    );
  });

  it('does not cache a failed request', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ date: '2026-06-15', base: 'USD', quote: 'HKD', rate: 7.8 }],
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getCurrencyConversionRatesByDate('USD', 'HKD', '2026-06-01', '2026-06-30'),
    ).rejects.toThrow('down');
    const rates = await getCurrencyConversionRatesByDate('USD', 'HKD', '2026-06-01', '2026-06-30');

    expect(rates.get('2026-06-15')).toBe(7.8);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
