'use client';

import { useCallback } from 'react';

import type { AdminSectionKey } from '@/lib/admin-nav';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import { DEFAULT_CONTACT_LIST_FILTERS } from '@/types/entity-list';
import { DEFAULT_LEAD_LIST_FILTERS } from '@/types/leads';

import { fetchAdminContactsPage } from './use-admin-entity-contacts';
import { fetchLeadsPage } from './use-lead-list';
import { prefetchPaginatedList } from './use-paginated-list';

/**
 * First-page prefetch per admin section, keyed exactly like the section's
 * list hook (same `queryKey` prefix and default filters). Sections whose
 * landing list depends on URL state are omitted rather than guessed.
 */
const SECTION_PREFETCHERS: Partial<Record<AdminSectionKey, () => Promise<void>>> = {
  contacts: () =>
    prefetchPaginatedList({
      queryKey: adminQueryKeys.contacts.lists(),
      filters: DEFAULT_CONTACT_LIST_FILTERS,
      fetcher: fetchAdminContactsPage,
    }),
  sales: () =>
    prefetchPaginatedList({
      queryKey: adminQueryKeys.leads.lists(),
      filters: DEFAULT_LEAD_LIST_FILTERS,
      fetcher: fetchLeadsPage,
    }),
};

export function prefetchAdminSection(sectionKey: string): Promise<void> {
  const prefetch = SECTION_PREFETCHERS[sectionKey as AdminSectionKey];
  return prefetch ? prefetch() : Promise.resolve();
}

/** Stable callback for nav hover/focus intent; errors are swallowed by the prefetcher. */
export function usePrefetchAdminSection() {
  return useCallback((sectionKey: string) => {
    void prefetchAdminSection(sectionKey);
  }, []);
}
