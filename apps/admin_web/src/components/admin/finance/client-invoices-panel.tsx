'use client';

import { StatusBanner } from '@/components/status-banner';
import { ClientInvoicesBillingDialogs } from '@/components/admin/finance/client-invoices-billing-dialogs';
import { ClientInvoicesInvoicesTable } from '@/components/admin/finance/client-invoices-invoices-table';
import { ClientInvoicesPaymentsTable } from '@/components/admin/finance/client-invoices-payments-table';
import { NO_ENROLLMENT_OPTION_VALUE } from '@/components/admin/finance/client-invoices-utils';
import { useClientInvoicesPanel } from '@/hooks/use-client-invoices-panel';

export { NO_ENROLLMENT_OPTION_VALUE };

/**
 * Two stacked record tables: customer invoices (draft row creates an invoice;
 * expanded issued invoices email and refund) and customer payments (draft row
 * records a manual payment; expanded payments edit and allocate).
 */
export function ClientInvoicesPanel() {
  const { ids, currency, banners, busy, draft, invoices, manualPayment, payments, allocate, refund, dialogs } =
    useClientInvoicesPanel();
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

      <ClientInvoicesInvoicesTable
        ids={ids}
        currency={currency}
        busy={busy}
        invoices={invoices}
        draft={draft}
        refund={refund}
      />
      <ClientInvoicesPaymentsTable
        currency={currency}
        busy={busy}
        payments={payments}
        manualPayment={manualPayment}
        allocate={allocate}
      />
      <ClientInvoicesBillingDialogs busy={busy} dialogs={dialogs} />
    </div>
  );
}
