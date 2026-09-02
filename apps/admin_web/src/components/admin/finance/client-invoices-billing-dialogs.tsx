'use client';

import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import type {
  ClientInvoicesBillingDialogsSlice,
  ClientInvoicesPanelBusy,
} from '@/hooks/client-invoices-panel-types';

export interface ClientInvoicesBillingDialogsProps {
  busy: ClientInvoicesPanelBusy;
  dialogs: ClientInvoicesBillingDialogsSlice;
}

export function ClientInvoicesBillingDialogs({
  busy,
  dialogs,
}: ClientInvoicesBillingDialogsProps) {
  const { busyAction, editorBusy } = busy;
  const {
    voidDialogOpen,
    voidReason,
    setVoidReason,
    voidError,
    setVoidError,
    closeVoidInvoiceDialog,
    confirmVoidInvoice,
    deleteDraftDialogOpen,
    deleteDraftError,
    closeDeleteDraftInvoiceDialog,
    confirmDeleteDraftInvoice,
    confirmPaymentDialogOpen,
    confirmPaymentExternalRef,
    setConfirmPaymentExternalRef,
    confirmPaymentError,
    setConfirmPaymentError,
    closeConfirmPaymentDialog,
    submitConfirmPayment,
    deletePaymentDialogOpen,
    deletePaymentError,
    closeDeletePaymentDialog,
    submitDeletePayment,
  } = dialogs;

  return (
    <>
      <ConfirmDialog
        open={voidDialogOpen}
        title='Void invoice'
        description='This voids the draft or issued invoice. Provide a short reason for the audit trail.'
        confirmLabel='Void invoice'
        cancelLabel='Cancel'
        variant='danger'
        confirmDisabled={busyAction === 'void' || deleteDraftDialogOpen}
        onCancel={closeVoidInvoiceDialog}
        onConfirm={() => void confirmVoidInvoice()}
      >
        <div className='space-y-2'>
          <Label htmlFor='billing-void-reason'>Reason</Label>
          <Textarea
            id='billing-void-reason'
            value={voidReason}
            onChange={(e) => {
              setVoidReason(e.target.value);
              setVoidError('');
            }}
            rows={3}
            placeholder='Required'
          />
          {voidError ? <AdminInlineError>{voidError}</AdminInlineError> : null}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteDraftDialogOpen}
        title='Delete draft invoice'
        description='This permanently removes the draft invoice and its lines. Issued or void invoices cannot be deleted here.'
        confirmLabel='Delete draft'
        cancelLabel='Cancel'
        variant='danger'
        confirmDisabled={busyAction === 'delete-draft'}
        onCancel={closeDeleteDraftInvoiceDialog}
        onConfirm={() => void confirmDeleteDraftInvoice()}
      >
        {deleteDraftError ? (
          <AdminInlineError>{deleteDraftError}</AdminInlineError>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmPaymentDialogOpen}
        title='Confirm payment'
        description='Marks this pending inbound payment as succeeded. Receipt generation follows server rules.'
        confirmLabel='Confirm payment'
        cancelLabel='Cancel'
        confirmDisabled={busyAction === 'confirm'}
        onCancel={closeConfirmPaymentDialog}
        onConfirm={() => void submitConfirmPayment()}
      >
        <div className='space-y-2'>
          <Label htmlFor='billing-confirm-dialog-ref'>
            Bank reference / external id (optional)
          </Label>
          <Input
            id='billing-confirm-dialog-ref'
            value={confirmPaymentExternalRef}
            onChange={(e) => {
              setConfirmPaymentExternalRef(e.target.value);
              setConfirmPaymentError('');
            }}
          />
          {confirmPaymentError ? (
            <AdminInlineError>{confirmPaymentError}</AdminInlineError>
          ) : null}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={deletePaymentDialogOpen}
        title='Delete customer payment'
        description='Permanently removes this payment row. Allowed only when the server marks the row as deletable (pending or free payment, no active enrollment link, and no allocations or receipt).'
        confirmLabel='Delete payment'
        cancelLabel='Cancel'
        variant='danger'
        confirmDisabled={busyAction === 'delete-payment'}
        onCancel={closeDeletePaymentDialog}
        onConfirm={() => void submitDeletePayment()}
      >
        {deletePaymentError ? (
          <AdminInlineError>{deletePaymentError}</AdminInlineError>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
