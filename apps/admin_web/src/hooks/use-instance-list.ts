'use client';

import { useCallback } from 'react';

import { listAllInstances, listInstances } from '@/lib/services-api';
import { DEFAULT_INSTANCE_LIST_FILTERS } from '@/types/services';
import type { InstanceListFilters, ServiceInstance } from '@/types/services';
import { usePaginatedList } from './use-paginated-list';

export interface InstanceListGlobalOptions {
  /** When true and serviceId is null, load via GET /v1/admin/services/instances. */
  listAllInstances?: boolean;
  /** Optional service UUID filter (only used with listAllInstances). */
  filterServiceId?: string | null;
  /** Optional service type filter (only used with listAllInstances). */
  filterServiceType?: string | null;
  /** Optional contact UUID filter (only used with listAllInstances). */
  filterContactId?: string | null;
  /** Optional family UUID filter (only used with listAllInstances). */
  filterFamilyId?: string | null;
  /** Optional organisation UUID filter (only used with listAllInstances). */
  filterOrganizationId?: string | null;
}

export function useInstanceList(
  serviceId: string | null,
  globalOptions: InstanceListGlobalOptions | null = null
) {
  const shouldListAll = Boolean(globalOptions?.listAllInstances);
  const filterServiceId = globalOptions?.filterServiceId?.trim() ?? '';
  const filterServiceType = globalOptions?.filterServiceType?.trim() ?? '';
  const filterContactId = globalOptions?.filterContactId?.trim() ?? '';
  const filterFamilyId = globalOptions?.filterFamilyId?.trim() ?? '';
  const filterOrganizationId = globalOptions?.filterOrganizationId?.trim() ?? '';
  const fetcher = useCallback(
    async ({
      status,
      cursor,
      limit,
      signal,
    }: InstanceListFilters & { cursor: string | null; limit: number; signal: AbortSignal }) => {
      const useGlobalList = !serviceId && shouldListAll;
      if (!serviceId && !useGlobalList) {
        return {
          items: [] as ServiceInstance[],
          nextCursor: null,
          totalCount: 0,
        };
      }
      return useGlobalList
        ? listAllInstances(
            {
              status: status || undefined,
              cursor,
              limit,
              serviceType: filterServiceType || undefined,
              serviceId: filterServiceId || undefined,
              contactId: filterContactId || undefined,
              familyId: filterFamilyId || undefined,
              organizationId: filterOrganizationId || undefined,
            },
            signal
          )
        : listInstances(
            serviceId as string,
            {
              status: status || undefined,
              cursor,
              limit,
            },
            signal
          );
    },
    [
      serviceId,
      shouldListAll,
      filterServiceId,
      filterServiceType,
      filterContactId,
      filterFamilyId,
      filterOrganizationId,
    ]
  );

  const list = usePaginatedList<ServiceInstance, InstanceListFilters>({
    fetcher,
    defaultFilters: DEFAULT_INSTANCE_LIST_FILTERS,
    errorPrefix: 'Failed to load service instances',
  });

  return {
    instances: list.items,
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
