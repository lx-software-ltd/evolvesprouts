import { ADMIN_CONTACT_QUERY_PARAM } from '@/lib/inbox-conversation-name';
import { CUSTOMER_INVOICE_ASSET_TAG } from '@/types/assets';

export const ADMIN_FAMILY_QUERY_PARAM = 'family';
export const ADMIN_ORGANIZATION_QUERY_PARAM = 'organization';

export type SalesInboxTab = 'whatsapp' | 'instagram' | 'messenger';

export type RelatedPartyKind = 'contact' | 'family' | 'organization';

export type RelatedPartyQuery = {
  contactId?: string;
  familyId?: string;
  organizationId?: string;
};

const PARTY_QUERY_PARAM: Record<RelatedPartyKind, string> = {
  contact: ADMIN_CONTACT_QUERY_PARAM,
  family: ADMIN_FAMILY_QUERY_PARAM,
  organization: ADMIN_ORGANIZATION_QUERY_PARAM,
};

const PARTY_API_PARAM: Record<RelatedPartyKind, 'contact_id' | 'family_id' | 'organization_id'> = {
  contact: 'contact_id',
  family: 'family_id',
  organization: 'organization_id',
};

export function relatedPartyFilterKey(party: RelatedPartyQuery): string {
  return party.contactId?.trim() || party.familyId?.trim() || party.organizationId?.trim() || '';
}

export function appendRelatedPartyQuery(query: URLSearchParams, party: RelatedPartyQuery): void {
  const contactId = party.contactId?.trim() ?? '';
  const familyId = party.familyId?.trim() ?? '';
  const organizationId = party.organizationId?.trim() ?? '';
  if (contactId) {
    query.set(PARTY_API_PARAM.contact, contactId);
  }
  if (familyId) {
    query.set(PARTY_API_PARAM.family, familyId);
  }
  if (organizationId) {
    query.set(PARTY_API_PARAM.organization, organizationId);
  }
}

function partySearch(kind: RelatedPartyKind, id: string): string {
  return `${PARTY_QUERY_PARAM[kind]}=${encodeURIComponent(id)}`;
}

export function adminPartySalesConversationsDeepLink(
  kind: RelatedPartyKind,
  id: string,
  channel: SalesInboxTab | string | null | undefined
): string {
  const tab = isSalesInboxTab(channel) ? channel : 'whatsapp';
  return `/sales?tab=${tab}&${partySearch(kind, id)}`;
}

export function adminPartyServiceInstancesDeepLink(kind: RelatedPartyKind, id: string): string {
  return `/services?${partySearch(kind, id)}`;
}

export function adminPartyInvoicesDeepLink(partyName: string): string {
  const params = new URLSearchParams();
  params.set('tag', CUSTOMER_INVOICE_ASSET_TAG);
  const query = partyName.trim();
  if (query) {
    params.set('query', query);
  }
  return `/assets?${params.toString()}`;
}

export function adminSalesConversationsDeepLink(
  contactId: string,
  channel: SalesInboxTab | string | null | undefined
): string {
  return adminPartySalesConversationsDeepLink('contact', contactId, channel);
}

export function adminServiceInstancesDeepLink(contactId: string): string {
  return adminPartyServiceInstancesDeepLink('contact', contactId);
}

export function adminContactInvoicesDeepLink(partyName: string): string {
  return adminPartyInvoicesDeepLink(partyName);
}

export function isSalesInboxTab(value: string | null | undefined): value is SalesInboxTab {
  return value === 'whatsapp' || value === 'instagram' || value === 'messenger';
}
