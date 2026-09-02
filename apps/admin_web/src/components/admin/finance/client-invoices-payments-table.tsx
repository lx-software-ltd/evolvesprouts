'use client';

import { Button } from '@/components/ui/button';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { DeleteIcon, MarkPaidIcon } from '@/components/icons/action-icons';
import { formatPaymentMethodLabel } from '@/components/admin/finance/client-invoices-format-helpers';
import { formatEnumLabel } from '@/lib/format';
import { formatAmountInCurrency } from '@/lib/vendor-spend';

import type {
  ClientInvoicesPanelBusy,
  ClientInvoicesPanelCurrency,
  ClientInvoicesPaymentsTableSlice,
} from '@/hooks/client-invoices-panel-types';

export interface ClientInvoicesPaymentsTableProps {
  currency: ClientInvoicesPanelCurrency;
  busy: ClientInvoicesPanelBusy;
  payments: ClientInvoicesPaymentsTableSlice;
}

export function ClientInvoicesPaymentsTable({
  currency,
  busy,
  payments: pay,
}: ClientInvoicesPaymentsTableProps) {
  const { defaultCurrency } = currency;
  const { busyAction, editorBusy } = busy;
  const {
    payments,
    listLoading,
    listLoadingMore,
    listHasMore,
    listError,
    loadMorePayments,
    selectedId,
    setSelectedId,
    setManualPaymentPreferCreateForm,
    exportBusy,
    handleExport,
    openConfirmPaymentDialog,
    openDeletePaymentDialog,
    confirmPaymentId,
    deletePaymentDialogOpen,
    confirmPaymentDialogOpen,
  } = pay;

  return (
    <PaginatedTableCard
      title='Customer payments'
      description='Recent customer payments and refunds. Select a row for allocation and refund source; manual inbound payments without Stripe can be edited in the Customer payment card above. Pending inbound: confirm from Operations. Deletable orphan rows: delete from Operations (see server rules).'
      isLoading={listLoading}
      isLoadingMore={listLoadingMore}
      hasMore={listHasMore}
      error={listError}
      onLoadMore={() => void loadMorePayments()}
      toolbar={
        <AdminTableToolbar className='gap-2'>
          <Button
            type='button'
            variant='outline'
            onClick={() => void handleExport()}
            disabled={exportBusy}
          >
            {exportBusy ? 'Exporting…' : 'Download CSV export (v2)'}
          </Button>
        </AdminTableToolbar>
      }
    >
      <AdminDataTable tableClassName='min-w-[860px]'>
        <AdminDataTableHead>
          <tr>
            <AdminDataTableHeadCell>Direction</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Party</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Status</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Method</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Amount</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Unapplied amount</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        </AdminDataTableHead>
        <AdminDataTableBody>
          {payments.map((p, index) => {
            const id = p.id ?? '';
            const selected = id && selectedId === id;
            const amountRaw = p.amount?.trim() ?? '';
            const parsedPayAmount = Number.parseFloat(amountRaw);
            const payCurrencyCode =
              (p.currency ?? defaultCurrency).trim().toUpperCase() ||
              defaultCurrency;
            const amountDisplay =
              amountRaw !== '' && Number.isFinite(parsedPayAmount)
                ? formatAmountInCurrency(parsedPayAmount, payCurrencyCode)
                : '—';
            const unappliedRaw = p.unappliedAmount?.trim() ?? '';
            const parsedUnapplied = Number.parseFloat(unappliedRaw);
            const unappliedDisplay =
              unappliedRaw !== '' && Number.isFinite(parsedUnapplied)
                ? formatAmountInCurrency(parsedUnapplied, payCurrencyCode)
                : '—';
            const partyRaw = (p.party ?? '').trim();
            const partyDisplay = partyRaw !== '' ? partyRaw : '—';
            return (
              <tr
                key={id || `payment-row-${String(index)}`}
                className={
                  selected
                    ? 'cursor-pointer bg-sky-50'
                    : id
                      ? 'cursor-pointer'
                      : undefined
                }
                onClick={() => {
                  if (!id) {
                    return;
                  }
                  setSelectedId(id);
                  if (selectedId === id) {
                    setManualPaymentPreferCreateForm(false);
                  }
                }}
              >
                <AdminDataTableCell>
                  {formatEnumLabel(p.direction ?? '')}
                </AdminDataTableCell>
                <AdminDataTableCell
                  className='max-w-[14rem] truncate'
                  title={partyDisplay}
                >
                  {partyDisplay}
                </AdminDataTableCell>
                <AdminDataTableCell>
                  {formatEnumLabel(p.status ?? '')}
                </AdminDataTableCell>
                <AdminDataTableCell>
                  {formatPaymentMethodLabel(p.method)}
                </AdminDataTableCell>
                <AdminDataTableCell>{amountDisplay}</AdminDataTableCell>
                <AdminDataTableCell>{unappliedDisplay}</AdminDataTableCell>
                <AdminDataTableCell
                  className='text-right'
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <div className='flex flex-wrap justify-end gap-1'>
                    {p.status === 'pending' && p.direction === 'inbound' ? (
                      <Button
                        type='button'
                        size='sm'
                        variant='secondary'
                        disabled={
                          editorBusy ||
                          deletePaymentDialogOpen ||
                          busyAction === 'confirm'
                        }
                        onClick={() => openConfirmPaymentDialog(id)}
                        aria-label='Confirm pending payment'
                        title='Confirm pending payment'
                        aria-busy={
                          busyAction === 'confirm' && confirmPaymentId === id
                        }
                      >
                        {busyAction === 'confirm' && confirmPaymentId === id ? (
                          <span
                            className='inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-600 border-t-transparent'
                            aria-hidden
                          />
                        ) : (
                          <MarkPaidIcon className='h-4 w-4' aria-hidden />
                        )}
                      </Button>
                    ) : null}
                    {p.orphanPaymentDeletable ? (
                      <Button
                        type='button'
                        size='sm'
                        variant='danger'
                        disabled={editorBusy || deletePaymentDialogOpen || !id}
                        onClick={() => openDeletePaymentDialog(id)}
                        aria-label='Delete customer payment'
                        title='Delete customer payment'
                      >
                        <DeleteIcon className='h-4 w-4' aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </AdminDataTableCell>
              </tr>
            );
          })}
        </AdminDataTableBody>
      </AdminDataTable>
    </PaginatedTableCard>
  );
}
