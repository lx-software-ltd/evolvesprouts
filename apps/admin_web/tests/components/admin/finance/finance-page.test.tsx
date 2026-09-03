import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUseExpenses,
  expensesState,
  mockUseVendors,
  vendorsState,
  mockListAllAdminExpenses,
} = vi.hoisted(() => {
  const expanded = {
    expandedId: null as string | null,
    isDraftOpen: false,
    isExpanded: vi.fn(() => false),
    toggle: vi.fn(),
    expand: vi.fn(),
    openDraft: vi.fn(),
    collapse: vi.fn(),
    discardPrompt: { open: false, confirm: vi.fn(), cancel: vi.fn() },
  };
  const state = {
    items: [],
    filters: { query: '', status: '', parseStatus: '' },
    setFilter: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    error: '',
    refetch: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
    totalCount: 0,
    expanded,
    setEditorDirty: vi.fn(),
    selectedExpenseId: null as string | null,
    selectedExpense: null,
    isSaving: false,
    isUploadingFiles: false,
    isDeletingId: null as string | null,
    isDeletingDraftId: null as string | null,
    isMarkingPaidId: null as string | null,
    isReparsingId: null as string | null,
    isBulkImporting: false,
    bulkImportError: '',
    mutationError: '',
    selectExpense: vi.fn(),
    clearSelectedExpense: vi.fn(),
    clearMutationError: vi.fn(),
    createExpenseEntry: vi.fn(),
    updateExpenseEntry: vi.fn(),
    amendExpenseEntry: vi.fn(),
    cancelExpenseEntry: vi.fn(),
    deleteDraftExpenseEntry: vi.fn(),
    markPaidExpenseEntry: vi.fn(),
    reparseExpenseEntry: vi.fn(),
    bulkImportFromPdf: vi.fn(),
    cancelBulkImport: vi.fn(),
  };
  const vendorsState = {
    vendors: [],
    filters: { query: '', active: '' },
    setFilter: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    isSaving: false,
    hasMore: false,
    error: '',
    loadMore: vi.fn(),
    totalCount: 0,
    createVendor: vi.fn(),
    updateVendor: vi.fn(),
    refetch: vi.fn(),
  };
  return {
    expensesState: state,
    mockUseExpenses: vi.fn(() => state),
    vendorsState,
    mockUseVendors: vi.fn(() => vendorsState),
    mockListAllAdminExpenses: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('@/hooks/use-expenses', () => ({
  useExpenses: mockUseExpenses,
}));
vi.mock('@/hooks/use-vendors', () => ({
  useVendors: mockUseVendors,
}));

vi.mock('@/lib/expenses-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/expenses-api')>('@/lib/expenses-api');
  return {
    ...actual,
    listAllAdminExpenses: mockListAllAdminExpenses,
  };
});

vi.mock('@/hooks/use-enrollment-parent-pickers', () => ({
  useEnrollmentParentPickers: () => ({
    contactOptions: [],
    families: [],
    organizations: [],
    partnerOrganizations: [],
    loading: false,
    error: '',
    labelByContactId: new Map(),
    labelByFamilyId: new Map(),
    labelByOrganizationId: new Map(),
    labelByPartnerOrganizationId: new Map(),
  }),
}));

vi.mock('@/components/admin/finance/tax-fiscal-year-panel', () => ({
  TaxFiscalYearPanel: () => <h2>Tax fiscal snapshot</h2>,
}));

import { FinancePage } from '@/components/admin/finance/finance-page';

describe('FinancePage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/finance');
    expensesState.expanded.isDraftOpen = false;
    expensesState.expanded.expandedId = null;
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/finance');
  });

  it('renders finance tabs and switches to scaffold tab', async () => {
    const user = userEvent.setup();
    render(<FinancePage />);

    expect(screen.getByRole('button', { name: 'Expenses' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vendors' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Client Invoices' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tax' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Customer invoices' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Vendors' }));
    expect(screen.getByRole('region', { name: 'Vendors' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vendors' })).not.toBeInTheDocument();
    expect(mockListAllAdminExpenses).toHaveBeenCalled();
    expect(window.location.search).toBe('?tab=vendors');

    await user.click(screen.getByRole('button', { name: 'Tax' }));
    expect(screen.getByRole('heading', { name: 'Tax fiscal snapshot' })).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=tax');

    await user.click(screen.getByRole('button', { name: 'Expenses' }));
    expect(screen.getByRole('region', { name: 'Expenses' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New expense' })).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=expenses');

    await user.click(screen.getByRole('button', { name: 'Client Invoices' }));
    expect(screen.getByRole('region', { name: 'Customer invoices' })).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('seeds the active tab from the URL query parameter on mount', async () => {
    window.history.replaceState(null, '', '/finance?tab=client-invoices');
    render(<FinancePage />);
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Customer invoices' })).toBeInTheDocument();
    });
  });

  it('renders filters, then the combined-PDF import accordion, then the expenses table', () => {
    window.history.replaceState(null, '', '/finance?tab=expenses');
    render(<FinancePage />);

    const searchFilter = screen.getByLabelText('Search');
    const bulkTrigger = screen.getByRole('button', { name: /Import from combined PDF/ });
    const table = screen.getByRole('table');

    expect(searchFilter.compareDocumentPosition(bulkTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bulkTrigger.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bulkTrigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('uses expense hook state', () => {
    render(<FinancePage />);
    expect(mockUseExpenses).toHaveBeenCalled();
    expect(mockUseVendors).toHaveBeenCalled();
    expect(expensesState.items).toEqual([]);
    expect(vendorsState.vendors).toEqual([]);
  });

  it('renders the draft expense editor in-row with a currency dropdown', () => {
    window.history.replaceState(null, '', '/finance?tab=expenses&expense=new');
    expensesState.expanded.isDraftOpen = true;
    expensesState.expanded.expandedId = 'new';
    render(<FinancePage />);

    expect(screen.queryByRole('heading', { name: 'Expense Details' })).not.toBeInTheDocument();
    const currencyField = screen.getByLabelText('Currency');
    expect(currencyField.tagName).toBe('SELECT');
    expect(screen.getByRole('button', { name: 'Submit expense' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });
});
