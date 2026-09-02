'use client';

import { useCallback } from 'react';

import { createAdminVendor, listAdminVendors, updateAdminVendor } from '@/lib/vendors-api';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import { DEFAULT_VENDOR_FILTERS } from '@/types/vendors';
import type { Vendor, VendorFilters } from '@/types/vendors';
import type { components } from '@/types/generated/admin-api.generated';

import { useListMutate } from './use-list-mutate';
import { usePaginatedList } from './use-paginated-list';

type ApiSchemas = components['schemas'];

export function useVendors() {
  const fetcher = useCallback(
    (params: VendorFilters & { cursor: string | null; limit: number; signal: AbortSignal }) =>
      listAdminVendors(params, params.signal),
    []
  );

  const list = usePaginatedList<Vendor, VendorFilters>({
    fetcher,
    defaultFilters: DEFAULT_VENDOR_FILTERS,
    errorPrefix: 'Failed to load vendors',
    queryKey: adminQueryKeys.vendors.lists(),
    debounceKeys: ['query'],
  });

  const { isSaving, mutate } = useListMutate(list.refetch);

  const createVendor = useCallback(
    async (payload: ApiSchemas['CreateAdminOrganizationRequest']) =>
      mutate(async () => createAdminVendor(payload)),
    [mutate]
  );

  const updateVendor = useCallback(
    async (vendorId: string, payload: ApiSchemas['UpdateAdminOrganizationRequest']) =>
      mutate(async () => updateAdminVendor(vendorId, payload)),
    [mutate]
  );

  return {
    vendors: list.items,
    filters: list.filters,
    setFilter: list.setFilter,
    isLoading: list.isLoading,
    isLoadingMore: list.isLoadingMore,
    hasMore: list.hasMore,
    error: list.error,
    loadMore: list.loadMore,
    totalCount: list.totalCount,
    isSaving,
    createVendor,
    updateVendor,
    refetch: list.refetch,
  };
}
