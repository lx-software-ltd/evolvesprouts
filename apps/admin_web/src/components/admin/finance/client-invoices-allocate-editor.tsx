'use client';

import { Button } from '@/components/ui/button';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatTruncatedId } from '@/components/admin/finance/client-invoices-format-helpers';
import { ALLOCATE_FORM_ID, formatAllocateLineOptionLabel } from '@/components/admin/finance/client-invoices-utils';

import type {
  ClientInvoicesAllocateEditorSlice,
  ClientInvoicesPanelBusy,
  ClientInvoicesPanelCurrency,
} from '@/hooks/client-invoices-panel-types';

export interface ClientInvoicesAllocateEditorProps {
  currency: ClientInvoicesPanelCurrency;
  busy: ClientInvoicesPanelBusy;
  allocate: ClientInvoicesAllocateEditorSlice;
}

/**
 * "Allocate to invoice" sub-accordion of an expanded payment row. The
 * expanded payment is the allocation source; an issued invoice expanded in
 * the invoices table above pre-fills the target.
 */
export function ClientInvoicesAllocateEditor({ currency, busy, allocate }: ClientInvoicesAllocateEditorProps) {
  const { currencyOptions } = currency;
  const { busyAction, editorBusy } = busy;
  const {
    allocateInvoiceId,
    setAllocateInvoiceId,
    allocateLineId,
    setAllocateLineId,
    allocateAmount,
    setAllocateAmount,
    allocateCurrency,
    setAllocateCurrency,
    allocateInvoiceLinesLoading,
    allocateInvoiceLinesError,
    allocateLinesOrdered,
    allocateLineDescriptionCounts,
    issuedInvoicesForAllocate,
    handleAllocate,
    invoices,
  } = allocate;

  const invoiceSelectValue = issuedInvoicesForAllocate.some((i) => i.id === allocateInvoiceId)
    ? allocateInvoiceId
    : '';
  const targetIsIssued = invoices.find((i) => i.id === allocateInvoiceId.trim())?.status === 'issued';
  const lineSelectValue =
    allocateLineId !== '' && allocateLinesOrdered.some((l) => l.id === allocateLineId) ? allocateLineId : '';
  const summary =
    invoiceSelectValue === ''
      ? `${issuedInvoicesForAllocate.length} issued invoice${issuedInvoicesForAllocate.length === 1 ? '' : 's'}`
      : (issuedInvoicesForAllocate.find((i) => i.id === invoiceSelectValue)?.invoiceNumber ?? 'Invoice selected');

  return (
    <AdminDisclosure id='billing-allocate' title='Allocate to invoice' summary={summary} defaultOpen>
      <form id={ALLOCATE_FORM_ID} className='space-y-4' onSubmit={(e) => void handleAllocate(e)}>
        <AdminFieldGrid columns={4}>
          <AdminField
            label='Issued invoice'
            htmlFor='billing-allocate-invoice'
            hint={
              issuedInvoicesForAllocate.length === 0
                ? 'No issued invoices in the list; widen the invoice filters or load more.'
                : undefined
            }
          >
            <Select
              id='billing-allocate-invoice'
              className='mt-1 w-full min-w-0'
              value={invoiceSelectValue}
              onChange={(e) => {
                setAllocateInvoiceId(e.target.value);
                setAllocateLineId('');
              }}
              disabled={editorBusy}
            >
              <option value=''>Select invoice…</option>
              {issuedInvoicesForAllocate.map((invOpt) => {
                const oid = invOpt.id ?? '';
                const num = invOpt.invoiceNumber?.trim() ?? '';
                return (
                  <option key={oid || 'invoice-option'} value={oid}>
                    {num !== '' ? num : formatTruncatedId(oid)}
                  </option>
                );
              })}
            </Select>
          </AdminField>
          <AdminField
            label='Invoice line (optional)'
            htmlFor='billing-allocate-line'
            hint={allocateInvoiceLinesLoading ? 'Loading invoice lines…' : undefined}
            error={allocateInvoiceLinesError || undefined}
          >
            <Select
              id='billing-allocate-line'
              className='mt-1 w-full min-w-0'
              value={lineSelectValue}
              onChange={(e) => setAllocateLineId(e.target.value)}
              disabled={editorBusy || allocateInvoiceId.trim() === '' || !targetIsIssued || allocateInvoiceLinesLoading}
            >
              <option value=''>Whole invoice (no specific line)</option>
              {allocateLinesOrdered
                .map((line, idx) => ({ line, idx }))
                .filter(({ line }) => (line.id?.trim() ?? '') !== '')
                .map(({ line, idx }) => {
                  const lid = line.id?.trim() ?? '';
                  return (
                    <option key={lid} value={lid}>
                      {formatAllocateLineOptionLabel(line, idx, allocateLineDescriptionCounts)}
                    </option>
                  );
                })}
            </Select>
          </AdminField>
          <AdminField label='Amount' htmlFor='billing-allocate-amount'>
            <Input
              id='billing-allocate-amount'
              value={allocateAmount}
              onChange={(e) => setAllocateAmount(e.target.value)}
              className='mt-1 w-full min-w-0 tabular-nums'
              inputMode='decimal'
              disabled={editorBusy}
            />
          </AdminField>
          <AdminField label='Currency' htmlFor='billing-allocate-currency'>
            <Select
              id='billing-allocate-currency'
              className='mt-1 w-full min-w-0'
              value={allocateCurrency}
              onChange={(e) => setAllocateCurrency(e.target.value)}
              disabled={editorBusy}
            >
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </AdminField>
        </AdminFieldGrid>
        <div className='flex justify-start'>
          <Button
            type='submit'
            variant='secondary'
            disabled={editorBusy}
            loading={busyAction === 'allocate'}
            loadingLabel='Allocating…'
          >
            Create allocation
          </Button>
        </div>
      </form>
    </AdminDisclosure>
  );
}
