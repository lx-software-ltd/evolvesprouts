'use client';

import { useLocationSearchParam } from '@/hooks/use-query-tab-state';
import {
  ADMIN_FAMILY_QUERY_PARAM,
  ADMIN_ORGANIZATION_QUERY_PARAM,
  relatedPartyFilterKey,
  type RelatedPartyQuery,
} from '@/lib/contact-related-links';
import { ADMIN_CONTACT_QUERY_PARAM } from '@/lib/inbox-conversation-name';

export function useRelatedPartySearchParams(): RelatedPartyQuery & { partyFilterKey: string } {
  const contactId = useLocationSearchParam(ADMIN_CONTACT_QUERY_PARAM);
  const familyId = useLocationSearchParam(ADMIN_FAMILY_QUERY_PARAM);
  const organizationId = useLocationSearchParam(ADMIN_ORGANIZATION_QUERY_PARAM);
  const party = { contactId, familyId, organizationId };
  return {
    ...party,
    partyFilterKey: relatedPartyFilterKey(party),
  };
}
