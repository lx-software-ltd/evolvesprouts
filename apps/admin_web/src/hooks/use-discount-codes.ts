'use client';

import { useCallback } from 'react';

import {
  createDiscountCode,
  deleteDiscountCode,
  listDiscountCodes,
  updateDiscountCode,
} from '@/lib/services-api';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import { DEFAULT_DISCOUNT_CODE_FILTERS } from '@/types/services';
import type { DiscountCode, DiscountCodeFilters } from '@/types/services';

import type { components } from '@/types/generated/admin-api.generated';

import { useListMutate, type ListMutateOptions } from './use-list-mutate';
import { usePaginatedList } from './use-paginated-list';

type ApiSchemas = components['schemas'];

const DEBOUNCE_KEYS: (keyof DiscountCodeFilters)[] = ['search'];

export function useDiscountCodes() {
  const fetcher = useCallback(
    (params: DiscountCodeFilters & { cursor: string | null; limit: number; signal: AbortSignal }) =>
      listDiscountCodes(params, params.signal),
    []
  );

  const list = usePaginatedList<DiscountCode, DiscountCodeFilters>({
    fetcher,
    defaultFilters: DEFAULT_DISCOUNT_CODE_FILTERS,
    errorPrefix: 'Failed to load discount codes',
    queryKey: adminQueryKeys.discountCodes.lists(),
    debounceKeys: DEBOUNCE_KEYS,
  });

  const { refetch } = list;
  const { isSaving, mutate } = useListMutate(refetch);

  const createCode = useCallback(
    async (
      payload: ApiSchemas['CreateDiscountCodeRequest'],
      options: ListMutateOptions = {},
    ) => mutate(async () => createDiscountCode(payload), options),
    [mutate],
  );

  const updateCode = useCallback(
    async (codeId: string, payload: ApiSchemas['UpdateDiscountCodeRequest']) =>
      mutate(async () => updateDiscountCode(codeId, payload)),
    [mutate]
  );

  const deleteCode = useCallback(
    async (codeId: string) =>
      mutate(async () => {
        await deleteDiscountCode(codeId);
      }),
    [mutate]
  );

  return {
    codes: list.items,
    filters: list.filters,
    setFilter: list.setFilter,
    isLoading: list.isLoading,
    isLoadingMore: list.isLoadingMore,
    isSaving,
    error: list.error,
    refetch: list.refetch,
    loadMore: list.loadMore,
    hasMore: list.hasMore,
    totalCount: list.totalCount,
    createCode,
    updateCode,
    deleteCode,
  };
}
