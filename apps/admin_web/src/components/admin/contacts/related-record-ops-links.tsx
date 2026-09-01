'use client';

import Link from 'next/link';

import {
  ConversationIcon,
  InvoiceIcon,
  ServiceInstanceIcon,
} from '@/components/icons/action-icons';
import { ADMIN_OPS_ICON_LINK_CLASS } from '@/components/ui/admin-data-table';

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
          className={ADMIN_OPS_ICON_LINK_CLASS}
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
          className={ADMIN_OPS_ICON_LINK_CLASS}
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
          className={ADMIN_OPS_ICON_LINK_CLASS}
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
