'use client';

import { useCallback, useMemo } from 'react';

import { ADMIN_LIST_PAGE_SIZE } from '@/lib/admin-list-query';
import { AdminApiError } from '@/lib/api-admin-client';
import { listAuditLogs, type AuditLog, type AuditLogsFilters } from '@/lib/audit-logs-api';
import { adminQueryKeys } from '@/lib/admin-query-keys';

import { usePaginatedList, type PaginatedFetcherParams } from './use-paginated-list';

export type AuditActionFilter = 'all' | 'INSERT' | 'UPDATE' | 'DELETE';

export type AuditLogsListFilters = {
  action: AuditActionFilter;
  table: string;
  email: string;
  timeRange: string;
};

const DEFAULT_FILTERS: AuditLogsListFilters = {
  action: 'all',
  table: 'all',
  email: '',
  timeRange: '24h',
};

function timestampFromRange(range: string): string | undefined {
  if (!range) {
    return undefined;
  }
  const now = new Date();
  switch (range) {
    case '1h':
      return new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    case '24h':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    default:
      return undefined;
  }
}

function toApiFilters(filters: AuditLogsListFilters): AuditLogsFilters {
  const apiFilters: AuditLogsFilters = {};
  if (filters.action !== 'all') {
    apiFilters.action = filters.action;
  }
  if (filters.table !== 'all') {
    apiFilters.table = filters.table;
  }
  const email = filters.email.trim();
  if (email) {
    apiFilters.email = email;
  }
  const since = timestampFromRange(filters.timeRange);
  if (since) {
    apiFilters.since = since;
  }
  return apiFilters;
}

/**
 * Audit log list whose filters apply as soon as they change, like every other
 * admin list: selects commit immediately and the free-text actor filter is
 * debounced by `usePaginatedList`.
 */
export function useAuditLogsList() {
  const fetcher = useCallback(
    async ({ cursor, limit, signal: _signal, ...filters }: PaginatedFetcherParams<AuditLogsListFilters>) => {
      try {
        const response = await listAuditLogs(toApiFilters(filters), cursor ?? undefined, limit);
        return { items: response.items, nextCursor: response.next_cursor ?? null };
      } catch (error) {
        if (error instanceof AdminApiError) {
          throw error;
        }
        throw new Error('Failed to load audit logs.');
      }
    },
    []
  );

  const list = usePaginatedList<AuditLog, AuditLogsListFilters>({
    fetcher,
    defaultFilters: DEFAULT_FILTERS,
    limit: ADMIN_LIST_PAGE_SIZE,
    errorPrefix: 'Failed to load audit logs',
    debounceKeys: ['email'],
    queryKey: adminQueryKeys.auditLogs.lists(),
  });
  const { items, isLoading, isLoadingMore, hasMore, error, loadMore, filters, setFilter } = list;

  return useMemo(
    () => ({
      items,
      isLoading,
      isLoadingMore,
      hasMore,
      error,
      loadMore,
      filters,
      setFilter,
    }),
    [error, filters, hasMore, isLoading, isLoadingMore, items, loadMore, setFilter]
  );
}
