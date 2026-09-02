'use client';

import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  MANUAL_PAYMENT_FORM_ID,
  NO_ENROLLMENT_OPTION_VALUE,
  formatRecentEnrollmentPaymentSelectLabel,
} from '@/components/admin/finance/client-invoices-utils';

import type {
  ClientInvoicesManualPaymentEditorSlice,
  ClientInvoicesPanelBusy,
  ClientInvoicesPanelCurrency,
} from '@/hooks/client-invoices-panel-types';

export interface ClientInvoicesManualPaymentEditorProps {
  currency: ClientInvoicesPanelCurrency;
  busy: ClientInvoicesPanelBusy;
  manualPayment: ClientInvoicesManualPaymentEditorSlice;
}

export function ClientInvoicesManualPaymentEditor({
  currency,
  busy,
  manualPayment,
}: ClientInvoicesManualPaymentEditorProps) {
  const { currencyOptions } = currency;
  const { busyAction, editorBusy } = busy;
  const {
    createPaymentEnrollmentId,
    setCreatePaymentEnrollmentId,
    createPaymentEnrollmentPickerValue,
    createPaymentAmount,
    setCreatePaymentAmount,
    createPaymentCurrency,
    setCreatePaymentCurrency,
    createPaymentMethod,
    setCreatePaymentMethod,
    createPaymentStatus,
    setCreatePaymentStatus,
    createPaymentExternalRef,
    setCreatePaymentExternalRef,
    manualPaymentIsUpdate,
    manualPaymentSucceededReadOnly,
    manualPaymentEnrollmentEditLabel,
    handleCancelManualPayment,
    handleManualPaymentFormSubmit,
    enrollmentPickerRows,
  } = manualPayment;

  return (
    <AdminEditorCard
      title='Customer payment'
      description='Pick a recent enrollment to attribute this payment, or choose (none) to record a payment with no enrollment (for example before allocating to a customized invoice). With an enrollment, currency must match it; without one, set currency explicitly. Use Pending until funds clear.'
      actions={
        <>
          {manualPaymentIsUpdate ? (
            <Button
              type='button'
              variant='secondary'
              onClick={handleCancelManualPayment}
              disabled={editorBusy}
            >
              Cancel
            </Button>
          ) : null}
          <Button
            type='submit'
            form={MANUAL_PAYMENT_FORM_ID}
            disabled={editorBusy}
            aria-label={
              manualPaymentIsUpdate
                ? 'Update customer payment'
                : 'Create customer payment'
            }
          >
            {busyAction === 'create-payment' || busyAction === 'update-payment'
              ? 'Saving…'
              : manualPaymentIsUpdate
                ? 'Update payment'
                : 'Create payment'}
          </Button>
        </>
      }
    >
      <form
        id={MANUAL_PAYMENT_FORM_ID}
        className='flex max-w-full flex-col gap-3'
        onSubmit={(e) => void handleManualPaymentFormSubmit(e)}
      >
        <div className='grid gap-3 min-[780px]:grid-cols-2 min-[780px]:items-end'>
          <div className='min-w-0'>
            {manualPaymentIsUpdate ? (
              <span className='block text-sm font-medium text-slate-800'>
                Enrollment
              </span>
            ) : (
              <Label htmlFor='billing-create-pay-enrollment-select'>
                Enrollment
              </Label>
            )}
            {manualPaymentIsUpdate ? (
              <div className='mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800'>
                <p className='m-0'>
                  {manualPaymentEnrollmentEditLabel !== ''
                    ? manualPaymentEnrollmentEditLabel
                    : '—'}
                </p>
              </div>
            ) : (
              <Select
                id='billing-create-pay-enrollment-select'
                className='mt-1 w-full min-w-0'
                value={createPaymentEnrollmentPickerValue}
                onChange={(e) => {
                  const v = e.target.value;
                  setCreatePaymentEnrollmentId(v);
                  if (v === NO_ENROLLMENT_OPTION_VALUE) {
                    return;
                  }
                  const row = enrollmentPickerRows.find(
                    (r) => r.enrollmentId === v,
                  );
                  if (row?.currency) {
                    setCreatePaymentCurrency(row.currency);
                  }
                }}
                disabled={editorBusy}
              >
                <option value=''>Choose from recent enrollments…</option>
                <option value={NO_ENROLLMENT_OPTION_VALUE}>
                  (none — record without enrollment)
                </option>
                {enrollmentPickerRows.map((row) => (
                  <option key={row.enrollmentId} value={row.enrollmentId}>
                    {formatRecentEnrollmentPaymentSelectLabel(row)}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className='min-w-0'>
            <Label htmlFor='billing-create-pay-status'>Payment status</Label>
            <Select
              id='billing-create-pay-status'
              className='mt-1 w-full min-w-0'
              value={createPaymentStatus}
              onChange={(e) =>
                setCreatePaymentStatus(
                  e.target.value as 'pending' | 'succeeded',
                )
              }
              disabled={editorBusy || manualPaymentSucceededReadOnly}
            >
              <option value='pending'>Pending (awaiting clearance)</option>
              <option value='succeeded'>Succeeded (funds received)</option>
            </Select>
          </div>
        </div>
        <div className='grid gap-3 min-[780px]:grid-cols-4 min-[780px]:items-end'>
          <div className='min-w-0'>
            <Label htmlFor='billing-create-pay-amount'>Amount</Label>
            <Input
              id='billing-create-pay-amount'
              value={createPaymentAmount}
              onChange={(e) => setCreatePaymentAmount(e.target.value)}
              className='mt-1 w-full min-w-0 max-w-xs min-[780px]:max-w-none'
              disabled={editorBusy || manualPaymentSucceededReadOnly}
            />
          </div>
          <div className='min-w-0'>
            <Label htmlFor='billing-create-pay-currency'>Currency</Label>
            <Select
              id='billing-create-pay-currency'
              className='mt-1 w-full min-w-0 max-w-xs min-[780px]:max-w-none'
              value={createPaymentCurrency}
              onChange={(e) => setCreatePaymentCurrency(e.target.value)}
              disabled={editorBusy || manualPaymentSucceededReadOnly}
            >
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className='min-w-0'>
            <Label htmlFor='billing-create-pay-method'>Method</Label>
            <Select
              id='billing-create-pay-method'
              className='mt-1 w-full min-w-0'
              value={createPaymentMethod}
              onChange={(e) => setCreatePaymentMethod(e.target.value)}
              disabled={editorBusy}
            >
              <option value='bank_transfer'>Bank transfer</option>
              <option value='fps'>FPS</option>
              <option value='cash'>Cash</option>
              <option value='cheque'>Cheque</option>
              <option value='stripe_card'>Card / Stripe</option>
              <option value='adjustment'>Adjustment</option>
              <option value='free'>Free (zero amount)</option>
            </Select>
          </div>
          <div className='min-w-0'>
            <Label htmlFor='billing-create-pay-external-ref'>
              Bank / external reference
            </Label>
            <Input
              id='billing-create-pay-external-ref'
              value={createPaymentExternalRef}
              onChange={(e) => setCreatePaymentExternalRef(e.target.value)}
              className='mt-1 w-full min-w-0'
              disabled={editorBusy}
            />
          </div>
        </div>
      </form>
    </AdminEditorCard>
  );
}
