import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerInvoiceSummary } from '@/lib/billing-api';
import type { Expense } from '@/types/expenses';

const listAllAdminExpenses = vi.fn();
const listAllCustomerInvoices = vi.fn();

vi.mock('@/lib/expenses-api', () => ({
  listAllAdminExpenses: (...args: unknown[]) => listAllAdminExpenses(...args),
}));
vi.mock('@/lib/billing-api', () => ({
  listAllCustomerInvoices: (...args: unknown[]) => listAllCustomerInvoices(...args),
}));
vi.mock('@/hooks/use-fx-multipliers-for-currencies', () => ({
  useFxMultipliersForCurrencies: () => ({ fxMultipliers: new Map(), fxError: '' }),
}));

import { TaxFiscalYearPanel } from '@/components/admin/finance/tax-fiscal-year-panel';
import { ADMIN_TAX_FISCAL_YEAR_EMPTY_MESSAGE } from '@/lib/admin-tax-fiscal-year';

function expenseStub(partial: Partial<Expense> & Pick<Expense, 'id' | 'status'>): Expense {
  return {
    amendsExpenseId: null,
    parseStatus: 'not_requested',
    vendorId: null,
    vendorName: 'Paper Co',
    invoiceNumber: null,
    invoiceDate: '2025-06-10',
    dueDate: null,
    currency: 'HKD',
    subtotal: null,
    tax: '0',
    total: '200',
    lineItems: [],
    parseConfidence: null,
    notes: null,
    voidReason: null,
    createdBy: '',
    updatedBy: null,
    createdAt: '',
    updatedAt: '',
    submittedAt: null,
    paidAt: null,
    voidedAt: null,
    attachments: [],
    ...partial,
  } as Expense;
}

function invoiceStub(
  partial: Partial<CustomerInvoiceSummary> & Pick<CustomerInvoiceSummary, 'id'>,
): CustomerInvoiceSummary {
  return {
    status: 'issued',
    invoiceNumber: 'INV-1',
    currency: 'HKD',
    subtotal: '950',
    taxTotal: '50',
    total: '950',
    billToDisplayName: 'Family A',
    invoiceDate: '2025-08-01',
    issuedAt: '2025-08-01T08:00:00.000Z',
    isPaid: false,
    amountAllocated: '0',
    balanceDue: '950',
    ...partial,
  } as CustomerInvoiceSummary;
}

describe('TaxFiscalYearPanel', () => {
  beforeEach(() => {
    listAllAdminExpenses.mockReset();
    listAllCustomerInvoices.mockReset();
    listAllAdminExpenses.mockResolvedValue([]);
    listAllCustomerInvoices.mockResolvedValue([]);
  });

  it('loads expenses and invoices then shows empty state', async () => {
    render(<TaxFiscalYearPanel />);

    await waitFor(() => {
      expect(screen.getByText(ADMIN_TAX_FISCAL_YEAR_EMPTY_MESSAGE)).toBeInTheDocument();
    });
    expect(listAllCustomerInvoices).toHaveBeenCalledWith();
    expect(screen.getByLabelText('Status')).toHaveDisplayValue('Recognized');
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.queryByText('Expense status')).not.toBeInTheDocument();
  });

  it('shows expense status and invoice settlement on mixed rows', async () => {
    listAllAdminExpenses.mockResolvedValue([
      expenseStub({ id: 'e-paid', status: 'paid', vendorName: 'Paper Co' }),
      expenseStub({
        id: 'e-voided',
        status: 'voided',
        vendorName: 'Void Vendor',
        invoiceDate: '2025-06-11',
      }),
    ]);
    listAllCustomerInvoices.mockResolvedValue([
      invoiceStub({
        id: 'i-open',
        invoiceNumber: 'INV-OPEN',
        billToDisplayName: 'Family A',
      }),
      invoiceStub({
        id: 'i-void',
        status: 'void',
        invoiceNumber: 'INV-VOID',
        billToDisplayName: 'Family B',
        invoiceDate: '2025-08-02',
      }),
    ]);

    const user = userEvent.setup();
    render(<TaxFiscalYearPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('Fiscal year')).not.toBeDisabled();
    });
    await user.selectOptions(screen.getByLabelText('Fiscal year'), '2025');

    await waitFor(() => {
      expect(screen.getByText('Paper Co')).toBeInTheDocument();
    });
    expect(screen.getByText('Family A (INV-OPEN)')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getAllByText('Paid')).toHaveLength(1);
    expect(screen.queryByText('Void Vendor')).not.toBeInTheDocument();
    expect(screen.queryByText('Family B (INV-VOID)')).not.toBeInTheDocument();
  });

  it('voided filter shows voided expenses and void invoices, not recognized rows', async () => {
    listAllAdminExpenses.mockResolvedValue([
      expenseStub({ id: 'e-paid', status: 'paid', vendorName: 'Paper Co' }),
      expenseStub({
        id: 'e-voided',
        status: 'voided',
        vendorName: 'Void Vendor',
        invoiceDate: '2025-06-11',
      }),
    ]);
    listAllCustomerInvoices.mockResolvedValue([
      invoiceStub({
        id: 'i-open',
        invoiceNumber: 'INV-OPEN',
        billToDisplayName: 'Family A',
      }),
      invoiceStub({
        id: 'i-void',
        status: 'void',
        invoiceNumber: 'INV-VOID',
        billToDisplayName: 'Family B',
        invoiceDate: '2025-08-02',
      }),
    ]);

    const user = userEvent.setup();
    render(<TaxFiscalYearPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('Fiscal year')).not.toBeDisabled();
    });
    await user.selectOptions(screen.getByLabelText('Fiscal year'), '2025');

    await waitFor(() => {
      expect(screen.getByText('Paper Co')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('Status'), 'voided');

    expect(screen.getByText('Void Vendor')).toBeInTheDocument();
    expect(screen.getByText('Family B (INV-VOID)')).toBeInTheDocument();
    expect(screen.getByText('Voided')).toBeInTheDocument();
    expect(screen.getByText('Void')).toBeInTheDocument();
    expect(screen.queryByText('Paper Co')).not.toBeInTheDocument();
    expect(screen.queryByText('Family A (INV-OPEN)')).not.toBeInTheDocument();
  });

  it('keeps the Status filter labelled independently from table type cells', async () => {
    listAllAdminExpenses.mockResolvedValue([
      expenseStub({ id: 'e-paid', status: 'paid' }),
    ]);
    listAllCustomerInvoices.mockResolvedValue([]);

    const user = userEvent.setup();
    render(<TaxFiscalYearPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('Fiscal year')).not.toBeDisabled();
    });
    await user.selectOptions(screen.getByLabelText('Fiscal year'), '2025');

    await waitFor(() => {
      expect(screen.getByText('Paper Co')).toBeInTheDocument();
    });

    const statusSelect = screen.getByLabelText('Status');
    expect(within(statusSelect).getByRole('option', { name: 'Recognized' })).toBeInTheDocument();
    expect(within(statusSelect).getByRole('option', { name: 'In Progress' })).toBeInTheDocument();
    expect(within(statusSelect).getByRole('option', { name: 'Voided' })).toBeInTheDocument();
    expect(within(statusSelect).getByRole('option', { name: 'Amended' })).toBeInTheDocument();
    expect(within(statusSelect).getByRole('option', { name: 'All' })).toBeInTheDocument();
  });
});
