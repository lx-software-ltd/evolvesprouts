'use client';

import type { ReactNode } from 'react';

import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Input } from '@/components/ui/input';
import { ClientInvoicesAllocateEditor } from '@/components/admin/finance/client-invoices-allocate-editor';
import {
  formatPaymentMethodLabel,
  formatTruncatedId,
} from '@/components/admin/finance/client-invoices-format-helpers';
import { ClientInvoicesManualPaymentEditor } from '@/components/admin/finance/client-invoices-manual-payment-editor';
import type { CustomerPaymentSummary } from '@/lib/billing-api';
import { formatDate, formatEnumLabel } from '@/lib/format';
import { formatAmountInCurrency } from '@/lib/vendor-spend';

import type {
  ClientInvoicesAllocateEditorSlice,
  ClientInvoicesManualPaymentEditorSlice,
  ClientInvoicesPanelBusy,
  ClientInvoicesPanelCurrency,
  ClientInvoicesPaymentsTableSlice,
} from '@/hooks/client-invoices-panel-types';

export interface ClientInvoicesPaymentDetailProps {
  payment: CustomerPaymentSummary;
  currency: ClientInvoicesPanelCurrency;
  busy: ClientInvoicesPanelBusy;
  manualPayment: ClientInvoicesManualPaymentEditorSlice;
  payments: ClientInvoicesPaymentsTableSlice;
  allocate: ClientInvoicesAllocateEditorSlice;
}

function formatMoney(value: string | null | undefined, currencyCode: string): string {
  const raw = value?.trim() ?? '';
  const parsed = Number.parseFloat(raw);
  return raw !== '' && Number.isFinite(parsed) ? formatAmountInCurrency(parsed, currencyCode) : '—';
}

/**
 * Body of an expanded payment row. Manual inbound payments (no Stripe intent)
 * open as an editor; every other payment shows read-only fields. Both variants
 * list the invoices the payment is allocated to and, for inbound payments,
 * offer the "Allocate to invoice" sub-accordion.
 */
export function ClientInvoicesPaymentDetail({
  payment,
  currency,
  busy,
  manualPayment,
  payments: pay,
  allocate,
}: ClientInvoicesPaymentDetailProps) {
  const { defaultCurrency } = currency;
  const { detail, detailError } = pay;
  const id = payment.id ?? '';
  const detailForRow = detail?.id === id ? detail : null;
  const currencyCode = (payment.currency ?? defaultCurrency).trim().toUpperCase() || defaultCurrency;
  const canAllocate = payment.direction === 'inbound' && payment.status !== 'failed';
  const allocations = detailForRow?.allocationInvoices ?? [];

  const sections: ReactNode = (
    <>
      {detailError ? <AdminInlineError>{detailError}</AdminInlineError> : null}
      <AdminDisclosure
        id={`billing-payment-${id}-allocations`}
        title='Allocated invoices'
        summary={detailForRow ? `${allocations.length}` : 'Loading…'}
      >
        {allocations.length === 0 ? (
          <p className='text-sm text-slate-500'>
            {detailForRow ? 'Not allocated to any invoice yet.' : 'Loading allocations…'}
          </p>
        ) : (
          <ul className='space-y-1 text-sm text-slate-700'>
            {allocations.map((a) => (
              <li key={a.invoiceId} className='wrap-anywhere'>
                {a.invoiceNumber?.trim() || formatTruncatedId(a.invoiceId)}
              </li>
            ))}
          </ul>
        )}
      </AdminDisclosure>
      {canAllocate ? <ClientInvoicesAllocateEditor currency={currency} busy={busy} allocate={allocate} /> : null}
    </>
  );

  if (manualPayment.manualPaymentIsUpdate) {
    return (
      <ClientInvoicesManualPaymentEditor currency={currency} busy={busy} manualPayment={manualPayment}>
        {sections}
      </ClientInvoicesManualPaymentEditor>
    );
  }

  const fieldId = (suffix: string) => `billing-payment-${id}-${suffix}`;
  const partyLabel = (payment.party ?? '').trim() || '—';
  const stripeRef = payment.stripePaymentIntentId?.trim() || payment.stripeRefundId?.trim() || '';

  return (
    <AdminEditorPanel>
      <AdminFieldGrid columns={4}>
        <AdminField label='Party' htmlFor={fieldId('party')} span={2}>
          <Input id={fieldId('party')} className='mt-1' value={partyLabel} readOnly />
        </AdminField>
        <AdminField label='Direction' htmlFor={fieldId('direction')}>
          <Input id={fieldId('direction')} className='mt-1' value={formatEnumLabel(payment.direction ?? '')} readOnly />
        </AdminField>
        <AdminField label='Status' htmlFor={fieldId('status')}>
          <Input id={fieldId('status')} className='mt-1' value={formatEnumLabel(payment.status ?? '')} readOnly />
        </AdminField>
        <AdminField label='Amount' htmlFor={fieldId('amount')}>
          <Input
            id={fieldId('amount')}
            className='mt-1 tabular-nums'
            value={formatMoney(payment.amount, currencyCode)}
            readOnly
          />
        </AdminField>
        <AdminField label='Unapplied amount' htmlFor={fieldId('unapplied')}>
          <Input
            id={fieldId('unapplied')}
            className='mt-1 tabular-nums'
            value={formatMoney(payment.unappliedAmount, currencyCode)}
            readOnly
          />
        </AdminField>
        <AdminField label='Method' htmlFor={fieldId('method')}>
          <Input id={fieldId('method')} className='mt-1' value={formatPaymentMethodLabel(payment.method)} readOnly />
        </AdminField>
        <AdminField label='Created' htmlFor={fieldId('created')}>
          <Input id={fieldId('created')} className='mt-1' value={formatDate(payment.createdAt ?? null)} readOnly />
        </AdminField>
        {payment.externalReference?.trim() ? (
          <AdminField label='Bank / external reference' htmlFor={fieldId('external-ref')} span={2}>
            <Input id={fieldId('external-ref')} className='mt-1' value={payment.externalReference.trim()} readOnly />
          </AdminField>
        ) : null}
        {stripeRef !== '' ? (
          <AdminField label='Stripe reference' htmlFor={fieldId('stripe-ref')} span={2}>
            <Input id={fieldId('stripe-ref')} className='mt-1 font-mono text-sm' value={stripeRef} readOnly />
          </AdminField>
        ) : null}
      </AdminFieldGrid>
      {sections}
    </AdminEditorPanel>
  );
}
