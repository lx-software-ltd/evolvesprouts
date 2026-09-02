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
import { adminQueryKeys } from '@/lib/admin-query-keys';
import { DEFAULT_PARTNER_FILTERS, type PartnerFilters } from '@/types/partners';
import type { components } from '@/types/generated/admin-api.generated';

import { useListMutate } from './use-list-mutate';
import { usePaginatedList } from './use-paginated-list';

type ApiSchemas = components['schemas'];

const PARTNER_RELATIONSHIP: readonly ApiSchemas['EntityOrganizationRelationshipType'][] = ['partner'];

export function usePartners() {
  const fetcher = useCallback(
    (params: PartnerFilters & { cursor: string | null; limit: number; signal: AbortSignal }) =>
      listAdminOrganizations(
        {
          query: params.query,
          active: params.active || undefined,
          relationshipType: 'partner',
          cursor: params.cursor,
          limit: params.limit,
        },
        params.signal
      ),
    []
  );

  const list = usePaginatedList({
    fetcher,
    defaultFilters: DEFAULT_PARTNER_FILTERS,
    errorPrefix: 'Failed to load partners',
    queryKey: adminQueryKeys.partners.lists(),
    debounceKeys: ['query'],
  });

  const { isSaving, mutate } = useListMutate(list.refetch);

  const createPartner = useCallback(
    async (payload: ApiSchemas['CreateAdminOrganizationRequest']) =>
      mutate(async () => createAdminOrganization(payload)),
    [mutate]
  );

  const updatePartner = useCallback(
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

  const deletePartner = useCallback(
    async (organizationId: string) => mutate(async () => deleteAdminOrganization(organizationId)),
    [mutate]
  );

  return {
    partners: list.items,
    filters: list.filters,
    setFilter: list.setFilter,
    isLoading: list.isLoading,
    isLoadingMore: list.isLoadingMore,
    hasMore: list.hasMore,
    error: list.error,
    loadMore: list.loadMore,
    totalCount: list.totalCount,
    isSaving,
    createPartner,
    updatePartner,
    addMember,
    removeMember,
    updateMember,
    deletePartner,
    refetch: list.refetch,
    relationshipOptions: PARTNER_RELATIONSHIP,
  };
}
