'use client';

import { useCallback } from 'react';

import {
  deleteCompletionCertificate,
  issueCompletionCertificate,
  listCompletionCertificates,
  voidCompletionCertificate,
  type CompletionCertificateDraftPayload,
  type CompletionCertificateListParams,
} from '@/lib/completion-certificates-api';
import { adminQueryKeys } from '@/lib/admin-query-keys';

import type { components } from '@/types/generated/admin-api.generated';

import { useListMutate } from './use-list-mutate';
import { usePaginatedList } from './use-paginated-list';

type CompletionCertificate = components['schemas']['CompletionCertificate'];

export type CompletionCertificateFilters = {
  contactId: string;
  serviceId: string;
  instanceId: string;
  status: '' | components['schemas']['CompletionCertificateStatus'];
};

export const DEFAULT_COMPLETION_CERTIFICATE_FILTERS: CompletionCertificateFilters = {
  contactId: '',
  serviceId: '',
  instanceId: '',
  status: '',
};

export function useCompletionCertificates() {
  const fetcher = useCallback(
    (params: CompletionCertificateFilters & { cursor: string | null; limit: number; signal: AbortSignal }) => {
      const apiParams: CompletionCertificateListParams = { limit: params.limit };
      if (params.contactId.trim()) {
        apiParams.contactId = params.contactId.trim();
      }
      if (params.serviceId.trim()) {
        apiParams.serviceId = params.serviceId.trim();
      }
      if (params.instanceId.trim()) {
        apiParams.instanceId = params.instanceId.trim();
      }
      if (params.status) {
        apiParams.status = params.status;
      }
      if (params.cursor) {
        apiParams.cursor = params.cursor;
      }
      return listCompletionCertificates(apiParams, params.signal);
    },
    [],
  );

  const list = usePaginatedList<CompletionCertificate, CompletionCertificateFilters>({
    fetcher,
    defaultFilters: DEFAULT_COMPLETION_CERTIFICATE_FILTERS,
    errorPrefix: 'Failed to load certificates',
    queryKey: adminQueryKeys.certificates.lists(),
  });

  const { refetch } = list;
  const { isSaving, mutate } = useListMutate(refetch);

  const issueCertificate = useCallback(
    async (payload: CompletionCertificateDraftPayload) =>
      mutate(async () => issueCompletionCertificate(payload)),
    [mutate],
  );

  const voidCertificate = useCallback(
    async (id: string) => mutate(async () => voidCompletionCertificate(id)),
    [mutate],
  );

  const deleteCertificate = useCallback(
    async (id: string) =>
      mutate(async () => {
        await deleteCompletionCertificate(id);
      }),
    [mutate],
  );

  return {
    certificates: list.items,
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
    issueCertificate,
    voidCertificate,
    deleteCertificate,
  };
}
