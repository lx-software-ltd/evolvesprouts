import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerInvoiceSummary } from '@/lib/billing-api';

vi.mock('@/lib/config', () => ({
  getAdminDefaultCurrencyCode: vi.fn(() => 'HKD'),
}));

const mockUseFx = vi.fn();
vi.mock('@/hooks/use-fx-multipliers-for-currencies', () => ({
  useFxMultipliersForCurrencies: (...args: unknown[]) => mockUseFx(...args),
}));

import { IssuedInvoiceMonthsCard } from '@/components/admin/dashboard/cards/issued-invoice-months-card';

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
    mockUseFx.mockReturnValue({ fxMultipliers: new Map(), fxError: '' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a skeleton while invoices are loading', () => {
    render(<IssuedInvoiceMonthsCard issuedInvoices={null} loadError='' isLoading />);
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Nov 2026')).not.toBeInTheDocument();
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

  it('lists six months with issued totals in the default currency', () => {
    render(
      <IssuedInvoiceMonthsCard
        issuedInvoices={[
          invoice({ id: 'nov', total: '1000', invoiceDate: '2026-11-02' }),
          invoice({ id: 'jun', total: '200.5', invoiceDate: '2026-06-15' }),
        ]}
        loadError=''
        isLoading={false}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Invoiced (last 6 months)' })).toBeInTheDocument();
    const terms = screen.getAllByRole('term').map((term) => term.textContent);
    expect(terms).toEqual(['Nov 2026', 'Oct 2026', 'Sep 2026', 'Aug 2026', 'Jul 2026', 'Jun 2026']);
    expect(screen.getByText('HK$1,000.00')).toBeInTheDocument();
    expect(screen.getByText('HK$200.50')).toBeInTheDocument();
    expect(screen.getAllByText('HK$0.00')).toHaveLength(4);
  });

  it('keeps the skeleton until foreign-currency multipliers resolve', () => {
    mockUseFx.mockReturnValue({ fxMultipliers: null, fxError: '' });
    render(
      <IssuedInvoiceMonthsCard
        issuedInvoices={[invoice({ id: 'usd', currency: 'USD', total: '10', invoiceDate: '2026-11-02' })]}
        loadError=''
        isLoading={false}
      />,
    );
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
    expect(mockUseFx).toHaveBeenCalledWith(['USD'], true);
  });

  it('warns when a foreign currency has no multiplier and still shows converted months', () => {
    mockUseFx.mockReturnValue({ fxMultipliers: new Map([['USD', 7.8]]), fxError: '' });
    render(
      <IssuedInvoiceMonthsCard
        issuedInvoices={[
          invoice({ id: 'hkd', total: '22', currency: 'HKD', invoiceDate: '2026-11-01' }),
          invoice({ id: 'usd', total: '10', currency: 'USD', invoiceDate: '2026-11-02' }),
          invoice({ id: 'eur', total: '5', currency: 'EUR', invoiceDate: '2026-11-03' }),
        ]}
        loadError=''
        isLoading={false}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'FX unavailable for EUR. Amounts in those currencies are excluded from totals.',
    );
    expect(screen.getByText('HK$100.00')).toBeInTheDocument();
  });

  it('shows an FX load error', () => {
    mockUseFx.mockReturnValue({
      fxMultipliers: new Map(),
      fxError: 'Could not load FX rates for currency conversion.',
    });
    render(
      <IssuedInvoiceMonthsCard
        issuedInvoices={[invoice({ id: 'usd', currency: 'USD', total: '10' })]}
        loadError=''
        isLoading={false}
      />,
    );
    expect(screen.getByText('Could not load FX rates for currency conversion.')).toBeInTheDocument();
  });
});
