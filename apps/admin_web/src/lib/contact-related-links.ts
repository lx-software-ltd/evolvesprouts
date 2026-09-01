import { ADMIN_CONTACT_QUERY_PARAM } from '@/lib/inbox-conversation-name';

export type SalesInboxTab = 'whatsapp' | 'instagram' | 'messenger';

export function adminSalesConversationsDeepLink(
  contactId: string,
  channel: SalesInboxTab | string | null | undefined
): string {
  const tab = isSalesInboxTab(channel) ? channel : 'whatsapp';
  return `/sales?tab=${tab}&${ADMIN_CONTACT_QUERY_PARAM}=${encodeURIComponent(contactId)}`;
}

export function adminServiceInstancesDeepLink(contactId: string): string {
  return `/services?${ADMIN_CONTACT_QUERY_PARAM}=${encodeURIComponent(contactId)}`;
}

export function adminContactInvoicesDeepLink(contactId: string): string {
  return `/finance?${ADMIN_CONTACT_QUERY_PARAM}=${encodeURIComponent(contactId)}`;
}

export function isSalesInboxTab(value: string | null | undefined): value is SalesInboxTab {
  return value === 'whatsapp' || value === 'instagram' || value === 'messenger';
}
