import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetRates = vi.fn();

vi.mock('@/lib/currency-converter', () => ({
  getCurrencyConversionRatesByDate: (...args: unknown[]) => mockGetRates(...args),
}));

import { useIssuedInvoiceMonthFxRates } from '@/hooks/use-issued-invoice-month-fx-rates';

describe('useIssuedInvoiceMonthFxRates', () => {
  beforeEach(() => {
    mockGetRates.mockReset();
  });

  it('does not request rates when disabled', () => {
    renderHook(() => useIssuedInvoiceMonthFxRates(['USD'], '2026-05-25', '2026-11-19', 'HKD', false));
    expect(mockGetRates).not.toHaveBeenCalled();
  });

  it('keeps a currency whose series loaded when another request fails', async () => {
    mockGetRates.mockImplementation((code: string) => {
      if (code === 'EUR') {
        return Promise.reject(new Error('down'));
      }
      return Promise.resolve(new Map([['2026-09-01', 7.8]]));
    });

    const { result } = renderHook(() =>
      useIssuedInvoiceMonthFxRates(['EUR', 'USD'], '2026-05-25', '2026-11-19', 'HKD', true),
    );

    await waitFor(() => {
      expect(result.current.ratesByCurrency).not.toBeNull();
    });

    expect(result.current.ratesByCurrency?.get('USD')?.get('2026-09-01')).toBe(7.8);
    expect(result.current.ratesByCurrency?.has('EUR')).toBe(false);
    expect(mockGetRates).toHaveBeenCalledWith('USD', 'HKD', '2026-05-25', '2026-11-19');
    expect(mockGetRates).toHaveBeenCalledWith('EUR', 'HKD', '2026-05-25', '2026-11-19');
  });
});
