'use client';

import { useMemo, useState, type ReactNode } from 'react';

import OpenInNewTabIcon from '@/components/icons/svg/open-in-new-tab-icon.svg';
import { DeleteIcon, MarkPaidIcon, RotateIcon, VoidExpenseIcon } from '@/components/icons/action-icons';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminDiscardChangesDialog } from '@/components/ui/admin-discard-changes-dialog';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toErrorMessage } from '@/hooks/hook-errors';
import { DRAFT_RECORD_ID, type UseExpandedRecordReturn } from '@/hooks/use-expanded-record';
import { useFxMultipliersForCurrencies } from '@/hooks/use-fx-multipliers-for-currencies';
import { useOpenAdminAssetInNewTab } from '@/hooks/use-open-admin-asset-in-new-tab';
import { getAdminDefaultCurrencyCode } from '@/lib/config';
import { primaryExpenseAttachmentAssetId } from '@/lib/expense-attachments';
import { formatDateOnly, formatEnumLabel } from '@/lib/format';
import { formatMoneyLineWithFxToDefault } from '@/lib/vendor-spend';
import {
  EXPENSE_PARSE_STATUSES,
  EXPENSE_STATUSES,
  type Expense,
  type ExpenseParseStatus,
  type ExpenseStatus,
} from '@/types/expenses';

const COLUMN_COUNT = 6;

function expenseHasRequiredFieldsForMarkPaid(expense: Expense): boolean {
  if (expense.vendorId == null || String(expense.vendorId).trim() === '') {
    return false;
  }
  if (expense.invoiceDate == null || String(expense.invoiceDate).trim() === '') {
    return false;
  }
  if (expense.currency == null || expense.currency.trim() === '') {
    return false;
  }
  if (expense.total == null || String(expense.total).trim() === '') {
    return false;
  }
  return true;
}

function markPaidLabel(expense: Expense, busy: boolean): string {
  if (busy) {
    return 'Marking expense as paid';
  }
  if (expense.status === 'paid') {
    return 'Already marked paid';
  }
  if (!expenseHasRequiredFieldsForMarkPaid(expense)) {
    return 'Vendor, invoice date, currency, and total are required before marking paid';
  }
  return 'Mark expense as paid';
}

interface ExpensesListPanelProps {
  expenses: Expense[];
  /** Single-open row state from `useExpenses`. */
  expanded: UseExpandedRecordReturn;
  query: string;
  status: ExpenseStatus | '';
  parseStatus: ExpenseParseStatus | '';
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string;
  isVoidingId: string | null;
  isMarkingPaidId: string | null;
  isReparsingId: string | null;
  isDeletingDraftId: string | null;
  /** Sub-accordion rendered between the filters and the table (combined-PDF import). */
  importSection?: ReactNode;
  /** Editor for the open row; `null` for the draft row. */
  renderDetail: (expense: Expense | null) => ReactNode;
  onLoadMore: () => Promise<void> | void;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: ExpenseStatus | '') => void;
  onParseStatusChange: (value: ExpenseParseStatus | '') => void;
  onReparse: (expenseId: string) => Promise<void> | void;
  onMarkPaid: (expenseId: string) => Promise<void> | void;
  onVoidExpense: (expenseId: string, reason: string) => Promise<void> | void;
  onDeleteDraft: (expenseId: string) => Promise<void> | void;
}

/**
 * Table-first expenses list: filters and the create control on top, one
 * expandable row per expense with its editor beneath, and every row action
 * in the Operations column (one inline, the rest in the More menu).
 */
