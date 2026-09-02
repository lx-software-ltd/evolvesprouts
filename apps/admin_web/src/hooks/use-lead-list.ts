'use client';

import { useCallback } from 'react';

import { listLeads } from '@/lib/leads-api';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import { DEFAULT_LEAD_LIST_FILTERS } from '@/types/leads';
import type { LeadListFilters, LeadSummary } from '@/types/leads';

import { usePaginatedList, type PaginatedFetcherParams } from './use-paginated-list';

const DEBOUNCE_KEYS: (keyof LeadListFilters)[] = ['search'];

/** One page of the leads list; shared by the hook and section prefetch. */
export function fetchLeadsPage(params: PaginatedFetcherParams<LeadListFilters>) {
  return listLeads(params, params.signal);
}

export function useLeadList() {
  const list = usePaginatedList<LeadSummary, LeadListFilters>({
    fetcher: fetchLeadsPage,
    defaultFilters: DEFAULT_LEAD_LIST_FILTERS,
    errorPrefix: 'Failed to load leads',
    queryKey: adminQueryKeys.leads.lists(),
    debounceKeys: DEBOUNCE_KEYS,
  });

  return {
    leads: list.items,
    filters: list.filters,
    setFilter: list.setFilter,
    clearFilters: list.clearFilters,
    isLoading: list.isLoading,
    isLoadingMore: list.isLoadingMore,
    error: list.error,
    refetch: list.refetch,
    loadMore: list.loadMore,
    hasMore: list.hasMore,
    totalCount: list.totalCount,
  };
}
