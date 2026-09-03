'use client';

import type { ReactNode } from 'react';

import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Input } from '@/components/ui/input';
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
  /** Extra sections (allocations, allocate form) rendered under the fields. */
  children?: ReactNode;
}

/**
 * Manual inbound payment editor rendered inside the expanded payments-table
 * row: the draft row creates a payment, an editable record row updates it.
 * Pick a recent enrollment to attribute the payment, or (none) to record it
 * without one (for example before allocating to a customized invoice).
 */
export function ClientInvoicesManualPaymentEditor({
  currency,
  busy,
  manualPayment,
  children,
}: ClientInvoicesManualPaymentEditorProps) {
  const { currencyOptions } = currency;
  const { busyAction, editorBusy } = busy;
  const {
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
    handleManualPaymentFormSubmit,
    setPaymentEditorDirty,
    enrollmentPickerRows,
  } = manualPayment;

  const touch = <T,>(setter: (value: T) => void) => {
    return (value: T) => {
      setPaymentEditorDirty(true);
      setter(value);
    };
  };
  const setAmount = touch(setCreatePaymentAmount);
  const setCurrency = touch(setCreatePaymentCurrency);
  const setMethod = touch(setCreatePaymentMethod);
  const setStatus = touch(setCreatePaymentStatus);
  const setExternalRef = touch(setCreatePaymentExternalRef);

  const isSaving = busyAction === 'create-payment' || busyAction === 'update-payment';

  return (
    <AdminEditorPanel
      actions={
        <AdminEditorActions
          mode={manualPaymentIsUpdate ? 'edit' : 'create'}
          formId={MANUAL_PAYMENT_FORM_ID}
          isSaving={isSaving}
          submitDisabled={editorBusy}
          submitLabel={manualPaymentIsUpdate ? 'Update customer payment' : 'Create customer payment'}
        />
      }
    >
      <form
        id={MANUAL_PAYMENT_FORM_ID}
        className='space-y-4'
        onSubmit={(e) => void handleManualPaymentFormSubmit(e)}
      >
        <AdminFieldGrid columns={4}>
          <AdminField
            label='Enrollment'
            htmlFor='billing-create-pay-enrollment-select'
            span={2}
            hint={
              manualPaymentIsUpdate
                ? undefined
                : 'With an enrollment the currency follows it; without one, set the currency explicitly.'
            }
          >
            {manualPaymentIsUpdate ? (
              <Input
                id='billing-create-pay-enrollment-select'
                className='mt-1 w-full'
                value={manualPaymentEnrollmentEditLabel !== '' ? manualPaymentEnrollmentEditLabel : '—'}
                readOnly
              />
            ) : (
              <Select
                id='billing-create-pay-enrollment-select'
                className='mt-1 w-full min-w-0'
                value={createPaymentEnrollmentPickerValue}
                onChange={(e) => {
                  const v = e.target.value;
                  setPaymentEditorDirty(true);
                  setCreatePaymentEnrollmentId(v);
                  if (v === NO_ENROLLMENT_OPTION_VALUE) {
                    return;
                  }
                  const row = enrollmentPickerRows.find((r) => r.enrollmentId === v);
                  if (row?.currency) {
                    setCreatePaymentCurrency(row.currency);
                  }
                }}
                disabled={editorBusy}
              >
                <option value=''>Choose from recent enrollments…</option>
                <option value={NO_ENROLLMENT_OPTION_VALUE}>(none — record without enrollment)</option>
                {enrollmentPickerRows.map((row) => (
                  <option key={row.enrollmentId} value={row.enrollmentId}>
                    {formatRecentEnrollmentPaymentSelectLabel(row)}
                  </option>
                ))}
              </Select>
            )}
          </AdminField>
          <AdminField label='Payment status' htmlFor='billing-create-pay-status'>
            <Select
              id='billing-create-pay-status'
              className='mt-1 w-full min-w-0'
              value={createPaymentStatus}
              onChange={(e) => setStatus(e.target.value as 'pending' | 'succeeded')}
              disabled={editorBusy || manualPaymentSucceededReadOnly}
            >
              <option value='pending'>Pending (awaiting clearance)</option>
              <option value='succeeded'>Succeeded (funds received)</option>
            </Select>
          </AdminField>
          <AdminField label='Amount' htmlFor='billing-create-pay-amount'>
            <Input
              id='billing-create-pay-amount'
              value={createPaymentAmount}
              onChange={(e) => setAmount(e.target.value)}
              className='mt-1 w-full min-w-0 tabular-nums'
              inputMode='decimal'
              disabled={editorBusy || manualPaymentSucceededReadOnly}
            />
          </AdminField>
          <AdminField label='Currency' htmlFor='billing-create-pay-currency'>
            <Select
              id='billing-create-pay-currency'
              className='mt-1 w-full min-w-0'
              value={createPaymentCurrency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={editorBusy || manualPaymentSucceededReadOnly}
            >
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Method' htmlFor='billing-create-pay-method'>
            <Select
              id='billing-create-pay-method'
              className='mt-1 w-full min-w-0'
              value={createPaymentMethod}
              onChange={(e) => setMethod(e.target.value)}
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
          </AdminField>
          <AdminField label='Bank / external reference' htmlFor='billing-create-pay-external-ref' span={2}>
            <Input
              id='billing-create-pay-external-ref'
              value={createPaymentExternalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              className='mt-1 w-full min-w-0'
              disabled={editorBusy}
            />
          </AdminField>
        </AdminFieldGrid>
      </form>
      {children}
    </AdminEditorPanel>
  );
}
