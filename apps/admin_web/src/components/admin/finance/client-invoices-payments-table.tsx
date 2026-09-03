'use client';

import { DeleteIcon, MarkPaidIcon } from '@/components/icons/action-icons';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminDiscardChangesDialog } from '@/components/ui/admin-discard-changes-dialog';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminFilterBar } from '@/components/ui/admin-filter-bar';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { Button } from '@/components/ui/button';
import { formatPaymentMethodLabel } from '@/components/admin/finance/client-invoices-format-helpers';
import { ClientInvoicesManualPaymentEditor } from '@/components/admin/finance/client-invoices-manual-payment-editor';
import { ClientInvoicesPaymentDetail } from '@/components/admin/finance/client-invoices-payment-detail';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { formatEnumLabel } from '@/lib/format';
import { formatAmountInCurrency } from '@/lib/vendor-spend';

import type {
  ClientInvoicesAllocateEditorSlice,
  ClientInvoicesManualPaymentEditorSlice,
  ClientInvoicesPanelBusy,
  ClientInvoicesPanelCurrency,
  ClientInvoicesPaymentsTableSlice,
} from '@/hooks/client-invoices-panel-types';

const COLUMN_COUNT = 8;

export interface ClientInvoicesPaymentsTableProps {
  currency: ClientInvoicesPanelCurrency;
  busy: ClientInvoicesPanelBusy;
  payments: ClientInvoicesPaymentsTableSlice;
  manualPayment: ClientInvoicesManualPaymentEditorSlice;
  allocate: ClientInvoicesAllocateEditorSlice;
}

function formatMoney(value: string | null | undefined, currencyCode: string): string {
  const raw = value?.trim() ?? '';
  const parsed = Number.parseFloat(raw);
  return raw !== '' && Number.isFinite(parsed) ? formatAmountInCurrency(parsed, currencyCode) : '—';
}

export function ClientInvoicesPaymentsTable({
  currency,
  busy,
  payments: pay,
  manualPayment,
  allocate,
}: ClientInvoicesPaymentsTableProps) {
  const { defaultCurrency } = currency;
  const { busyAction, editorBusy } = busy;
  const {
    expanded,
    payments,
    listLoading,
    listLoadingMore,
    listHasMore,
    listError,
    loadMorePayments,
    exportBusy,
    handleExport,
    openConfirmPaymentDialog,
    openDeletePaymentDialog,
    confirmPaymentId,
    deletePaymentDialogOpen,
    confirmPaymentDialogOpen,
  } = pay;

  const actionsBlocked = editorBusy || deletePaymentDialogOpen || confirmPaymentDialogOpen;

  return (
    <>
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AdminRecordTable
        aria-label='Customer payments'
        columnCount={COLUMN_COUNT}
        rowCount={payments.length}
        isLoading={listLoading}
        isLoadingMore={listLoadingMore}
        hasMore={listHasMore}
        onLoadMore={() => void loadMorePayments()}
        error={listError}
        errorTitle='Customer payments'
        emptyLabel='No customer payments yet.'
        filters={
          <AdminFilterBar
            trailing={
              <>
                <Button
                  type='button'
                  variant='outline'
                  className='h-10 flex-1 sm:h-9 sm:flex-none'
                  onClick={() => void handleExport()}
                  disabled={exportBusy}
                  loading={exportBusy}
                  loadingLabel='Exporting…'
                >
                  Download CSV export (v2)
                </Button>
                <AdminCreateButton
                  label='New payment'
                  active={expanded.isDraftOpen}
                  disabled={editorBusy}
                  onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
                />
              </>
            }
          />
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Party</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Direction</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Status</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Method</AdminDataTableHeadCell>
            <AdminDataTableHeadCell className='text-right'>Amount</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary' className='text-right'>
              Unapplied
            </AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new payment'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New payment</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  Inbound
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell className='text-right text-slate-400'>—</AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-right text-slate-400'>
                  —
                </AdminDataTableCell>
              </>
            }
            actions={null}
            detail={<ClientInvoicesManualPaymentEditor currency={currency} busy={busy} manualPayment={manualPayment} />}
          />
        ) : null}
        {payments.map((p, index) => {
          const id = p.id ?? '';
          const rowKey = id || `payment-row-${String(index)}`;
          const isOpen = id !== '' && expanded.isExpanded(id);
          const payCurrencyCode = (p.currency ?? defaultCurrency).trim().toUpperCase() || defaultCurrency;
          const amountDisplay = formatMoney(p.amount, payCurrencyCode);
          const unappliedDisplay = formatMoney(p.unappliedAmount, payCurrencyCode);
          const partyDisplay = (p.party ?? '').trim() || '—';
          const directionLabel = formatEnumLabel(p.direction ?? '');
          const statusLabel = formatEnumLabel(p.status ?? '');
          const methodLabel = formatPaymentMethodLabel(p.method);
          const confirming = busyAction === 'confirm' && confirmPaymentId === id;
          return (
            <AdminExpandableRow
              key={rowKey}
              id={id || rowKey}
              label={`${directionLabel} payment ${partyDisplay}`}
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
                    <p className='font-medium text-slate-900 wrap-anywhere'>{partyDisplay}</p>
                    <AdminDataTableCellMeta>
                      {directionLabel} · {statusLabel}
                    </AdminDataTableCellMeta>
                    <AdminDataTableCellMeta until='tertiary'>{methodLabel}</AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary'>{directionLabel}</AdminDataTableCell>
                  <AdminDataTableCell priority='secondary'>{statusLabel}</AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary'>{methodLabel}</AdminDataTableCell>
                  <AdminDataTableCell className='text-right tabular-nums'>
                    <span className='block'>{amountDisplay}</span>
                    <AdminDataTableCellMeta until='tertiary'>Unapplied {unappliedDisplay}</AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-right tabular-nums'>
                    {unappliedDisplay}
                  </AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'confirm',
                      label: confirming ? 'Confirming payment' : 'Confirm pending payment',
                      icon: <MarkPaidIcon className='h-4 w-4' />,
                      tone: 'success',
                      hidden: !(p.status === 'pending' && p.direction === 'inbound'),
                      disabled: actionsBlocked || !id,
                      onClick: () => openConfirmPaymentDialog(id),
                    },
                    {
                      key: 'delete',
                      label: 'Delete customer payment',
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      hidden: !p.orphanPaymentDeletable,
                      disabled: actionsBlocked || !id,
                      onClick: () => openDeletePaymentDialog(id),
                    },
                  ]}
                />
              }
              detail={
                isOpen ? (
                  <ClientInvoicesPaymentDetail
                    payment={p}
                    currency={currency}
                    busy={busy}
                    manualPayment={manualPayment}
                    payments={pay}
                    allocate={allocate}
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
