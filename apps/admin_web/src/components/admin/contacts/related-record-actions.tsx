import { ConversationIcon, InvoiceIcon, ServiceInstanceIcon } from '@/components/icons/action-icons';
import type { AdminRowAction } from '@/components/ui/admin-row-actions';

export interface RelatedRecordActionsInput {
  salesHref: string;
  instancesHref: string;
  invoicesHref: string;
  hasSalesConversation: boolean;
  hasServiceInstance: boolean;
  hasInvoice: boolean;
}

/**
 * Operations-column links to a party's related records (sales conversations,
 * service instances, invoices). Each link is present only when the record
 * exists, so rows without history keep a shorter action list.
 */
export function relatedRecordActions({
  salesHref,
  instancesHref,
  invoicesHref,
  hasSalesConversation,
  hasServiceInstance,
  hasInvoice,
}: RelatedRecordActionsInput): AdminRowAction[] {
  return [
    {
      key: 'sales',
      label: 'Sales conversations',
      icon: <ConversationIcon className='h-4 w-4' />,
      href: salesHref,
      hidden: !hasSalesConversation,
    },
    {
      key: 'instances',
      label: 'Service instances',
      icon: <ServiceInstanceIcon className='h-4 w-4' />,
      href: instancesHref,
      hidden: !hasServiceInstance,
    },
    {
      key: 'invoices',
      label: 'Invoices',
      icon: <InvoiceIcon className='h-4 w-4' />,
      href: invoicesHref,
      hidden: !hasInvoice,
    },
  ];
}
