import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetUserAssetDownloadUrl } = vi.hoisted(() => ({
  mockGetUserAssetDownloadUrl: vi.fn(),
}));

vi.mock('@/lib/assets-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/assets-api')>();
  return {
    ...actual,
    getUserAssetDownloadUrl: mockGetUserAssetDownloadUrl,
  };
});

vi.mock('@/lib/currency-converter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/currency-converter')>();
  return {
    ...actual,
    getCurrencyConversionMultiplier: vi.fn(async (fromCurrency: string, toCurrency: string) => {
      const from = fromCurrency.trim().toUpperCase();
      const to = toCurrency.trim().toUpperCase();
      if (!from || !to || from === to) {
        return 1;
      }
      if (from === 'USD' && to === 'HKD') {
        return 7.8;
      }
      return 1;
    }),
  };
});

import { ExpensesListPanel } from '@/components/admin/finance/expenses-list-panel';
import { clearCurrencyConversionRateCacheForTests } from '@/lib/currency-converter';
import { formatDateOnly } from '@/lib/format';
import { formatMoneyLineWithFxToDefault } from '@/lib/vendor-spend';

import type { Expense } from '@/types/expenses';

const baseExpense: Expense = {
  id: 'exp-1',
  amendsExpenseId: null,
  status: 'submitted',
  parseStatus: 'succeeded',
  vendorId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  vendorName: 'Acme Co',
  invoiceNumber: 'INV-9',
  invoiceDate: '2026-03-01',
  dueDate: null,
  currency: 'HKD',
  subtotal: '10.00',
  tax: '0',
  total: '10.00',
  lineItems: [],
  parseConfidence: null,
  notes: null,
  voidReason: null,
  createdBy: 'u',
  updatedBy: null,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  submittedAt: null,
  paidAt: null,
  voidedAt: null,
  attachments: [],
};

