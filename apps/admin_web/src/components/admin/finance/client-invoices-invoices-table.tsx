'use client';

import { CheckIcon, DeleteIcon, ViewIcon, VoidExpenseIcon } from '@/components/icons/action-icons';
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
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ClientInvoicesDraftEditor } from '@/components/admin/finance/client-invoices-draft-editor';
import { ClientInvoicesInvoiceDetail } from '@/components/admin/finance/client-invoices-invoice-detail';
import type {
  InvoiceSettlementFilter,
  InvoiceStatusFilter,
} from '@/hooks/use-client-invoices-invoice-list';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { getInvoiceSettlementBadgeLabel } from '@/lib/invoice-settlement-display';
import { formatDateOnly, formatYmdAsLocalDate } from '@/lib/format';
import { formatAmountInCurrency } from '@/lib/vendor-spend';

import type {
  ClientInvoicesDraftEditorSlice,
  ClientInvoicesInvoicesTableSlice,
  ClientInvoicesPanelBusy,
  ClientInvoicesPanelCurrency,
  ClientInvoicesPanelIds,
  ClientInvoicesRefundEditorSlice,
} from '@/hooks/client-invoices-panel-types';

const COLUMN_COUNT = 7;

export interface ClientInvoicesInvoicesTableProps {
  ids: ClientInvoicesPanelIds;
  currency: ClientInvoicesPanelCurrency;
  busy: ClientInvoicesPanelBusy;
  invoices: ClientInvoicesInvoicesTableSlice;
  draft: ClientInvoicesDraftEditorSlice;
  refund: ClientInvoicesRefundEditorSlice;
}

/**
 * Table-first customer invoices: filters and New invoice on top, the draft
 * creation editor in the draft row, and each invoice expanding into its
 * detail (email, refund). Row operations live in the Operations column.
 */
