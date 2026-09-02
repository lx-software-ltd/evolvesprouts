'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { AdminApiError } from '@/lib/api-admin-client';
import { listAuditLogs, type AuditLogsFilters } from '@/lib/audit-logs-api';

import { usePaginatedList } from './use-paginated-list';

export type AuditActionFilter = 'all' | 'INSERT' | 'UPDATE' | 'DELETE';

export type AuditLogsDraftFilters = {
  action: AuditActionFilter;
  table: string;
  email: string;
  recordId: string;
  timeRange: string;
};

const DEFAULT_DRAFT: AuditLogsDraftFilters = {
  action: 'all',
  table: 'all',
  email: '',
  recordId: '',
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

function toApiFilters(draft: AuditLogsDraftFilters): AuditLogsFilters {
  const filters: AuditLogsFilters = {};
  if (draft.action !== 'all') {
    filters.action = draft.action;
  }
  if (draft.table !== 'all') {
    filters.table = draft.table;
  }
  const email = draft.email.trim();
  if (email) {
    filters.email = email;
  }
  if (draft.recordId.trim()) {
    filters.record_id = draft.recordId.trim();
  }
  const since = timestampFromRange(draft.timeRange);
  if (since) {
    filters.since = since;
  }
  return filters;
}

export function useAuditLogsList() {
  const [draft, setDraft] = useState<AuditLogsDraftFilters>(DEFAULT_DRAFT);
  const appliedRef = useRef<AuditLogsDraftFilters>(DEFAULT_DRAFT);

  const filtersInvalid = Boolean(draft.recordId.trim() && draft.table === 'all');

  const fetcher = useCallback(
    async (params: { cursor: string | null; limit: number; signal: AbortSignal }) => {
      const applied = appliedRef.current;
      if (applied.recordId.trim() && applied.table === 'all') {
        return { items: [], nextCursor: null };
      }
      try {
        const response = await listAuditLogs(toApiFilters(applied), params.cursor ?? undefined, params.limit);
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

  const list = usePaginatedList({
    fetcher,
    defaultFilters: {},
    limit: 25,
    errorPrefix: 'Failed to load audit logs',
  });
  const { items, isLoading, isLoadingMore, hasMore, error, loadMore, refetch } = list;

  const applyFilters = useCallback(() => {
    if (filtersInvalid) {
      return;
    }
    appliedRef.current = draft;
    void refetch();
  }, [draft, filtersInvalid, refetch]);

  const clearFilters = useCallback(() => {
    setDraft(DEFAULT_DRAFT);
    appliedRef.current = DEFAULT_DRAFT;
    void refetch();
  }, [refetch]);

  const setDraftField = useCallback(
    <TKey extends keyof AuditLogsDraftFilters>(key: TKey, value: AuditLogsDraftFilters[TKey]) => {
      setDraft((current) => ({ ...current, [key]: value }));
    },
    []
  );

  return useMemo(
    () => ({
      items,
      isLoading,
      isLoadingMore,
      hasMore,
      error,
      loadMore,
      draft,
      setDraftField,
      filtersInvalid,
      applyFilters,
      clearFilters,
    }),
    [
      applyFilters,
      clearFilters,
      draft,
      error,
      filtersInvalid,
      hasMore,
      isLoading,
      isLoadingMore,
      items,
      loadMore,
      setDraftField,
    ]
  );
}
