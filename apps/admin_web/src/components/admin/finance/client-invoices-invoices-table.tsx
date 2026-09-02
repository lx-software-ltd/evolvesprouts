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
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { Select } from '@/components/ui/select';
import {
  CheckIcon,
  DeleteIcon,
  ViewIcon,
  VoidExpenseIcon,
} from '@/components/icons/action-icons';
import { getInvoiceSettlementBadgeLabel } from '@/lib/invoice-settlement-display';
import { formatDateOnly, formatYmdAsLocalDate } from '@/lib/format';
import { formatAmountInCurrency } from '@/lib/vendor-spend';

import type {
  ClientInvoicesInvoicesTableSlice,
  ClientInvoicesPanelBusy,
  ClientInvoicesPanelCurrency,
  ClientInvoicesPanelIds,
} from '@/hooks/client-invoices-panel-types';

export interface ClientInvoicesInvoicesTableProps {
  ids: ClientInvoicesPanelIds;
  currency: ClientInvoicesPanelCurrency;
  busy: ClientInvoicesPanelBusy;
  invoices: ClientInvoicesInvoicesTableSlice;
}

export function ClientInvoicesInvoicesTable({
  ids,
  currency,
  busy,
  invoices: inv,
}: ClientInvoicesInvoicesTableProps) {
  const { invoiceSearchFilterId, invoiceSettlementFilterId } = ids;
  const { currencyOptions, defaultCurrency } = currency;
  const { busyAction, editorBusy } = busy;
  const {
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
    selectedInvoiceId,
    setSelectedInvoiceId,
    selectedIssuedInvoice,
    issuedInvoiceEmailCsv,
    setIssuedInvoiceEmailCsv,
    issuedInvoiceEmailError,
    setIssuedInvoiceEmailError,
    issuedInvoiceEmailDirtyRef,
    handleEmailIssuedInvoice,
    loadMoreInvoices,
    handleOpenInvoicePdfPreview,
    handleIssueRow,
    openVoidInvoiceDialog,
    openDeleteDraftInvoiceDialog,
    deleteDraftDialogOpen,
    voidDialogOpen,
    setAllocateInvoiceId,
    setAllocateLineId,
  } = inv;

  return (
    <PaginatedTableCard
      title='Customer invoices'
      description='Cursor-paginated invoices, ordered by record creation time (most recent first); the displayed Invoice date may differ from creation order when drafts are backdated. Use Operations to preview, issue, void, or permanently delete **draft** rows. Select an issued row to pre-fill allocation; when the selection is issued, use Email recipients and Send email below.'
      isLoading={invoiceListLoading}
      isLoadingMore={invoiceListLoadingMore}
      hasMore={invoiceListHasMore}
      error={invoiceListError}
      onLoadMore={() => void loadMoreInvoices()}
      toolbar={
        <div className='mb-3 flex flex-wrap items-end gap-4'>
          <div className='min-w-[min(100%,16rem)] flex-1 basis-[14rem]'>
            <Label htmlFor={invoiceSearchFilterId}>Filter invoices</Label>
            <Input
              id={invoiceSearchFilterId}
              className='mt-1'
              value={invoiceSearchInput}
              onChange={(e) => setInvoiceSearchInput(e.target.value)}
              placeholder='Search invoice number, bill to, invoice date…'
              disabled={editorBusy}
              autoComplete='off'
            />
          </div>
          <div>
            <Label htmlFor='billing-invoice-status-filter'>Status</Label>
            <Select
              id='billing-invoice-status-filter'
              className='mt-1 w-44'
              value={invoiceStatusFilter}
              onChange={(e) =>
                setInvoiceStatusFilter(
                  e.target.value === ''
                    ? ''
                    : (e.target.value as 'draft' | 'issued' | 'void'),
                )
              }
            >
              <option value=''>All</option>
              <option value='draft'>Draft</option>
              <option value='issued'>Issued</option>
              <option value='void'>Void</option>
            </Select>
          </div>
          <div>
            <Label htmlFor={invoiceSettlementFilterId}>Settlement</Label>
            <Select
              id={invoiceSettlementFilterId}
              className='mt-1 w-44'
              value={invoiceSettlementFilter}
              onChange={(e) =>
                setInvoiceSettlementFilter(
                  e.target.value === ''
                    ? ''
                    : (e.target.value as
                        | 'not_completed'
                        | 'open'
                        | 'partially_paid'
                        | 'paid'
                        | 'no_charge'),
                )
              }
            >
              <option value='not_completed'>Not completed</option>
              <option value=''>All</option>
              <option value='open'>Open</option>
              <option value='partially_paid'>Partially paid</option>
              <option value='paid'>Paid</option>
              <option value='no_charge'>No charge</option>
            </Select>
          </div>
          <div>
            <Label htmlFor='billing-invoice-currency-filter'>Currency</Label>
            <Select
              id='billing-invoice-currency-filter'
              className='mt-1 w-44'
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
          </div>
          {selectedIssuedInvoice?.status === 'issued' ? (
            <div className='ml-auto flex min-w-[min(100%,20rem)] max-w-xl flex-1 flex-col gap-1 sm:min-w-[18rem]'>
              <Label htmlFor='billing-issued-invoice-emails'>
                Email recipients (comma-separated)
              </Label>
              <div className='flex flex-wrap items-end gap-2'>
                <Input
                  id='billing-issued-invoice-emails'
                  className='min-w-0 flex-1 font-mono text-sm'
                  autoComplete='off'
                  value={issuedInvoiceEmailCsv}
                  onChange={(e) => {
                    issuedInvoiceEmailDirtyRef.current = true;
                    setIssuedInvoiceEmailCsv(e.target.value);
                    setIssuedInvoiceEmailError('');
                  }}
                  disabled={editorBusy}
                  placeholder='billing@example.com, accounts@example.com'
                />
                <Button
                  type='button'
                  size='sm'
                  variant='secondary'
                  disabled={editorBusy || busyAction === 'email'}
                  onClick={() => void handleEmailIssuedInvoice()}
                >
                  {busyAction === 'email' ? 'Sending…' : 'Send email'}
                </Button>
              </div>
              {issuedInvoiceEmailError ? (
                <AdminInlineError>{issuedInvoiceEmailError}</AdminInlineError>
              ) : null}
            </div>
          ) : null}
        </div>
      }
    >
      <section aria-label='Customer invoices list'>
        <AdminDataTable tableClassName='min-w-[900px]'>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Settlement</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Number</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Bill to</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Total</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Lines</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Invoice date</AdminDataTableHeadCell>
              <AdminDataTableOperationsHeadCell />
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {invoices.map((inv, index) => {
              const id = inv.id ?? '';
              const selected = id && selectedInvoiceId === id;
              const totalRaw = inv.total?.trim() ?? '';
              const parsedTotal = Number.parseFloat(totalRaw);
              const balanceDueRaw = inv.balanceDue?.trim() ?? '';
              const parsedBalanceDue = Number.parseFloat(balanceDueRaw);
              const currencyCode =
                (inv.currency ?? defaultCurrency).trim().toUpperCase() ||
                defaultCurrency;
              const totalDisplay =
                totalRaw !== '' && Number.isFinite(parsedTotal)
                  ? formatAmountInCurrency(parsedTotal, currencyCode)
                  : '—';
              const balanceDueLine =
                balanceDueRaw !== '' &&
                Number.isFinite(parsedBalanceDue) &&
                parsedBalanceDue > 0 ? (
                  <span className='text-xs text-slate-600'>
                    Due {formatAmountInCurrency(parsedBalanceDue, currencyCode)}
                  </span>
                ) : null;
              return (
                <tr
                  key={id || `invoice-row-${String(index)}`}
                  className={
                    selected
                      ? 'cursor-pointer bg-sky-50'
                      : id
                        ? 'cursor-pointer'
                        : undefined
                  }
                  onClick={() => {
                    setSelectedInvoiceId(id || null);
                    if (id && inv.status === 'issued') {
                      setAllocateInvoiceId(id);
                      setAllocateLineId('');
                    }
                  }}
                >
                  <AdminDataTableCell>
                    {getInvoiceSettlementBadgeLabel(inv)}
                  </AdminDataTableCell>
                  <AdminDataTableCell>
                    {inv.invoiceNumber ?? '—'}
                  </AdminDataTableCell>
                  <AdminDataTableCell className='text-slate-700'>
                    {inv.billToDisplayName ?? inv.billToEmail ?? '—'}
                  </AdminDataTableCell>
                  <AdminDataTableCell>
                    <div className='flex flex-col gap-0.5'>
                      <span>{totalDisplay}</span>
                      {balanceDueLine}
                    </div>
                  </AdminDataTableCell>
                  <AdminDataTableCell>{inv.lineCount ?? 0}</AdminDataTableCell>
                  <AdminDataTableCell>
                    {inv.invoiceDate
                      ? formatYmdAsLocalDate(inv.invoiceDate)
                      : formatDateOnly(inv.createdAt ?? null)}
                  </AdminDataTableCell>
                  <AdminDataTableCell
                    className='text-right'
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <div className='flex flex-wrap justify-end gap-1'>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        disabled={
                          editorBusy ||
                          deleteDraftDialogOpen ||
                          voidDialogOpen ||
                          !id
                        }
                        onClick={() => void handleOpenInvoicePdfPreview(id)}
                        aria-label='Preview invoice PDF'
                        title='Preview invoice PDF'
                        aria-busy={busyAction === 'pdf'}
                      >
                        {busyAction === 'pdf' ? (
                          <span
                            className='inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-600 border-t-transparent'
                            aria-hidden
                          />
                        ) : (
                          <ViewIcon className='h-4 w-4' aria-hidden />
                        )}
                      </Button>
                      {inv.status === 'draft' ? (
                        <Button
                          type='button'
                          size='sm'
                          variant='secondary'
                          disabled={
                            editorBusy ||
                            deleteDraftDialogOpen ||
                            voidDialogOpen ||
                            !id
                          }
                          onClick={() => void handleIssueRow(id)}
                          aria-label='Issue invoice'
                          title='Issue invoice'
                          aria-busy={busyAction === 'issue'}
                        >
                          {busyAction === 'issue' ? (
                            <span
                              className='inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-600 border-t-transparent'
                              aria-hidden
                            />
                          ) : (
                            <CheckIcon className='h-4 w-4' aria-hidden />
                          )}
                        </Button>
                      ) : null}
                      {inv.status !== 'void' ? (
                        <Button
                          type='button'
                          size='sm'
                          variant='danger'
                          disabled={
                            editorBusy ||
                            deleteDraftDialogOpen ||
                            voidDialogOpen ||
                            !id
                          }
                          onClick={() => openVoidInvoiceDialog(id)}
                          aria-label='Void invoice'
                          title='Void invoice'
                        >
                          <VoidExpenseIcon className='h-4 w-4' aria-hidden />
                        </Button>
                      ) : null}
                      {inv.status === 'draft' ? (
                        <Button
                          type='button'
                          size='sm'
                          variant='danger'
                          disabled={
                            editorBusy ||
                            deleteDraftDialogOpen ||
                            voidDialogOpen ||
                            !id
                          }
                          onClick={() => openDeleteDraftInvoiceDialog(id)}
                          aria-label='Delete draft invoice'
                          title='Delete draft invoice'
                          aria-busy={busyAction === 'delete-draft'}
                        >
                          {busyAction === 'delete-draft' ? (
                            <span
                              className='inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-600 border-t-transparent'
                              aria-hidden
                            />
                          ) : (
                            <DeleteIcon className='h-4 w-4' aria-hidden />
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </AdminDataTableCell>
                </tr>
              );
            })}
          </AdminDataTableBody>
        </AdminDataTable>
      </section>
    </PaginatedTableCard>
  );
}
