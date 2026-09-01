'use client';

import Link from 'next/link';

import {
  ConversationIcon,
  InvoiceIcon,
  ServiceInstanceIcon,
} from '@/components/icons/action-icons';

const RELATED_LINK_CLASS =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400';

export interface RelatedRecordOpsLinksProps {
  salesHref: string;
  instancesHref: string;
  invoicesHref: string;
  hasSalesConversation: boolean;
  hasServiceInstance: boolean;
  hasInvoice: boolean;
}

export function RelatedRecordOpsLinks({
  salesHref,
  instancesHref,
  invoicesHref,
  hasSalesConversation,
  hasServiceInstance,
  hasInvoice,
}: RelatedRecordOpsLinksProps) {
  return (
    <>
      {hasSalesConversation ? (
        <Link
          href={salesHref}
          className={RELATED_LINK_CLASS}
          onClick={(event) => event.stopPropagation()}
          aria-label='Sales conversations'
          title='Sales conversations'
        >
          <ConversationIcon className='h-4 w-4 shrink-0' aria-hidden />
        </Link>
      ) : null}
      {hasServiceInstance ? (
        <Link
          href={instancesHref}
          className={RELATED_LINK_CLASS}
          onClick={(event) => event.stopPropagation()}
          aria-label='Service instances'
          title='Service instances'
        >
          <ServiceInstanceIcon className='h-4 w-4 shrink-0' aria-hidden />
        </Link>
      ) : null}
      {hasInvoice ? (
        <Link
          href={invoicesHref}
          className={RELATED_LINK_CLASS}
          onClick={(event) => event.stopPropagation()}
          aria-label='Invoices'
          title='Invoices'
        >
          <InvoiceIcon className='h-4 w-4 shrink-0' aria-hidden />
        </Link>
      ) : null}
    </>
  );
}
