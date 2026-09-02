'use client';

import { useCallback } from 'react';

import {
  createAdminContact,
  deleteAdminContact,
  listAdminContacts,
  updateAdminContact,
} from '@/lib/entity-api';
import { DEFAULT_CONTACT_LIST_FILTERS, type EntityListFilters } from '@/types/entity-list';
import type { components } from '@/types/generated/admin-api.generated';

import { useListMutate } from './use-list-mutate';
import { usePaginatedList } from './use-paginated-list';

type ApiSchemas = components['schemas'];

export function useAdminEntityContacts() {
  const fetcher = useCallback(
    (params: EntityListFilters & { cursor: string | null; limit: number; signal: AbortSignal }) =>
      listAdminContacts(
        {
          query: params.query,
          active: params.active || undefined,
          contact_type: params.contact_type || undefined,
          cursor: params.cursor,
          limit: params.limit,
        },
        params.signal
      ),
    []
  );

  const {
    items: contacts,
    setItems: setContactRows,
    filters,
    setFilter,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
    totalCount,
    refetch: refetchContacts,
  } = usePaginatedList({
    fetcher,
    defaultFilters: DEFAULT_CONTACT_LIST_FILTERS,
    errorPrefix: 'Failed to load contacts',
    debounceKeys: ['query'],
    limit: 25,
  });

  const { isSaving, mutate } = useListMutate(refetchContacts);

  const createContact = useCallback(
    async (payload: ApiSchemas['CreateAdminContactRequest']) =>
      mutate(async () => createAdminContact(payload)),
    [mutate]
  );

  const updateContact = useCallback(
    async (contactId: string, payload: ApiSchemas['UpdateAdminContactRequest']) =>
      mutate(async () => updateAdminContact(contactId, payload)),
    [mutate]
  );

  const deleteContact = useCallback(
    async (contactId: string) => mutate(async () => deleteAdminContact(contactId)),
    [mutate]
  );

  const patchContactStandaloneNoteCount = useCallback(
    (contactId: string, standaloneNoteCount: number) => {
      setContactRows((current) =>
        current.map((row) =>
          row.id === contactId ? { ...row, standalone_note_count: standaloneNoteCount } : row
        )
      );
    },
    [setContactRows]
  );

  return {
    contacts,
    filters,
    setFilter,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
    totalCount,
    isSaving,
    createContact,
    updateContact,
    deleteContact,
    patchContactStandaloneNoteCount,
    refetch: refetchContacts,
  };
}
