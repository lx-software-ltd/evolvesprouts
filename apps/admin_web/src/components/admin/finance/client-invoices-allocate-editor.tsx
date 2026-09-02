'use client';

import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatTruncatedId } from '@/components/admin/finance/client-invoices-format-helpers';
import {
  ALLOCATE_FORM_ID,
  formatAllocateLineOptionLabel,
} from '@/components/admin/finance/client-invoices-utils';

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

export function ClientInvoicesAllocateEditor({
  currency,
  busy,
  allocate,
}: ClientInvoicesAllocateEditorProps) {
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

  return (
    <AdminEditorCard
      title='Allocate selected payment to invoice'
      description='Select a payment row in the Customer payments table above first. Choose an issued invoice and optionally a line; use Load more on the invoice list if the invoice is not shown.'
      actions={
        <Button type='submit' form={ALLOCATE_FORM_ID} disabled={editorBusy}>
          {busyAction === 'allocate' ? 'Allocating…' : 'Create allocation'}
        </Button>
      }
    >
      <form
        id={ALLOCATE_FORM_ID}
        className='flex max-w-full flex-col gap-3'
        onSubmit={(e) => void handleAllocate(e)}
      >
        <div className='grid gap-3 min-[780px]:grid-cols-4 min-[780px]:items-end'>
          <div className='min-w-0'>
            <Label htmlFor='billing-allocate-invoice'>Issued invoice</Label>
            <Select
              id='billing-allocate-invoice'
              className='mt-1 w-full min-w-0 max-w-xl min-[780px]:max-w-none'
              value={
                issuedInvoicesForAllocate.some(
                  (i) => i.id === allocateInvoiceId,
                )
                  ? allocateInvoiceId
                  : ''
              }
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
                const label = num !== '' ? num : formatTruncatedId(oid);
                return (
                  <option key={oid || 'invoice-option'} value={oid}>
                    {label}
                  </option>
                );
              })}
            </Select>
          </div>
          <div className='min-w-0'>
            <Label htmlFor='billing-allocate-line'>
              Invoice line (optional)
            </Label>
            <Select
              id='billing-allocate-line'
              className='mt-1 w-full min-w-0 max-w-xl min-[780px]:max-w-none'
              value={
                allocateLineId === ''
                  ? ''
                  : allocateLinesOrdered.some((l) => l.id === allocateLineId)
                    ? allocateLineId
                    : ''
              }
              onChange={(e) => setAllocateLineId(e.target.value)}
              disabled={
                editorBusy ||
                allocateInvoiceId.trim() === '' ||
                invoices.find((i) => i.id === allocateInvoiceId.trim())
                  ?.status !== 'issued' ||
                allocateInvoiceLinesLoading
              }
            >
              <option value=''>Whole invoice (no specific line)</option>
              {allocateLinesOrdered
                .map((line, idx) => ({ line, idx }))
                .filter(({ line }) => (line.id?.trim() ?? '') !== '')
                .map(({ line, idx }) => {
                  const lid = line.id?.trim() ?? '';
                  return (
                    <option key={lid} value={lid}>
                      {formatAllocateLineOptionLabel(
                        line,
                        idx,
                        allocateLineDescriptionCounts,
                      )}
                    </option>
                  );
                })}
            </Select>
            {allocateInvoiceLinesLoading ? (
              <p className='mt-1 text-xs text-slate-600'>
                Loading invoice lines…
              </p>
            ) : null}
            {allocateInvoiceLinesError ? (
              <AdminInlineError className='mt-1'>
                {allocateInvoiceLinesError}
              </AdminInlineError>
            ) : null}
          </div>
          <div className='min-w-0'>
            <Label htmlFor='billing-allocate-amount'>Amount</Label>
            <Input
              id='billing-allocate-amount'
              value={allocateAmount}
              onChange={(e) => setAllocateAmount(e.target.value)}
              className='mt-1 w-full min-w-0 max-w-xs min-[780px]:max-w-none'
              disabled={editorBusy}
            />
          </div>
          <div className='min-w-0'>
            <Label htmlFor='billing-allocate-currency'>Currency</Label>
            <Select
              id='billing-allocate-currency'
              className='mt-1 w-full min-w-0 max-w-xs min-[780px]:max-w-none'
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
          </div>
        </div>
      </form>
    </AdminEditorCard>
  );
}
