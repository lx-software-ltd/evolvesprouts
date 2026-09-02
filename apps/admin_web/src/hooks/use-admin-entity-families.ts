'use client';

import { useCallback } from 'react';

import {
  addAdminFamilyMember,
  createAdminFamily,
  deleteAdminFamily,
  listAdminFamilies,
  patchAdminFamilyMember,
  removeAdminFamilyMember,
  updateAdminFamily,
} from '@/lib/entity-api';
import {
  DEFAULT_FAMILY_ORG_LIST_FILTERS,
  type EntityListFilters,
} from '@/types/entity-list';
import { ADMIN_LIST_PAGE_SIZE } from '@/lib/admin-list-query';
import type { components } from '@/types/generated/admin-api.generated';

import { useListMutate } from './use-list-mutate';
import { usePaginatedList } from './use-paginated-list';

type ApiSchemas = components['schemas'];

export function useAdminEntityFamilies() {
  const fetcher = useCallback(
    (params: EntityListFilters & { cursor: string | null; limit: number; signal: AbortSignal }) =>
      listAdminFamilies(
        {
          query: params.query,
          active: params.active || undefined,
          cursor: params.cursor,
          limit: params.limit,
        },
        params.signal
      ),
    []
  );

  const list = usePaginatedList({
    fetcher,
    defaultFilters: DEFAULT_FAMILY_ORG_LIST_FILTERS,
    errorPrefix: 'Failed to load families',
    debounceKeys: ['query'],
    limit: ADMIN_LIST_PAGE_SIZE,
  });

  const { isSaving, mutate } = useListMutate(list.refetch);

  const createFamily = useCallback(
    async (payload: ApiSchemas['CreateAdminFamilyRequest']) =>
      mutate(async () => createAdminFamily(payload)),
    [mutate]
  );

  const updateFamily = useCallback(
    async (familyId: string, payload: ApiSchemas['UpdateAdminFamilyRequest']) =>
      mutate(async () => updateAdminFamily(familyId, payload)),
    [mutate]
  );

  const addMember = useCallback(
    async (familyId: string, payload: ApiSchemas['AddFamilyMemberRequest']) =>
      mutate(async () => addAdminFamilyMember(familyId, payload)),
    [mutate]
  );

  const removeMember = useCallback(
    async (familyId: string, memberId: string) =>
      mutate(async () => removeAdminFamilyMember(familyId, memberId)),
    [mutate]
  );

  const updateMember = useCallback(
    async (
      familyId: string,
      memberId: string,
      payload: ApiSchemas['UpdateFamilyMemberRequest']
    ) => mutate(async () => patchAdminFamilyMember(familyId, memberId, payload)),
    [mutate]
  );

  const deleteFamily = useCallback(
    async (familyId: string) => mutate(async () => deleteAdminFamily(familyId)),
    [mutate]
  );

  return {
    families: list.items,
    filters: list.filters,
    setFilter: list.setFilter,
    isLoading: list.isLoading,
    isLoadingMore: list.isLoadingMore,
    hasMore: list.hasMore,
    error: list.error,
    loadMore: list.loadMore,
    totalCount: list.totalCount,
    isSaving,
    createFamily,
    updateFamily,
    addMember,
    removeMember,
    updateMember,
    deleteFamily,
    refetch: list.refetch,
  };
}
