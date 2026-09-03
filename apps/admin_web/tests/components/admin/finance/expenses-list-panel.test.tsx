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
import type { UseExpandedRecordReturn } from '@/hooks/use-expanded-record';
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

function makeExpanded(overrides: Partial<UseExpandedRecordReturn> = {}): UseExpandedRecordReturn {
  return {
    expandedId: null,
    isDraftOpen: false,
    isExpanded: vi.fn(() => false),
    toggle: vi.fn(),
    expand: vi.fn(),
    openDraft: vi.fn(),
    collapse: vi.fn(),
    discardPrompt: { open: false, confirm: vi.fn(), cancel: vi.fn() },
    ...overrides,
  };
}

function makeRowActions(
  overrides: {
    isVoidingId?: string | null;
    isMarkingPaidId?: string | null;
    isReparsingId?: string | null;
    isDeletingDraftId?: string | null;
    onReparse?: () => Promise<void> | void;
    onMarkPaid?: () => Promise<void> | void;
    onVoidExpense?: (expenseId: string, reason: string) => Promise<void> | void;
    onDeleteDraft?: (expenseId: string) => Promise<void> | void;
  } = {}
) {
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
  expanded: makeExpanded(),
  renderDetail: (expense: Expense | null) => <div data-testid='detail'>{expense ? expense.id : 'new'}</div>,
  query: '',
  status: '' as const,
  parseStatus: '' as const,
  isLoading: false,
  isLoadingMore: false,
  hasMore: false,
  error: '',
  onLoadMore: vi.fn(),
  onQueryChange: vi.fn(),
  onStatusChange: vi.fn(),
  onParseStatusChange: vi.fn(),
};

/** Only the document action is inline; the others live in the More menu. */
async function openMoreMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.getByRole('menu');
}

describe('ExpensesListPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserAssetDownloadUrl.mockReset();
    clearCurrencyConversionRateCacheForTests();
  });

  it('renders core columns without a title, Invoice or Parse headers', () => {
    render(<ExpensesListPanel {...listProps} {...makeRowActions()} />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Invoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Parse' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Operations' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Vendor' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Issued' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New expense' })).toBeInTheDocument();
  });

  it('opens the draft row from New expense and renders the create detail', async () => {
    const user = userEvent.setup();
    const expanded = makeExpanded();
    const { rerender } = render(<ExpensesListPanel {...listProps} expanded={expanded} {...makeRowActions()} />);

    await user.click(screen.getByRole('button', { name: 'New expense' }));
    expect(expanded.openDraft).toHaveBeenCalled();

    rerender(
      <ExpensesListPanel {...listProps} expanded={makeExpanded({ isDraftOpen: true })} {...makeRowActions()} />
    );
    expect(screen.getByText('New expense', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByTestId('detail')).toHaveTextContent('new');
  });

  it('toggles the row on click and renders the expense detail when expanded', async () => {
    const user = userEvent.setup();
    const expanded = makeExpanded();
    const { rerender } = render(<ExpensesListPanel {...listProps} expanded={expanded} {...makeRowActions()} />);

    expect(screen.queryByTestId('detail')).not.toBeInTheDocument();
    await user.click(screen.getByText('Acme Co'));
    expect(expanded.toggle).toHaveBeenCalledWith('exp-1');

    rerender(
      <ExpensesListPanel
        {...listProps}
        expanded={makeExpanded({ expandedId: 'exp-1', isExpanded: (id) => id === 'exp-1' })}
        {...makeRowActions()}
      />
    );
    expect(screen.getByTestId('detail')).toHaveTextContent('exp-1');
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
    expect(screen.getAllByText(formatMoneyLineWithFxToDefault('30.00', undefined, new Map())).length).toBeGreaterThan(0);
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
      expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
    });
  });

  it('formats HKD total with locale currency styling', () => {
    render(<ExpensesListPanel {...listProps} {...makeRowActions()} />);

    expect(screen.getAllByText(formatMoneyLineWithFxToDefault('10.00', 'HKD', new Map())).length).toBeGreaterThan(0);
  });

  it('calls onReparse from the More menu', async () => {
    const user = userEvent.setup();
    const rowActions = makeRowActions();

    render(<ExpensesListPanel {...listProps} {...rowActions} />);

    await openMoreMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Reparse expense' }));
    expect(rowActions.onReparse).toHaveBeenCalledWith('exp-1');
  });

  it('calls onMarkPaid from the More menu', async () => {
    const user = userEvent.setup();
    const rowActions = makeRowActions();

    render(<ExpensesListPanel {...listProps} {...rowActions} />);

    await openMoreMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Mark expense as paid' }));
    expect(rowActions.onMarkPaid).toHaveBeenCalledWith('exp-1');
  });

  it('disables mark paid when vendor, invoice date, currency, or total is missing', async () => {
    const user = userEvent.setup();
    const rowActions = makeRowActions();

    for (const expense of [
      { ...baseExpense, vendorId: null },
      { ...baseExpense, invoiceDate: null },
      { ...baseExpense, currency: null },
      { ...baseExpense, total: null },
    ]) {
      const view = render(<ExpensesListPanel {...listProps} {...rowActions} expenses={[expense]} />);
      await openMoreMenu(user);
      const item = screen.getByRole('menuitem', { name: /required before marking paid/ });
      expect(item).toHaveAttribute('aria-disabled', 'true');
      await user.click(item);
      expect(rowActions.onMarkPaid).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('void dialog requires a reason before confirming', async () => {
    const user = userEvent.setup();
    const rowActions = makeRowActions();

    render(<ExpensesListPanel {...listProps} {...rowActions} />);

    await openMoreMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Void expense' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Void expense' }));
    expect(screen.getByText('Reason is required.')).toBeInTheDocument();
    expect(rowActions.onVoidExpense).not.toHaveBeenCalled();
  });

  it('void dialog calls onVoidExpense with reason and closes on success', async () => {
    const user = userEvent.setup();
    const rowActions = makeRowActions();

    render(<ExpensesListPanel {...listProps} {...rowActions} />);

    await openMoreMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Void expense' }));
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

    await openMoreMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Void expense' }));
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

    render(<ExpensesListPanel {...listProps} {...rowActions} expenses={[{ ...baseExpense, status: 'draft' }]} />);

    await openMoreMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete draft expense' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete draft expense' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete expense' }));

    await waitFor(() => {
      expect(rowActions.onDeleteDraft).toHaveBeenCalledWith('exp-1');
    });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Delete draft expense' })).not.toBeInTheDocument();
    });
  });

  it('does not render delete for non-draft expenses', async () => {
    const user = userEvent.setup();
    render(<ExpensesListPanel {...listProps} {...makeRowActions()} />);

    await openMoreMenu(user);
    expect(screen.queryByRole('menuitem', { name: 'Delete draft expense' })).not.toBeInTheDocument();
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

    await openMoreMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Void expense' }));
    await user.type(screen.getByLabelText('Reason'), 'Waiting');
    const confirmPromise = user.click(screen.getByRole('button', { name: 'Void expense' }));

    rerender(<ExpensesListPanel {...listProps} {...makeRowActions({ onVoidExpense, isVoidingId: 'exp-1' })} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Voiding…' })).toBeDisabled();
    });
    expect(screen.queryByRole('button', { name: 'Void expense' })).toBeNull();

    resolveVoid!();
    await confirmPromise;
  });
});
