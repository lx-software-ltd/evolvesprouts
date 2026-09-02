'use client';

import { StatusBanner } from '@/components/status-banner';
import { ClientInvoicesAllocateEditor } from '@/components/admin/finance/client-invoices-allocate-editor';
import { ClientInvoicesBillingDialogs } from '@/components/admin/finance/client-invoices-billing-dialogs';
import { ClientInvoicesDraftEditor } from '@/components/admin/finance/client-invoices-draft-editor';
import { ClientInvoicesInvoicesTable } from '@/components/admin/finance/client-invoices-invoices-table';
import { ClientInvoicesManualPaymentEditor } from '@/components/admin/finance/client-invoices-manual-payment-editor';
import { ClientInvoicesPaymentsTable } from '@/components/admin/finance/client-invoices-payments-table';
import { ClientInvoicesRefundEditor } from '@/components/admin/finance/client-invoices-refund-editor';
import { NO_ENROLLMENT_OPTION_VALUE } from '@/components/admin/finance/client-invoices-utils';
import { useClientInvoicesPanel } from '@/hooks/use-client-invoices-panel';

export { NO_ENROLLMENT_OPTION_VALUE };

export function ClientInvoicesPanel() {
  const {
    ids,
    currency,
    banners,
    busy,
    draft,
    invoices,
    manualPayment,
    payments,
    allocate,
    refund,
    dialogs,
  } = useClientInvoicesPanel();
  const { actionMessage, actionError } = banners;

  return (
    <div className='space-y-6'>
      {actionMessage ? (
        <StatusBanner variant='success' title='Billing'>
          {actionMessage}
        </StatusBanner>
      ) : null}
      {actionError ? (
        <StatusBanner variant='error' title='Billing'>
          {actionError}
        </StatusBanner>
      ) : null}

      <ClientInvoicesDraftEditor
        ids={ids}
        currency={currency}
        busy={busy}
        draft={draft}
      />
      <ClientInvoicesInvoicesTable
        ids={ids}
        currency={currency}
        busy={busy}
        invoices={invoices}
      />
      <ClientInvoicesManualPaymentEditor
        currency={currency}
        busy={busy}
        manualPayment={manualPayment}
      />
      <ClientInvoicesPaymentsTable
        currency={currency}
        busy={busy}
        payments={payments}
      />
      <ClientInvoicesAllocateEditor
        currency={currency}
        busy={busy}
        allocate={allocate}
      />
      <ClientInvoicesRefundEditor
        currency={currency}
        busy={busy}
        refund={refund}
      />
      <ClientInvoicesBillingDialogs busy={busy} dialogs={dialogs} />
    </div>
  );
}
