'use client';

import { useCallback } from 'react';

import { listServices } from '@/lib/services-api';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import { DEFAULT_SERVICE_LIST_FILTERS } from '@/types/services';
import type { ServiceListFilters, ServiceSummary } from '@/types/services';

import { usePaginatedList } from './use-paginated-list';

const DEBOUNCE_KEYS: (keyof ServiceListFilters)[] = ['search'];

export function useServiceList() {
  const fetcher = useCallback(
    (params: ServiceListFilters & { cursor: string | null; limit: number; signal: AbortSignal }) =>
      listServices(params, params.signal),
    []
  );

  const list = usePaginatedList<ServiceSummary, ServiceListFilters>({
    fetcher,
    defaultFilters: DEFAULT_SERVICE_LIST_FILTERS,
    errorPrefix: 'Failed to load services',
    queryKey: adminQueryKeys.services.lists(),
    debounceKeys: DEBOUNCE_KEYS,
  });

  return {
    services: list.items,
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
