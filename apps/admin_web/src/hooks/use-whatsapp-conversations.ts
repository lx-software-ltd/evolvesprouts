'use client';

import { useCallback } from 'react';

import type { RelatedPartyQuery } from '@/lib/contact-related-links';
import { listWhatsAppConversations, type WhatsAppConversationSummary } from '@/lib/whatsapp-api';

import { usePaginatedList } from './use-paginated-list';

export type WhatsAppConversationFilters = {
  q: string;
};

const DEFAULT_FILTERS: WhatsAppConversationFilters = { q: '' };

export function useWhatsAppConversations(party: RelatedPartyQuery = {}) {
  const contactId = party.contactId ?? '';
  const familyId = party.familyId ?? '';
  const organizationId = party.organizationId ?? '';
  const fetcher = useCallback(
    (params: WhatsAppConversationFilters & {
      cursor: string | null;
      limit: number;
      signal: AbortSignal;
    }) =>
      listWhatsAppConversations(
        {
          cursor: params.cursor,
          limit: params.limit,
          q: params.q,
          contactId,
          familyId,
          organizationId,
        },
        params.signal
      ),
    [contactId, familyId, organizationId]
  );

  const list = usePaginatedList<WhatsAppConversationSummary, WhatsAppConversationFilters>({
    fetcher,
    defaultFilters: DEFAULT_FILTERS,
    errorPrefix: 'Failed to load WhatsApp conversations',
    debounceKeys: ['q'],
  });

  return {
    conversations: list.items,
    filters: list.filters,
    setFilter: list.setFilter,
    isLoading: list.isLoading,
    isLoadingMore: list.isLoadingMore,
    error: list.error,
    refetch: list.refetch,
    loadMore: list.loadMore,
    hasMore: list.hasMore,
    totalCount: list.totalCount,
  };
}
