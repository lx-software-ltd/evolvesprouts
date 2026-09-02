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
  const {
    items,
    filters,
    setFilter,
    setItems,
    isLoading,
    isLoadingMore,
    error,
    refetch,
    loadMore,
    hasMore,
    totalCount,
  } = list;

  useEffect(() => {
    if (!serviceId || !instanceId) {
      setItems([]);
    }
  }, [instanceId, serviceId, setItems]);

  const upsertEnrollmentInList = useCallback(
    (enrollment: Enrollment) => {
      setItems((current) => {
        const index = current.findIndex((row) => row.id === enrollment.id);
        if (index === -1) {
          return [enrollment, ...current];
        }
        const next = [...current];
        next[index] = enrollment;
        return next;
      });
    },
    [setItems]
  );

  const removeEnrollmentFromList = useCallback(
    (enrollmentId: string) => {
      setItems((current) => current.filter((row) => row.id !== enrollmentId));
    },
    [setItems]
  );

  return {
    enrollments: items,
    filters,
    setFilter,
    isLoading,
    isLoadingMore,
    error,
    refetch,
    loadMore,
    hasMore,
    totalCount: totalCount ?? 0,
    upsertEnrollmentInList,
    removeEnrollmentFromList,
  };
}
