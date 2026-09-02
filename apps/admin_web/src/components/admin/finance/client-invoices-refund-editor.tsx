'use client';

import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatTruncatedId } from '@/components/admin/finance/client-invoices-format-helpers';
import { REFUND_FORM_ID } from '@/components/admin/finance/client-invoices-utils';

import type {
  ClientInvoicesPanelBusy,
  ClientInvoicesPanelCurrency,
  ClientInvoicesRefundEditorSlice,
} from '@/hooks/client-invoices-panel-types';

export interface ClientInvoicesRefundEditorProps {
  currency: ClientInvoicesPanelCurrency;
  busy: ClientInvoicesPanelBusy;
  refund: ClientInvoicesRefundEditorSlice;
}

export function ClientInvoicesRefundEditor({
  currency,
  busy,
  refund,
}: ClientInvoicesRefundEditorProps) {
  const { currencyOptions } = currency;
  const { busyAction, editorBusy } = busy;
  const {
    refundInvoiceId,
    setRefundInvoiceId,
    refundPaymentSelectId,
    setRefundPaymentSelectId,
    refundPaymentsLoading,
    refundPaymentsError,
    refundEligiblePayments,
    refundAmount,
    setRefundAmount,
    refundCurrency,
    setRefundCurrency,
    refundMethod,
    setRefundMethod,
    refundStripeId,
    setRefundStripeId,
    issuedInvoicesForAllocate,
    handleRefund,
  } = refund;

  return (
    <AdminEditorCard
      title='Record refund payment row'
      description='Choose an issued invoice, then the inbound payment allocated to it (from allocations). Creates a succeeded refund linked to that payment.'
      actions={
        <Button
          type='submit'
          form={REFUND_FORM_ID}
          disabled={editorBusy}
          variant='secondary'
        >
          {busyAction === 'refund' ? 'Recording…' : 'Record refund'}
        </Button>
      }
    >
      <form
        id={REFUND_FORM_ID}
        className='flex max-w-full flex-col gap-3'
        onSubmit={(e) => void handleRefund(e)}
      >
        <div className='grid gap-3 min-[780px]:grid-cols-2 min-[780px]:items-end'>
          <div className='min-w-0'>
            <Label htmlFor='billing-refund-invoice'>Issued invoice</Label>
            <Select
              id='billing-refund-invoice'
              className='mt-1 w-full min-w-0 max-w-xl min-[780px]:max-w-none'
              value={
                issuedInvoicesForAllocate.some((i) => i.id === refundInvoiceId)
                  ? refundInvoiceId
                  : ''
              }
              onChange={(e) => {
                setRefundInvoiceId(e.target.value);
                setRefundPaymentSelectId('');
              }}
              disabled={editorBusy}
            >
              <option value=''>Select invoice…</option>
              {issuedInvoicesForAllocate.map((invOpt) => {
                const oid = invOpt.id ?? '';
                const num = invOpt.invoiceNumber?.trim() ?? '';
                const label = num !== '' ? num : formatTruncatedId(oid);
                return (
                  <option key={oid || 'refund-invoice-option'} value={oid}>
                    {label}
                  </option>
                );
              })}
            </Select>
          </div>
          <div className='min-w-0'>
            <Label htmlFor='billing-refund-payment'>
              Payment allocated to invoice
            </Label>
            <Select
              id='billing-refund-payment'
              className='mt-1 w-full min-w-0 max-w-xl min-[780px]:max-w-none'
              value={
                refundEligiblePayments.some(
                  (p) => p.id === refundPaymentSelectId,
                )
                  ? refundPaymentSelectId
                  : ''
              }
              onChange={(e) => setRefundPaymentSelectId(e.target.value)}
              disabled={
                editorBusy ||
                refundInvoiceId.trim() === '' ||
                refundPaymentsLoading ||
                refundEligiblePayments.length === 0
              }
            >
              <option value=''>
                {refundPaymentsLoading
                  ? 'Loading payments…'
                  : refundEligiblePayments.length === 0
                    ? 'No inbound succeeded payments with allocations'
                    : 'Select payment…'}
              </option>
              {refundEligiblePayments.map((p) => {
                const pid = p.id ?? '';
                const amt = p.amount ?? '';
                const cur = p.currency ?? '';
                const method = p.method?.trim() ?? '';
                const methodSuffix = method !== '' ? ` · ${method}` : '';
                return (
                  <option key={pid || 'refund-pay-opt'} value={pid}>
                    {formatTruncatedId(pid)} · {amt} {cur}
                    {methodSuffix}
                  </option>
                );
              })}
            </Select>
            {refundPaymentsLoading ? (
              <p className='mt-1 text-xs text-slate-600'>Loading payments…</p>
            ) : null}
            {refundPaymentsError ? (
              <AdminInlineError className='mt-1'>
                {refundPaymentsError}
              </AdminInlineError>
            ) : null}
            {!refundPaymentsLoading &&
            refundInvoiceId.trim() !== '' &&
            refundEligiblePayments.length === 0 &&
            !refundPaymentsError ? (
              <p className='mt-1 text-xs text-slate-600'>
                No succeeded inbound payments are allocated to this invoice yet.
              </p>
            ) : null}
          </div>
        </div>
        <div className='grid gap-3 min-[780px]:grid-cols-4 min-[780px]:items-end'>
          <div className='min-w-0'>
            <Label htmlFor='billing-refund-amount'>Amount</Label>
            <Input
              id='billing-refund-amount'
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              className='mt-1 w-full min-w-0 max-w-xs min-[780px]:max-w-none'
              disabled={editorBusy}
            />
          </div>
          <div className='min-w-0'>
            <Label htmlFor='billing-refund-currency'>Currency</Label>
            <Select
              id='billing-refund-currency'
              className='mt-1 w-full min-w-0 max-w-xs min-[780px]:max-w-none'
              value={refundCurrency}
              onChange={(e) => setRefundCurrency(e.target.value)}
              disabled={editorBusy}
            >
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className='min-w-0'>
            <Label htmlFor='billing-refund-method'>Method (optional)</Label>
            <Input
              id='billing-refund-method'
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value)}
              className='mt-1 w-full min-w-0'
              disabled={editorBusy}
            />
          </div>
          <div className='min-w-0'>
            <Label htmlFor='billing-refund-stripe'>
              Stripe refund id (optional)
            </Label>
            <Input
              id='billing-refund-stripe'
              value={refundStripeId}
              onChange={(e) => setRefundStripeId(e.target.value)}
              className='mt-1 w-full min-w-0 font-mono text-sm'
              disabled={editorBusy}
            />
          </div>
        </div>
      </form>
    </AdminEditorCard>
  );
}
