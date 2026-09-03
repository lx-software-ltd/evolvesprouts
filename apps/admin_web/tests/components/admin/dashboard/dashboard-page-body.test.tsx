import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListAllAdminExpenses = vi.fn();
const mockListAllCustomerInvoices = vi.fn();
const mockResolveBillToPrimaryContacts = vi.fn();

vi.mock('@/lib/config', () => ({
  getAdminDefaultCurrencyCode: vi.fn(() => 'HKD'),
}));

vi.mock('@/hooks/use-fx-multipliers-for-currencies', () => ({
  useFxMultipliersForCurrencies: () => ({ fxMultipliers: new Map(), fxError: '' }),
}));

vi.mock('@/lib/expenses-api', () => ({
  listAllAdminExpenses: (...args: unknown[]) => mockListAllAdminExpenses(...args),
}));

vi.mock('@/lib/billing-api', () => ({
  listAllCustomerInvoices: (...args: unknown[]) => mockListAllCustomerInvoices(...args),
  resolveBillToPrimaryContacts: (...args: unknown[]) => mockResolveBillToPrimaryContacts(...args),
}));

vi.mock('@/lib/sales-daily-plan-api', () => ({
  fetchSalesDailyPlan: vi.fn(() => Promise.resolve({ plan: null, memory: [] })),
  enqueueSalesDailyPlanJob: vi.fn(),
  pollSalesDailyPlanJob: vi.fn(),
  resetSalesDailyPlanMemory: vi.fn(),
}));

import { DashboardPageBody } from '@/components/admin/dashboard/dashboard-page-body';
import { ADMIN_TAX_FISCAL_YEAR_EMPTY_MESSAGE } from '@/lib/admin-tax-fiscal-year';

describe('DashboardPageBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAllAdminExpenses.mockResolvedValue([]);
    mockListAllCustomerInvoices.mockResolvedValue([]);
    mockResolveBillToPrimaryContacts.mockResolvedValue({
      familyPrimaryContactById: {},
      organizationPrimaryContactById: {},
    });
  });

  it('loads finance payloads once and passes them to the Tax Position card', async () => {
    render(<DashboardPageBody />);

    await waitFor(() => {
      expect(mockListAllAdminExpenses).toHaveBeenCalledTimes(1);
      expect(mockListAllCustomerInvoices).toHaveBeenCalledWith({ status: 'issued' });
    });

    await waitFor(() => {
      expect(screen.getByText(ADMIN_TAX_FISCAL_YEAR_EMPTY_MESSAGE)).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Sale Plan of the Day' })).toBeInTheDocument();

    expect(mockResolveBillToPrimaryContacts).not.toHaveBeenCalled();
  });
});