export function ClientInvoicesInvoicesTable({
  ids,
  currency,
  busy,
  invoices: inv,
  draft,
  refund,
}: ClientInvoicesInvoicesTableProps) {
  const { invoiceSearchFilterId, invoiceSettlementFilterId } = ids;
  const { currencyOptions, defaultCurrency } = currency;
  const { busyAction, editorBusy } = busy;
  const {
    expanded,
    invoices,
    invoiceListLoading,
    invoiceListLoadingMore,
    invoiceListError,
    invoiceListHasMore,
    invoiceStatusFilter,
    setInvoiceStatusFilter,
    invoiceSettlementFilter,
    setInvoiceSettlementFilter,
    invoiceCurrencyFilter,
    setInvoiceCurrencyFilter,
    invoiceSearchInput,
    setInvoiceSearchInput,
    loadMoreInvoices,
    handleOpenInvoicePdfPreview,
    handleIssueRow,
    openVoidInvoiceDialog,
    openDeleteDraftInvoiceDialog,
    deleteDraftDialogOpen,
    voidDialogOpen,
  } = inv;

  const actionsBlocked = editorBusy || deleteDraftDialogOpen || voidDialogOpen;

  return (
    <>
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AdminRecordTable
        aria-label='Customer invoices'
        columnCount={COLUMN_COUNT}
        rowCount={invoices.length}
        isLoading={invoiceListLoading}
        isLoadingMore={invoiceListLoadingMore}
        hasMore={invoiceListHasMore}
        onLoadMore={() => void loadMoreInvoices()}
        error={invoiceListError}
        errorTitle='Customer invoices'
        emptyLabel='No invoices match the current filters.'
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='New invoice'
                active={expanded.isDraftOpen}
                disabled={editorBusy}
                onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
              />
            }
          >
            <AdminFilterField label='Filter invoices' htmlFor={invoiceSearchFilterId} className='sm:basis-72'>
              <Input
                id={invoiceSearchFilterId}
                value={invoiceSearchInput}
                onChange={(e) => setInvoiceSearchInput(e.target.value)}
                placeholder='Search invoice number, bill to, invoice date…'
                autoComplete='off'
              />
            </AdminFilterField>
            <AdminFilterField label='Status' htmlFor='billing-invoice-status-filter' className='sm:basis-40'>
              <Select
                id='billing-invoice-status-filter'
                value={invoiceStatusFilter}
                onChange={(e) => setInvoiceStatusFilter(e.target.value as InvoiceStatusFilter)}
              >
                <option value=''>All</option>
                <option value='draft'>Draft</option>
                <option value='issued'>Issued</option>
                <option value='void'>Void</option>
              </Select>
            </AdminFilterField>
            <AdminFilterField label='Settlement' htmlFor={invoiceSettlementFilterId} className='sm:basis-44'>
              <Select
                id={invoiceSettlementFilterId}
                value={invoiceSettlementFilter}
                onChange={(e) => setInvoiceSettlementFilter(e.target.value as InvoiceSettlementFilter)}
              >
                <option value='not_completed'>Not completed</option>
                <option value=''>All</option>
                <option value='open'>Open</option>
                <option value='partially_paid'>Partially paid</option>
                <option value='paid'>Paid</option>
                <option value='no_charge'>No charge</option>
              </Select>
            </AdminFilterField>
            <AdminFilterField label='Currency' htmlFor='billing-invoice-currency-filter' className='sm:basis-44'>
              <Select
                id='billing-invoice-currency-filter'
                value={invoiceCurrencyFilter}
                onChange={(e) => setInvoiceCurrencyFilter(e.target.value)}
              >
                <option value=''>All currencies</option>
                {currencyOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Number</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Settlement</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Bill to</AdminDataTableHeadCell>
            <AdminDataTableHeadCell className='text-right'>Total</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Invoice date</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new invoice'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New invoice</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell className='text-right text-slate-400'>—</AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
              </>
            }
            actions={null}
            detail={<ClientInvoicesDraftEditor ids={ids} currency={currency} busy={busy} draft={draft} />}
          />
        ) : null}
        {invoices.map((invoice, index) => {
          const id = invoice.id ?? '';
          const rowKey = id || `invoice-row-${String(index)}`;
          const isOpen = id !== '' && expanded.isExpanded(id);
          const totalRaw = invoice.total?.trim() ?? '';
          const parsedTotal = Number.parseFloat(totalRaw);
          const balanceDueRaw = invoice.balanceDue?.trim() ?? '';
          const parsedBalanceDue = Number.parseFloat(balanceDueRaw);
          const currencyCode = (invoice.currency ?? defaultCurrency).trim().toUpperCase() || defaultCurrency;
          const totalDisplay =
            totalRaw !== '' && Number.isFinite(parsedTotal) ? formatAmountInCurrency(parsedTotal, currencyCode) : '—';
          const dueDisplay =
            balanceDueRaw !== '' && Number.isFinite(parsedBalanceDue) && parsedBalanceDue > 0
              ? `Due ${formatAmountInCurrency(parsedBalanceDue, currencyCode)}`
              : null;
          const settlementLabel = getInvoiceSettlementBadgeLabel(invoice);
          const billToLabel = invoice.billToDisplayName ?? invoice.billToEmail ?? '—';
          const dateLabel = invoice.invoiceDate
            ? formatYmdAsLocalDate(invoice.invoiceDate)
            : formatDateOnly(invoice.createdAt ?? null);
          const numberLabel = invoice.invoiceNumber ?? (invoice.status === 'draft' ? 'Draft' : '—');
          const label = invoice.invoiceNumber ?? `${invoice.status ?? 'invoice'} ${id.slice(0, 8)}`;
          return (
            <AdminExpandableRow
              key={rowKey}
              id={id || rowKey}
              label={label}
              expanded={isOpen}
              onToggle={() => {
                if (id) {
                  expanded.toggle(id);
                }
              }}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell>
                    <p className='font-medium text-slate-900'>{numberLabel}</p>
                    <AdminDataTableCellMeta>
                      {settlementLabel} · {billToLabel}
                    </AdminDataTableCellMeta>
                    <AdminDataTableCellMeta until='tertiary'>{dateLabel}</AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary'>{settlementLabel}</AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {billToLabel}
                  </AdminDataTableCell>
                  <AdminDataTableCell className='text-right tabular-nums'>
                    <span className='block'>{totalDisplay}</span>
                    {dueDisplay ? <span className='block text-xs text-slate-500'>{dueDisplay}</span> : null}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary'>{dateLabel}</AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'preview',
                      label: busyAction === 'pdf' ? 'Opening invoice PDF' : 'Preview invoice PDF',
                      icon: <ViewIcon className='h-4 w-4' />,
                      disabled: actionsBlocked || !id,
                      onClick: () => void handleOpenInvoicePdfPreview(id),
                    },
                    {
                      key: 'issue',
                      label: busyAction === 'issue' ? 'Issuing invoice' : 'Issue invoice',
                      icon: <CheckIcon className='h-4 w-4' />,
                      tone: 'success',
                      hidden: invoice.status !== 'draft',
                      disabled: actionsBlocked || !id,
                      onClick: () => void handleIssueRow(id),
                    },
                    {
                      key: 'void',
                      label: 'Void invoice',
                      icon: <VoidExpenseIcon className='h-4 w-4' />,
                      tone: 'danger',
                      hidden: invoice.status === 'void',
                      disabled: actionsBlocked || !id,
                      onClick: () => openVoidInvoiceDialog(id),
                    },
                    {
                      key: 'delete-draft',
                      label: busyAction === 'delete-draft' ? 'Deleting draft invoice' : 'Delete draft invoice',
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      hidden: invoice.status !== 'draft',
                      disabled: actionsBlocked || !id,
                      onClick: () => openDeleteDraftInvoiceDialog(id),
                    },
                  ]}
                />
              }
              detail={
                isOpen ? (
                  <ClientInvoicesInvoiceDetail
                    invoice={invoice}
                    currency={currency}
                    busy={busy}
                    invoices={inv}
                    refund={refund}
                  />
                ) : null
              }
            />
          );
        })}
      </AdminRecordTable>
    </>
  );
}
