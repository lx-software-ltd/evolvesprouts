import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerInvoiceSummary } from '@/lib/billing-api';

vi.mock('@/lib/config', () => ({
  getAdminDefaultCurrencyCode: vi.fn(() => 'HKD'),
}));

const mockUseFx = vi.fn();
vi.mock('@/hooks/use-issued-invoice-month-fx-rates', () => ({
  useIssuedInvoiceMonthFxRates: (...args: unknown[]) => mockUseFx(...args),
}));

import { IssuedInvoiceMonthsCard } from '@/components/admin/dashboard/cards/issued-invoice-months-card';
import { nextHongKongMonthBoundary } from '@/lib/fiscal-year';

const NOW = new Date('2026-11-19T04:00:00.000Z');

function invoice(
  partial: Partial<CustomerInvoiceSummary> & Pick<CustomerInvoiceSummary, 'id'>,
): CustomerInvoiceSummary {
  return {
    status: 'issued',
    currency: 'HKD',
    total: '100',
    invoiceDate: '2026-11-02',
    issuedAt: '2026-11-02T01:00:00.000Z',
    ...partial,
  };
}

describe('IssuedInvoiceMonthsCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockUseFx.mockReturnValue({ ratesByCurrency: new Map(), failedCurrencies: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a skeleton while invoices are loading', () => {
    render(<IssuedInvoiceMonthsCard issuedInvoices={null} loadError='' isLoading />);
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Nov 2026 (so far)')).not.toBeInTheDocument();
  });

  it('shows the finance load error', () => {
    render(
      <IssuedInvoiceMonthsCard
        issuedInvoices={[]}
        loadError='Could not load dashboard finance data.'
        isLoading={false}
      />,
    );
    expect(screen.getByText('Could not load dashboard finance data.')).toBeInTheDocument();
  });

  it('lists six months and marks the current month as still open', () => {
    render(
      <IssuedInvoiceMonthsCard
        issuedInvoices={[
          invoice({
            id: 'nov',
            total: '1000',
            invoiceDate: '2026-01-15',
            issuedAt: '2026-11-02T01:00:00.000Z',
          }),
          invoice({
            id: 'jun',
            total: '200.5',
            invoiceDate: '2026-04-01',
            issuedAt: '2026-06-15T02:00:00.000Z',
          }),
        ]}
        loadError=''
        isLoading={false}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Invoiced (last 6 months)' })).toBeInTheDocument();
    const terms = screen.getAllByRole('term').map((term) => term.textContent);
    expect(terms).toEqual([
      'Nov 2026 (so far)',
      'Oct 2026',
      'Sep 2026',
      'Aug 2026',
      'Jul 2026',
      'Jun 2026',
    ]);
    expect(screen.getByText('HK$1,000.00')).toBeInTheDocument();
    expect(screen.getByText('HK$200.50')).toBeInTheDocument();
    expect(screen.getAllByText('HK$0.00')).toHaveLength(4);
  });

  it('keeps the skeleton until historical rates resolve', () => {
    mockUseFx.mockReturnValue({ ratesByCurrency: null, failedCurrencies: [] });
    render(
      <IssuedInvoiceMonthsCard
        issuedInvoices={[invoice({ id: 'usd', currency: 'USD', total: '10' })]}
        loadError=''
        isLoading={false}
      />,
    );
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
    expect(mockUseFx).toHaveBeenCalledWith(['USD'], '2026-05-25', '2026-11-19', 'HKD', true);
  });

  it('converts with the dated rate, keeps other months, and names a currency with no rate', () => {
    mockUseFx.mockReturnValue({
      ratesByCurrency: new Map([['USD', new Map([['2026-11-02', 7.8]])]]),
      failedCurrencies: [],
    });
    render(
      <IssuedInvoiceMonthsCard
        issuedInvoices={[
          invoice({ id: 'hkd', total: '22', currency: 'HKD' }),
          invoice({ id: 'usd', total: '10', currency: 'USD' }),
          invoice({ id: 'eur', total: '5', currency: 'EUR' }),
        ]}
        loadError=''
        isLoading={false}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'No published rate for EUR on some issue dates. Those amounts are excluded from the totals.',
    );
    expect(screen.getByText('HK$100.00')).toBeInTheDocument();
    expect(screen.getByText('Oct 2026')).toBeInTheDocument();
  });

  it('shows a dash instead of zero when a month’s invoices were all excluded', () => {
    mockUseFx.mockReturnValue({ ratesByCurrency: new Map(), failedCurrencies: [] });
    render(
      <IssuedInvoiceMonthsCard
        issuedInvoices={[invoice({ id: 'eur', currency: 'EUR', total: '10' })]}
        loadError=''
        isLoading={false}
      />,
    );

    expect(screen.getByText('Exchange rate unavailable')).toBeInTheDocument();
    expect(screen.getAllByText('HK$0.00')).toHaveLength(5);
    expect(screen.getByRole('status')).toHaveTextContent('No published rate for EUR');
    expect(screen.queryByText('Could not load FX rates for currency conversion.')).not.toBeInTheDocument();
  });

  it('names a failed rate request separately from a missing published rate', () => {
    mockUseFx.mockReturnValue({
      ratesByCurrency: new Map(),
      failedCurrencies: ['USD'],
    });
    render(
      <IssuedInvoiceMonthsCard
        issuedInvoices={[
          invoice({ id: 'usd', currency: 'USD', total: '10' }),
          invoice({ id: 'eur', currency: 'EUR', total: '5' }),
        ]}
        loadError=''
        isLoading={false}
      />,
    );

    const statuses = screen.getAllByRole('status').map((node) => node.textContent);
    expect(statuses).toEqual([
      'Could not load exchange rates for USD. Those amounts are excluded from the totals.',
      'No published rate for EUR on some issue dates. Those amounts are excluded from the totals.',
    ]);
  });

  it('says when a blank currency was counted as the default', () => {
    render(
      <IssuedInvoiceMonthsCard
        issuedInvoices={[invoice({ id: 'blank', currency: '', total: '40' })]}
        loadError=''
        isLoading={false}
      />,
    );
    expect(screen.getByText('HK$40.00')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 invoice has no currency and was counted as HKD.',
    );
  });

  it('says when the applied rate is from an earlier published date', () => {
    mockUseFx.mockReturnValue({
      ratesByCurrency: new Map([['USD', new Map([['2026-11-01', 7.8]])]]),
      failedCurrencies: [],
    });
    render(
      <IssuedInvoiceMonthsCard
        issuedInvoices={[invoice({ id: 'usd', currency: 'USD', total: '10' })]}
        loadError=''
        isLoading={false}
      />,
    );
    expect(screen.getByText('HK$78.00')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Rate for USD is from the previous published date, not the issue date.',
    );
  });

  it('moves to the next Hong Kong month while the tab stays open', () => {
    render(
      <IssuedInvoiceMonthsCard issuedInvoices={[]} loadError='' isLoading={false} />,
    );
    expect(screen.getByText('Nov 2026 (so far)')).toBeInTheDocument();

    const delay = nextHongKongMonthBoundary(NOW).getTime() - NOW.getTime();
    act(() => {
      vi.advanceTimersByTime(delay);
    });

    expect(screen.getByText('Dec 2026 (so far)')).toBeInTheDocument();
    expect(screen.getByText('Nov 2026')).toBeInTheDocument();
  });

  it('catches a Hong Kong month change when the tab becomes visible', () => {
    render(
      <IssuedInvoiceMonthsCard issuedInvoices={[]} loadError='' isLoading={false} />,
    );
    act(() => {
      vi.setSystemTime(new Date('2026-11-30T16:00:00.000Z'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByText('Dec 2026 (so far)')).toBeInTheDocument();
  });
});
