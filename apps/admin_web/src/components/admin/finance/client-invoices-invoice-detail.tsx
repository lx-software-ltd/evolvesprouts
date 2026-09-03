'use client';

import { ClientInvoicesRefundEditor } from '@/components/admin/finance/client-invoices-refund-editor';
import { AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CustomerInvoiceSummary } from '@/lib/billing-api';
import { getInvoiceSettlementBadgeLabel } from '@/lib/invoice-settlement-display';
import { formatDateOnly, formatDate, formatEnumLabel, formatYmdAsLocalDate } from '@/lib/format';
import { formatAmountInCurrency } from '@/lib/vendor-spend';

import type {
  ClientInvoicesInvoicesTableSlice,
  ClientInvoicesPanelBusy,
  ClientInvoicesPanelCurrency,
  ClientInvoicesRefundEditorSlice,
} from '@/hooks/client-invoices-panel-types';

const EMAIL_INPUT_ID = 'billing-issued-invoice-emails';

export interface ClientInvoicesInvoiceDetailProps {
  invoice: CustomerInvoiceSummary;
  currency: ClientInvoicesPanelCurrency;
  busy: ClientInvoicesPanelBusy;
  invoices: ClientInvoicesInvoicesTableSlice;
  refund: ClientInvoicesRefundEditorSlice;
}

function formatMoney(raw: string | undefined, currencyCode: string): string {
  const trimmed = raw?.trim() ?? '';
  const parsed = Number.parseFloat(trimmed);
  return trimmed !== '' && Number.isFinite(parsed) ? formatAmountInCurrency(parsed, currencyCode) : '—';
}

/**
 * Body of an expanded invoice row: the invoice's key figures as read-only
 * fields, then (for issued invoices) the email recipients with Send email as
 * the primary action and the Record refund sub-accordion.
 */
export function ClientInvoicesInvoiceDetail({
  invoice,
  currency,
  busy,
  invoices: inv,
  refund,
}: ClientInvoicesInvoiceDetailProps) {
  const { defaultCurrency } = currency;
  const { busyAction, editorBusy } = busy;
  const {
    issuedInvoiceEmailCsv,
    setIssuedInvoiceEmailCsv,
    issuedInvoiceEmailError,
    setIssuedInvoiceEmailError,
    issuedInvoiceEmailDirtyRef,
    setInvoiceEditorDirty,
    handleEmailIssuedInvoice,
  } = inv;

  const currencyCode = (invoice.currency ?? defaultCurrency).trim().toUpperCase() || defaultCurrency;
  const isIssued = invoice.status === 'issued';
  const dateLabel = invoice.invoiceDate
    ? formatYmdAsLocalDate(invoice.invoiceDate)
    : formatDateOnly(invoice.createdAt ?? null);

  return (
    <AdminEditorPanel
      actions={
        isIssued ? (
          <Button
            type='button'
            disabled={editorBusy}
            loading={busyAction === 'email'}
            loadingLabel='Sending…'
            onClick={() => void handleEmailIssuedInvoice()}
          >
            Send email
          </Button>
        ) : undefined
      }
    >
      <AdminFieldGrid columns={4}>
        <AdminField label='Status' htmlFor={`invoice-${invoice.id ?? ''}-status`}>
          <Input
            id={`invoice-${invoice.id ?? ''}-status`}
            className='mt-1'
            value={formatEnumLabel(invoice.status ?? '')}
            readOnly
          />
        </AdminField>
        <AdminField label='Settlement' htmlFor={`invoice-${invoice.id ?? ''}-settlement`}>
          <Input
            id={`invoice-${invoice.id ?? ''}-settlement`}
            className='mt-1'
            value={getInvoiceSettlementBadgeLabel(invoice)}
            readOnly
          />
        </AdminField>
        <AdminField label='Total' htmlFor={`invoice-${invoice.id ?? ''}-total`}>
          <Input
            id={`invoice-${invoice.id ?? ''}-total`}
            className='mt-1 tabular-nums'
            value={formatMoney(invoice.total, currencyCode)}
            readOnly
          />
        </AdminField>
        <AdminField label='Balance due' htmlFor={`invoice-${invoice.id ?? ''}-balance`}>
          <Input
            id={`invoice-${invoice.id ?? ''}-balance`}
            className='mt-1 tabular-nums'
            value={formatMoney(invoice.balanceDue, currencyCode)}
            readOnly
          />
        </AdminField>
        <AdminField label='Bill to' htmlFor={`invoice-${invoice.id ?? ''}-bill-to`} span={2}>
          <Input
            id={`invoice-${invoice.id ?? ''}-bill-to`}
            className='mt-1'
            value={invoice.billToDisplayName ?? invoice.billToEmail ?? '—'}
            readOnly
          />
        </AdminField>
        <AdminField label='Invoice date' htmlFor={`invoice-${invoice.id ?? ''}-date`}>
          <Input id={`invoice-${invoice.id ?? ''}-date`} className='mt-1' value={dateLabel} readOnly />
        </AdminField>
        <AdminField label='Lines' htmlFor={`invoice-${invoice.id ?? ''}-lines`}>
          <Input
            id={`invoice-${invoice.id ?? ''}-lines`}
            className='mt-1 tabular-nums'
            value={String(invoice.lineCount ?? 0)}
            readOnly
          />
        </AdminField>
        {invoice.issuedAt ? (
          <AdminField label='Issued at' htmlFor={`invoice-${invoice.id ?? ''}-issued-at`}>
            <Input
              id={`invoice-${invoice.id ?? ''}-issued-at`}
              className='mt-1'
              value={formatDate(invoice.issuedAt)}
              readOnly
            />
          </AdminField>
        ) : null}
        {invoice.voidedAt ? (
          <AdminField label='Voided at' htmlFor={`invoice-${invoice.id ?? ''}-voided-at`}>
            <Input
              id={`invoice-${invoice.id ?? ''}-voided-at`}
              className='mt-1'
              value={formatDate(invoice.voidedAt)}
              readOnly
            />
          </AdminField>
        ) : null}
        {isIssued ? (
          <AdminField
            label='Email recipients (comma-separated)'
            htmlFor={EMAIL_INPUT_ID}
            span='full'
            error={issuedInvoiceEmailError || undefined}
            errorId={`${EMAIL_INPUT_ID}-error`}
          >
            <Input
              id={EMAIL_INPUT_ID}
              className='mt-1 font-mono text-sm'
              autoComplete='off'
              value={issuedInvoiceEmailCsv}
              onChange={(e) => {
                issuedInvoiceEmailDirtyRef.current = true;
                setInvoiceEditorDirty(true);
                setIssuedInvoiceEmailCsv(e.target.value);
                setIssuedInvoiceEmailError('');
              }}
              disabled={editorBusy}
              placeholder='billing@example.com, accounts@example.com'
              aria-describedby={issuedInvoiceEmailError ? `${EMAIL_INPUT_ID}-error` : undefined}
            />
          </AdminField>
        ) : null}
      </AdminFieldGrid>
      {isIssued ? <ClientInvoicesRefundEditor currency={currency} busy={busy} refund={refund} /> : null}
    </AdminEditorPanel>
  );
}
