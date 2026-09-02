'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  ensureAdminCatalog,
  getAdminCatalogEntry,
  invalidateAdminCatalog,
  subscribeAdminCatalog,
  type AdminCatalogKey,
} from '@/lib/admin-catalog-store';
import { listEntityTags, type EntityTagRef } from '@/lib/entity-api';
import { listAdminUsers } from '@/lib/users-api';
import { listAllLocations, listGeographicAreas } from '@/lib/services-api';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';
import type { AdminUser } from '@/types/leads';

function useCatalog<TItem>(
  key: AdminCatalogKey,
  fetcher: () => Promise<TItem[]>,
  options: { enabled?: boolean } = {}
) {
  const enabled = options.enabled ?? true;
  const entry = useSyncExternalStore(
    subscribeAdminCatalog,
    () => getAdminCatalogEntry<TItem>(key),
    () => getAdminCatalogEntry<TItem>(key)
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (entry.status === 'idle') {
      void ensureAdminCatalog(key, fetcher);
    }
  }, [key, fetcher, entry.status, enabled]);

  const refetch = useCallback(async () => {
    await ensureAdminCatalog(key, fetcher, { force: true });
  }, [key, fetcher]);

  return {
    items: entry.items,
    isLoading: entry.status === 'idle' || entry.status === 'loading',
    error: entry.error,
    refetch,
  };
}

function fetchEntityTags() {
  return listEntityTags();
}

function fetchAdminUsers() {
  return listAdminUsers().then((response) => response.items);
}

function fetchGeographicAreas() {
  return listGeographicAreas({ flat: true, activeOnly: true });
}

function fetchPickerLocations() {
  return listAllLocations();
}

export function useSharedEntityTags(options: { enabled?: boolean } = {}) {
  return useCatalog<EntityTagRef>('entityTags', fetchEntityTags, options);
}

export function useSharedAdminUsers() {
  return useCatalog<AdminUser>('adminUsers', fetchAdminUsers);
}

export function useSharedGeographicAreas() {
  return useCatalog<GeographicAreaSummary>('geographicAreas', fetchGeographicAreas);
}

export function useSharedPickerLocations() {
  return useCatalog<LocationSummary>('pickerLocations', fetchPickerLocations);
}

export function invalidateSharedEntityTags() {
  invalidateAdminCatalog('entityTags');
}

export function invalidateSharedPickerLocations() {
  invalidateAdminCatalog('pickerLocations');
}
