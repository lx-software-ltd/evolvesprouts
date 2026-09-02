'use client';

import { useCallback, useEffect } from 'react';

import { listEnrollments } from '@/lib/services-api';
import { DEFAULT_ENROLLMENT_LIST_FILTERS } from '@/types/services';
import type { Enrollment, EnrollmentListFilters } from '@/types/services';

import { usePaginatedList } from './use-paginated-list';

export function useEnrollmentList(serviceId: string | null, instanceId: string | null) {
  const fetcher = useCallback(
    async (
      params: EnrollmentListFilters & { cursor: string | null; limit: number; signal: AbortSignal }
    ) => {
      if (!serviceId || !instanceId) {
        return { items: [] as Enrollment[], nextCursor: null, totalCount: 0 };
      }
      return listEnrollments(
        serviceId,
        instanceId,
        {
          status: params.status || undefined,
          cursor: params.cursor,
          limit: params.limit,
        },
        params.signal
      );
    },
    [instanceId, serviceId]
  );

  const list = usePaginatedList<Enrollment, EnrollmentListFilters>({
    fetcher,
    defaultFilters: DEFAULT_ENROLLMENT_LIST_FILTERS,
    errorPrefix: 'Failed to load enrollments',
    fetchOnMount: Boolean(serviceId && instanceId),
  });

  useEffect(() => {
    if (!serviceId || !instanceId) {
      list.setItems([]);
    }
  }, [instanceId, list.setItems, serviceId]);

  const upsertEnrollmentInList = useCallback(
    (enrollment: Enrollment) => {
      list.setItems((current) => {
        const index = current.findIndex((row) => row.id === enrollment.id);
        if (index === -1) {
          return [enrollment, ...current];
        }
        const next = [...current];
        next[index] = enrollment;
        return next;
      });
    },
    [list.setItems]
  );

  const removeEnrollmentFromList = useCallback(
    (enrollmentId: string) => {
      list.setItems((current) => current.filter((row) => row.id !== enrollmentId));
    },
    [list.setItems]
  );

  return {
    enrollments: list.items,
    filters: list.filters,
    setFilter: list.setFilter,
    isLoading: list.isLoading,
    isLoadingMore: list.isLoadingMore,
    error: list.error,
    refetch: list.refetch,
    loadMore: list.loadMore,
    hasMore: list.hasMore,
    totalCount: list.totalCount ?? 0,
    upsertEnrollmentInList,
    removeEnrollmentFromList,
  };
}
