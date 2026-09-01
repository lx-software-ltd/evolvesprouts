'use client';

import { useCallback } from 'react';

import type { RelatedPartyQuery } from '@/lib/contact-related-links';
import {
  listMetaConversations,
  type MetaChannel,
  type MetaConversationSummary,
} from '@/lib/meta-api';

import { usePaginatedList } from './use-paginated-list';

export type MetaConversationFilters = {
  q: string;
};

const DEFAULT_FILTERS: MetaConversationFilters = { q: '' };

export function useMetaConversations(channel: MetaChannel, party: RelatedPartyQuery = {}) {
  const contactId = party.contactId ?? '';
  const familyId = party.familyId ?? '';
  const organizationId = party.organizationId ?? '';
  const fetcher = useCallback(
    (params: MetaConversationFilters & {
      cursor: string | null;
      limit: number;
      signal: AbortSignal;
    }) =>
      listMetaConversations(
        {
          cursor: params.cursor,
          limit: params.limit,
          q: params.q,
          channel,
          contactId,
          familyId,
          organizationId,
        },
        params.signal
      ),
    [channel, contactId, familyId, organizationId]
  );

  const list = usePaginatedList<MetaConversationSummary, MetaConversationFilters>({
    fetcher,
    defaultFilters: DEFAULT_FILTERS,
    errorPrefix: 'Failed to load conversations',
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
