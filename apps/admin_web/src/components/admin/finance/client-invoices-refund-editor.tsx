'use client';

import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

/**
 * "Record refund" sub-accordion of an issued invoice. The invoice is the
 * expanded row; the operator picks one of the inbound payments allocated to
 * it and the refund amount.
 */
export function ClientInvoicesRefundEditor({
  currency,
  busy,
  refund,
}: ClientInvoicesRefundEditorProps) {
  const { currencyOptions } = currency;
  const { busyAction, editorBusy } = busy;
  const {
    refundInvoiceId,
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
    handleRefund,
  } = refund;

  const paymentSelectValue = refundEligiblePayments.some((p) => p.id === refundPaymentSelectId)
    ? refundPaymentSelectId
    : '';
  const noEligiblePayments =
    !refundPaymentsLoading && refundInvoiceId.trim() !== '' && refundEligiblePayments.length === 0 && !refundPaymentsError;

  return (
    <AdminDisclosure
      id={`refund-${refundInvoiceId || 'none'}`}
      title='Refund'
      summary={
        refundPaymentsLoading
          ? 'Loading payments…'
          : `${refundEligiblePayments.length} eligible payment${refundEligiblePayments.length === 1 ? '' : 's'}`
      }
    >
      <form id={REFUND_FORM_ID} className='space-y-4' onSubmit={(e) => void handleRefund(e)}>
        <AdminFieldGrid columns={4}>
          <AdminField
            label='Payment allocated to invoice'
            htmlFor='billing-refund-payment'
            span={2}
            error={refundPaymentsError || undefined}
            hint={noEligiblePayments ? 'No succeeded inbound payments are allocated to this invoice yet.' : undefined}
          >
            <Select
              id='billing-refund-payment'
              className='mt-1 w-full min-w-0'
              value={paymentSelectValue}
              onChange={(e) => setRefundPaymentSelectId(e.target.value)}
              disabled={editorBusy || refundPaymentsLoading || refundEligiblePayments.length === 0}
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
                const method = p.method?.trim() ?? '';
                const methodSuffix = method !== '' ? ` · ${method}` : '';
                return (
                  <option key={pid || 'refund-pay-opt'} value={pid}>
                    {formatTruncatedId(pid)} · {p.amount ?? ''} {p.currency ?? ''}
                    {methodSuffix}
                  </option>
                );
              })}
            </Select>
          </AdminField>
          <AdminField label='Amount' htmlFor='billing-refund-amount'>
            <Input
              id='billing-refund-amount'
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              className='mt-1 w-full min-w-0'
              inputMode='decimal'
              disabled={editorBusy}
            />
          </AdminField>
          <AdminField label='Currency' htmlFor='billing-refund-currency'>
            <Select
              id='billing-refund-currency'
              className='mt-1 w-full min-w-0'
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
          </AdminField>
          <AdminField label='Method (optional)' htmlFor='billing-refund-method' span={2}>
            <Input
              id='billing-refund-method'
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value)}
              className='mt-1 w-full min-w-0'
              disabled={editorBusy}
            />
          </AdminField>
          <AdminField label='Stripe refund id (optional)' htmlFor='billing-refund-stripe' span={2}>
            <Input
              id='billing-refund-stripe'
              value={refundStripeId}
              onChange={(e) => setRefundStripeId(e.target.value)}
              className='mt-1 w-full min-w-0 font-mono text-sm'
              disabled={editorBusy}
            />
          </AdminField>
        </AdminFieldGrid>
        <div className='flex justify-start'>
          <Button
            type='submit'
            variant='secondary'
            disabled={editorBusy || refundEligiblePayments.length === 0}
            loading={busyAction === 'refund'}
            loadingLabel='Recording…'
          >
            Record refund
          </Button>
        </div>
      </form>
    </AdminDisclosure>
  );
}
