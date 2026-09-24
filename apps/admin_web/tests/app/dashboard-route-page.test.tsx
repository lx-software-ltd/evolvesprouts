import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/expenses-api', () => ({
  listAllAdminExpenses: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/lib/billing-api', () => ({
  listAllCustomerInvoices: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/hooks/use-fx-multipliers-for-currencies', () => ({
  useFxMultipliersForCurrencies: () => ({ fxMultipliers: new Map(), fxError: '' }),
}));

vi.mock('@/lib/config', () => ({
  getAdminDefaultCurrencyCode: vi.fn(() => 'HKD'),
}));

vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({ user: { subject: 'user-1' } }),
}));

vi.mock('@/lib/sales-daily-plan-api', () => ({
  fetchSalesDailyPlan: vi.fn(() => Promise.resolve({ plan: null, memory: [] })),
  enqueueSalesDailyPlanJob: vi.fn(),
  pollSalesDailyPlanJob: vi.fn(),
  resetSalesDailyPlanMemory: vi.fn(),
  upsertSalesDailyPlanPriorityCompletion: vi.fn(),
  upsertSalesDailyPlanItemAnnotation: vi.fn(),
  askSalesDailyPlanQuestion: vi.fn(),
}));

import DashboardRoutePage from '@/app/(dashboard)/dashboard/page';

describe('DashboardRoutePage', () => {
  it('renders dashboard cards without a page title', () => {
    render(<DashboardRoutePage />);
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sale Plan of the Day' })).toBeInTheDocument();
  });
});