function makeRowActions(overrides: {
  isVoidingId?: string | null;
  isMarkingPaidId?: string | null;
  isReparsingId?: string | null;
  isDeletingDraftId?: string | null;
  onReparse?: () => Promise<void> | void;
  onMarkPaid?: () => Promise<void> | void;
  onVoidExpense?: (expenseId: string, reason: string) => Promise<void> | void;
  onDeleteDraft?: (expenseId: string) => Promise<void> | void;
} = {}) {
  return {
    isVoidingId: null as string | null,
    isMarkingPaidId: null as string | null,
    isReparsingId: null as string | null,
    isDeletingDraftId: null as string | null,
    onReparse: vi.fn().mockResolvedValue(undefined),
    onMarkPaid: vi.fn().mockResolvedValue(undefined),
    onVoidExpense: vi.fn().mockResolvedValue(undefined),
    onDeleteDraft: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const listProps = {
  expenses: [baseExpense],
  selectedExpenseId: null,
  query: '',
  status: '' as const,
  parseStatus: '' as const,
  isLoading: false,
  isLoadingMore: false,
  hasMore: false,
  error: '',
  onLoadMore: vi.fn(),
  onSelectExpense: vi.fn(),
  onQueryChange: vi.fn(),
  onStatusChange: vi.fn(),
  onParseStatusChange: vi.fn(),
};

describe('ExpensesListPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserAssetDownloadUrl.mockReset();
    clearCurrencyConversionRateCacheForTests();
  });

  it('renders core columns without Invoice or Parse headers', () => {
    render(<ExpensesListPanel {...listProps} {...makeRowActions()} />);

    expect(screen.queryByRole('columnheader', { name: 'Invoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Parse' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Operations' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Vendor' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Issued' })).toBeInTheDocument();
  });

  it('opens primary expense attachment in a new tab', async () => {
    const user = userEvent.setup();
    mockGetUserAssetDownloadUrl.mockResolvedValueOnce('https://cdn.example.com/invoice.pdf');
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <ExpensesListPanel
        {...listProps}
        expenses={[
          {
            ...baseExpense,
            attachments: [
              {
                id: 'ea-1',
                assetId: 'asset-doc-1',
                sortOrder: 0,
                fileName: 'invoice.pdf',
                contentType: 'application/pdf',
                assetTitle: null,
              },
            ],
          },
        ]}
        {...makeRowActions()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Open invoice document in new tab' }));

    expect(mockGetUserAssetDownloadUrl).toHaveBeenCalledWith('asset-doc-1');
    expect(openSpy).toHaveBeenCalledWith('https://cdn.example.com/invoice.pdf', '_blank', 'noopener,noreferrer');

    openSpy.mockRestore();
  });

  it('disables document open when expense has no attachments', () => {
    render(<ExpensesListPanel {...listProps} {...makeRowActions()} />);

    expect(screen.getByRole('button', { name: 'No invoice document available' })).toBeDisabled();
  });

  it('shows invoice date without time in Issued column and formats total like tax amounts when currency is missing', () => {
    render(
      <ExpensesListPanel
        {...listProps}
        expenses={[
          {
            ...baseExpense,
            invoiceDate: '2026-02-15T14:30:00Z',
            currency: null,
            total: '30.00',
          },
        ]}
        {...makeRowActions()}
      />
    );

    expect(screen.getByText(formatDateOnly('2026-02-15T14:30:00Z'))).toBeInTheDocument();
    expect(
      screen.getByText(formatMoneyLineWithFxToDefault('30.00', undefined, new Map())),
    ).toBeInTheDocument();
    expect(screen.queryByText('No currency code')).not.toBeInTheDocument();
  });

  it('formats total with FX line for non-default currency (same helper as tax fiscal year table)', async () => {
    const multipliers = new Map([['USD', 7.8]]);
    const expected = formatMoneyLineWithFxToDefault('100.00', 'USD', multipliers);

    render(
      <ExpensesListPanel
        {...listProps}
        expenses={[{ ...baseExpense, currency: 'USD', total: '100.00' }]}
        {...makeRowActions()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  it('formats HKD total with locale currency styling', () => {
    render(<ExpensesListPanel {...listProps} {...makeRowActions()} />);

    expect(
      screen.getByText(formatMoneyLineWithFxToDefault('10.00', 'HKD', new Map())),
    ).toBeInTheDocument();
  });

  it('calls onSelectExpense when a row is clicked', async () => {
    const user = userEvent.setup();
    const onSelectExpense = vi.fn();

    render(<ExpensesListPanel {...listProps} {...makeRowActions()} onSelectExpense={onSelectExpense} />);

    await user.click(screen.getByText('Acme Co'));
    expect(onSelectExpense).toHaveBeenCalledWith('exp-1');
  });

  it('calls onReparse when Reparse is clicked', async () => {
    const user = userEvent.setup();
    const rowActions = makeRowActions();

    render(<ExpensesListPanel {...listProps} {...rowActions} />);

    await user.click(screen.getByRole('button', { name: 'Reparse expense' }));
    expect(rowActions.onReparse).toHaveBeenCalledWith('exp-1');
  });

  it('calls onMarkPaid when Paid is clicked', async () => {
    const user = userEvent.setup();
    const rowActions = makeRowActions();

    render(<ExpensesListPanel {...listProps} {...rowActions} />);

    await user.click(screen.getByRole('button', { name: 'Mark expense as paid' }));
    expect(rowActions.onMarkPaid).toHaveBeenCalledWith('exp-1');
  });

  it('disables mark paid when vendor, invoice date, currency, or total is missing', () => {
    const rowActions = makeRowActions();

    const { rerender } = render(
      <ExpensesListPanel
        {...listProps}
        {...rowActions}
        expenses={[{ ...baseExpense, vendorId: null }]}
      />
    );
    expect(screen.getByRole('button', { name: 'Mark expense as paid' })).toBeDisabled();

    rerender(
      <ExpensesListPanel
        {...listProps}
        {...rowActions}
        expenses={[{ ...baseExpense, invoiceDate: null }]}
      />
    );
    expect(screen.getByRole('button', { name: 'Mark expense as paid' })).toBeDisabled();

    rerender(
      <ExpensesListPanel
        {...listProps}
        {...rowActions}
        expenses={[{ ...baseExpense, currency: null }]}
      />
    );
    expect(screen.getByRole('button', { name: 'Mark expense as paid' })).toBeDisabled();

    rerender(
      <ExpensesListPanel
        {...listProps}
        {...rowActions}
        expenses={[{ ...baseExpense, total: null }]}
      />
    );
    expect(screen.getByRole('button', { name: 'Mark expense as paid' })).toBeDisabled();
  });

  it('void dialog requires a reason before confirming', async () => {
    const user = userEvent.setup();
    const rowActions = makeRowActions();

    render(<ExpensesListPanel {...listProps} {...rowActions} />);

    await user.click(screen.getByRole('button', { name: 'Void' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Void expense' }));
    expect(screen.getByText('Reason is required.')).toBeInTheDocument();
    expect(rowActions.onVoidExpense).not.toHaveBeenCalled();
  });

  it('void dialog calls onVoidExpense with reason and closes on success', async () => {
    const user = userEvent.setup();
    const rowActions = makeRowActions();

    render(<ExpensesListPanel {...listProps} {...rowActions} />);

    await user.click(screen.getByRole('button', { name: 'Void' }));
    await user.type(screen.getByLabelText('Reason'), 'Duplicate entry');
    await user.click(screen.getByRole('button', { name: 'Void expense' }));

    await waitFor(() => {
      expect(rowActions.onVoidExpense).toHaveBeenCalledWith('exp-1', 'Duplicate entry');
    });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  it('void dialog shows API error and stays open on failure', async () => {
    const user = userEvent.setup();
    const rowActions = makeRowActions({
      onVoidExpense: vi.fn().mockRejectedValue(new Error('Service unavailable')),
    });

    render(<ExpensesListPanel {...listProps} {...rowActions} />);

    await user.click(screen.getByRole('button', { name: 'Void' }));
    await user.type(screen.getByLabelText('Reason'), 'Bad invoice');
    await user.click(screen.getByRole('button', { name: 'Void expense' }));

    await waitFor(() => {
      expect(screen.getByText('Service unavailable')).toBeInTheDocument();
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(rowActions.onVoidExpense).toHaveBeenCalledWith('exp-1', 'Bad invoice');
  });

  it('delete draft opens confirm dialog and calls onDeleteDraft', async () => {
    const user = userEvent.setup();
    const rowActions = makeRowActions();

    render(
      <ExpensesListPanel
        {...listProps}
        {...rowActions}
        expenses={[{ ...baseExpense, status: 'draft' }]}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Delete draft expense' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete draft expense' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete expense' }));

    await waitFor(() => {
      expect(rowActions.onDeleteDraft).toHaveBeenCalledWith('exp-1');
    });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Delete draft expense' })).not.toBeInTheDocument();
    });
  });

  it('does not render delete for non-draft expenses', () => {
    render(<ExpensesListPanel {...listProps} {...makeRowActions()} />);

    expect(screen.queryByRole('button', { name: 'Delete draft expense' })).not.toBeInTheDocument();
  });

  it('disables void confirm while void mutation is in flight for that expense', async () => {
    const user = userEvent.setup();
    let resolveVoid: () => void;
    const voidPromise = new Promise<void>((resolve) => {
      resolveVoid = resolve;
    });
    const onVoidExpense = vi.fn(() => voidPromise);

    const { rerender } = render(
      <ExpensesListPanel {...listProps} {...makeRowActions({ onVoidExpense, isVoidingId: null })} />
    );

    await user.click(screen.getByRole('button', { name: 'Void' }));
    await user.type(screen.getByLabelText('Reason'), 'Waiting');
    const confirmPromise = user.click(screen.getByRole('button', { name: 'Void expense' }));

    rerender(
      <ExpensesListPanel
        {...listProps}
        {...makeRowActions({ onVoidExpense, isVoidingId: 'exp-1' })}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Voiding…' })).toBeDisabled();
    });
    expect(screen.queryByRole('button', { name: 'Void expense' })).toBeNull();

    resolveVoid!();
    await confirmPromise;
  });
});
