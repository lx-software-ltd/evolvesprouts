'use client';

import { useCallback } from 'react';

import {
  addAdminOrganizationMember,
  createAdminOrganization,
  deleteAdminOrganization,
  listAdminOrganizations,
  patchAdminOrganizationMember,
  removeAdminOrganizationMember,
  updateAdminOrganization,
} from '@/lib/entity-api';
import {
  DEFAULT_FAMILY_ORG_LIST_FILTERS,
  type EntityListFilters,
} from '@/types/entity-list';
import { ADMIN_LIST_PAGE_SIZE } from '@/lib/admin-list-query';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import { ORGANIZATION_RELATIONSHIP_TYPES } from '@/types/entity-relationship';
import type { components } from '@/types/generated/admin-api.generated';

import { useListMutate } from './use-list-mutate';
import { usePaginatedList } from './use-paginated-list';

type ApiSchemas = components['schemas'];

export function useAdminEntityOrganizations() {
  const fetcher = useCallback(
    (params: EntityListFilters & { cursor: string | null; limit: number; signal: AbortSignal }) =>
      listAdminOrganizations(
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
    errorPrefix: 'Failed to load organizations',
    queryKey: adminQueryKeys.organizations.lists(),
    debounceKeys: ['query'],
    limit: ADMIN_LIST_PAGE_SIZE,
  });

  const { isSaving, mutate } = useListMutate(list.refetch);

  const createOrganization = useCallback(
    async (payload: ApiSchemas['CreateAdminOrganizationRequest']) =>
      mutate(async () => createAdminOrganization(payload)),
    [mutate]
  );

  const updateOrganization = useCallback(
    async (organizationId: string, payload: ApiSchemas['UpdateAdminOrganizationRequest']) =>
      mutate(async () => updateAdminOrganization(organizationId, payload)),
    [mutate]
  );

  const addMember = useCallback(
    async (organizationId: string, payload: ApiSchemas['AddOrganizationMemberRequest']) =>
      mutate(async () => addAdminOrganizationMember(organizationId, payload)),
    [mutate]
  );

  const removeMember = useCallback(
    async (organizationId: string, memberId: string) =>
      mutate(async () => removeAdminOrganizationMember(organizationId, memberId)),
    [mutate]
  );

  const updateMember = useCallback(
    async (
      organizationId: string,
      memberId: string,
      payload: ApiSchemas['UpdateOrganizationMemberRequest']
    ) => mutate(async () => patchAdminOrganizationMember(organizationId, memberId, payload)),
    [mutate]
  );

  const deleteOrganization = useCallback(
    async (organizationId: string) =>
      mutate(async () => deleteAdminOrganization(organizationId)),
    [mutate]
  );

  return {
    organizations: list.items,
    filters: list.filters,
    setFilter: list.setFilter,
    isLoading: list.isLoading,
    isLoadingMore: list.isLoadingMore,
    hasMore: list.hasMore,
    error: list.error,
    loadMore: list.loadMore,
    totalCount: list.totalCount,
    isSaving,
    createOrganization,
    updateOrganization,
    addMember,
    removeMember,
    updateMember,
    deleteOrganization,
    refetch: list.refetch,
    relationshipOptions: ORGANIZATION_RELATIONSHIP_TYPES,
  };
}