export function ExpensesListPanel({
  expenses,
  expanded,
  query,
  status,
  parseStatus,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  isVoidingId,
  isMarkingPaidId,
  isReparsingId,
  isDeletingDraftId,
  importSection,
  renderDetail,
  onLoadMore,
  onQueryChange,
  onStatusChange,
  onParseStatusChange,
  onReparse,
  onMarkPaid,
  onVoidExpense,
  onDeleteDraft,
}: ExpensesListPanelProps) {
  const { openingAssetId, openError: documentOpenError, openAssetInNewTab } = useOpenAdminAssetInNewTab();
  const [deleteDraftExpenseId, setDeleteDraftExpenseId] = useState<string | null>(null);
  const [deleteDraftError, setDeleteDraftError] = useState('');
  const [voidExpenseId, setVoidExpenseId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');

  const expensesNeedForeignFx = useMemo(() => {
    const defaultCurrency = getAdminDefaultCurrencyCode();
    return expenses.some(
      (expense) => (expense.currency?.trim().toUpperCase() || defaultCurrency) !== defaultCurrency
    );
  }, [expenses]);

  const expenseFxCurrencyCodes = useMemo(
    () =>
      expenses
        .map((expense) => expense.currency?.trim().toUpperCase())
        .filter((code): code is string => Boolean(code)),
    [expenses]
  );
  const { fxMultipliers, fxError } = useFxMultipliersForCurrencies(expenseFxCurrencyCodes, expensesNeedForeignFx);

  const tableError = [error, expensesNeedForeignFx ? fxError : '', documentOpenError].filter(Boolean).join(' • ');

  const closeVoidDialog = () => {
    setVoidExpenseId(null);
    setVoidReason('');
    setVoidError('');
  };

  const confirmVoid = async () => {
    if (!voidReason.trim()) {
      setVoidError('Reason is required.');
      return;
    }
    setVoidError('');
    if (!voidExpenseId) {
      return;
    }
    try {
      await onVoidExpense(voidExpenseId, voidReason.trim());
      closeVoidDialog();
    } catch (caught) {
      setVoidError(toErrorMessage(caught, 'Could not void this expense.', { honorBackendMessage: true }));
    }
  };

  const closeDeleteDraftDialog = () => {
    setDeleteDraftExpenseId(null);
    setDeleteDraftError('');
  };

  const confirmDeleteDraft = async () => {
    setDeleteDraftError('');
    if (!deleteDraftExpenseId) {
      return;
    }
    try {
      await onDeleteDraft(deleteDraftExpenseId);
      closeDeleteDraftDialog();
    } catch (caught) {
      setDeleteDraftError(toErrorMessage(caught, 'Could not delete this expense.', { honorBackendMessage: true }));
    }
  };

  function formatTotal(expense: Expense): string {
    if (fxMultipliers === null && expensesNeedForeignFx) {
      return '…';
    }
    return formatMoneyLineWithFxToDefault(
      expense.total?.trim() ?? '',
      expense.currency ?? undefined,
      expensesNeedForeignFx ? (fxMultipliers ?? new Map()) : new Map()
    );
  }

  return (
    <>
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AdminRecordTable
        aria-label='Expenses'
        columnCount={COLUMN_COUNT}
        rowCount={expenses.length}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        error={tableError}
        errorTitle='Expenses'
        emptyLabel='No expenses match the current filters.'
        filters={
          <>
            <AdminFilterBar
              trailing={
                <AdminCreateButton
                  label='New expense'
                  active={expanded.isDraftOpen}
                  onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
                />
              }
            >
              <AdminFilterField label='Search' htmlFor='expenses-query' className='sm:basis-72'>
                <Input
                  id='expenses-query'
                  placeholder='Vendor or invoice number'
                  value={query}
                  autoComplete='off'
                  onChange={(event) => onQueryChange(event.target.value)}
                />
              </AdminFilterField>
              <AdminFilterField label='Status' htmlFor='expenses-status' className='sm:basis-40'>
                <Select
                  id='expenses-status'
                  value={status}
                  onChange={(event) => onStatusChange(event.target.value as ExpenseStatus | '')}
                >
                  <option value=''>All</option>
                  {EXPENSE_STATUSES.map((entry) => (
                    <option key={entry} value={entry}>
                      {formatEnumLabel(entry)}
                    </option>
                  ))}
                </Select>
              </AdminFilterField>
              <AdminFilterField label='Parse status' htmlFor='expenses-parse-status' className='sm:basis-40'>
                <Select
                  id='expenses-parse-status'
                  value={parseStatus}
                  onChange={(event) => onParseStatusChange(event.target.value as ExpenseParseStatus | '')}
                >
                  <option value=''>All</option>
                  {EXPENSE_PARSE_STATUSES.map((entry) => (
                    <option key={entry} value={entry}>
                      {formatEnumLabel(entry)}
                    </option>
                  ))}
                </Select>
              </AdminFilterField>
            </AdminFilterBar>
            {importSection}
          </>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Vendor</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Total</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Status</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Issued</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new expense'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New expense</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
              </>
            }
            actions={null}
            detail={renderDetail(null)}
          />
        ) : null}
        {expenses.map((expense) => {
          const isOpen = expanded.isExpanded(expense.id);
          const documentAssetId = primaryExpenseAttachmentAssetId(expense.attachments);
          const isOpeningDocument = Boolean(documentAssetId && openingAssetId === documentAssetId);
          const isMarkingPaid = isMarkingPaidId === expense.id;
          const isReparsing = isReparsingId === expense.id;
          const isVoiding = isVoidingId === expense.id;
          const isDeletingDraft = isDeletingDraftId === expense.id;
          const totalLabel = formatTotal(expense);
          const statusLabel = formatEnumLabel(expense.status);
          return (
            <AdminExpandableRow
              key={expense.id}
              id={expense.id}
              label={expense.vendorName ?? expense.invoiceNumber ?? expense.id.slice(0, 8)}
              expanded={isOpen}
              onToggle={() => expanded.toggle(expense.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell>
                    <p className='font-medium text-slate-900'>{expense.vendorName ?? '—'}</p>
                    <p className='mt-0.5 text-xs text-slate-500'>{expense.invoiceNumber ?? expense.id.slice(0, 8)}</p>
                    <AdminDataTableCellMeta>
                      {totalLabel} · {statusLabel}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='tabular-nums'>
                    {totalLabel}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary'>{statusLabel}</AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary'>{formatDateOnly(expense.invoiceDate)}</AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'open-document',
                      label: documentAssetId
                        ? isOpeningDocument
                          ? 'Opening invoice document'
                          : 'Open invoice document in new tab'
                        : 'No invoice document available',
                      icon: <OpenInNewTabIcon className='h-4 w-4' />,
                      disabled: !documentAssetId || isOpeningDocument,
                      onClick: () => {
                        if (documentAssetId) {
                          void openAssetInNewTab(documentAssetId);
                        }
                      },
                    },
                    {
                      key: 'mark-paid',
                      label: markPaidLabel(expense, isMarkingPaid),
                      icon: <MarkPaidIcon className='h-4 w-4' />,
                      tone: 'success',
                      disabled:
                        isMarkingPaid || expense.status === 'paid' || !expenseHasRequiredFieldsForMarkPaid(expense),
                      onClick: () => void onMarkPaid(expense.id),
                    },
                    {
                      key: 'reparse',
                      label: isReparsing ? 'Reparsing expense' : 'Reparse expense',
                      icon: <RotateIcon className='h-4 w-4' />,
                      disabled: isReparsing,
                      onClick: () => void onReparse(expense.id),
                    },
                    {
                      key: 'void',
                      label: isVoiding ? 'Voiding expense' : 'Void expense',
                      icon: <VoidExpenseIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: isVoiding || expense.status === 'voided',
                      onClick: () => {
                        setVoidReason('');
                        setVoidError('');
                        setVoidExpenseId(expense.id);
                      },
                    },
                    {
                      key: 'delete-draft',
                      label: isDeletingDraft ? 'Deleting draft expense' : 'Delete draft expense',
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      hidden: expense.status !== 'draft',
                      disabled: isDeletingDraft,
                      onClick: () => {
                        setDeleteDraftError('');
                        setDeleteDraftExpenseId(expense.id);
                      },
                    },
                  ]}
                />
              }
              detail={isOpen ? renderDetail(expense) : null}
            />
          );
        })}
      </AdminRecordTable>

      <ConfirmDialog
        open={voidExpenseId !== null}
        title='Void expense'
        description='Provide a short reason. Voided expenses cannot be edited as submitted records.'
        confirmLabel='Void expense'
        cancelLabel='Cancel'
        variant='danger'
        confirmLoading={Boolean(voidExpenseId && isVoidingId === voidExpenseId)}
        confirmLoadingLabel='Voiding…'
        onCancel={closeVoidDialog}
        onConfirm={() => void confirmVoid()}
      >
        <div className='space-y-2'>
          <Label htmlFor='void-expense-reason'>Reason</Label>
          <Textarea
            id='void-expense-reason'
            value={voidReason}
            onChange={(event) => {
              setVoidReason(event.target.value);
              setVoidError('');
            }}
            rows={3}
            placeholder='Required'
          />
          {voidError ? <AdminInlineError>{voidError}</AdminInlineError> : null}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteDraftExpenseId !== null}
        title='Delete draft expense'
        description='This permanently removes the draft from the list. You cannot undo this action.'
        confirmLabel='Delete expense'
        cancelLabel='Cancel'
        variant='danger'
        confirmLoading={Boolean(deleteDraftExpenseId && isDeletingDraftId === deleteDraftExpenseId)}
        confirmLoadingLabel='Deleting…'
        onCancel={closeDeleteDraftDialog}
        onConfirm={() => void confirmDeleteDraft()}
      >
        {deleteDraftError ? <AdminInlineError>{deleteDraftError}</AdminInlineError> : null}
      </ConfirmDialog>
    </>
  );
}
