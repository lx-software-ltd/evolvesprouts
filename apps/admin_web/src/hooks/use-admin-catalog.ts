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
import { listAdminUsers, listInstructorUsers } from '@/lib/users-api';
import {
  listAllLocations,
  listAllVenueAndPartnerLocations,
  listGeographicAreas,
} from '@/lib/services-api';
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

function fetchInstructorUsers() {
  return listInstructorUsers().then((response) => response.items);
}

function fetchGeographicAreas() {
  return listGeographicAreas({ flat: true, activeOnly: true });
}

function fetchPickerLocations() {
  return listAllLocations();
}

function fetchVenueLocations() {
  return listAllVenueAndPartnerLocations();
}

export function useSharedEntityTags(options: { enabled?: boolean } = {}) {
  return useCatalog<EntityTagRef>('entityTags', fetchEntityTags, options);
}

export function useSharedAdminUsers() {
  return useCatalog<AdminUser>('adminUsers', fetchAdminUsers);
}

export function useSharedInstructorUsers(options: { enabled?: boolean } = {}) {
  return useCatalog<AdminUser>('instructorUsers', fetchInstructorUsers, options);
}

export function useSharedGeographicAreas() {
  return useCatalog<GeographicAreaSummary>('geographicAreas', fetchGeographicAreas);
}

/** Every location (venues plus family / organisation addresses) for address pickers. */
export function useSharedPickerLocations() {
  return useCatalog<LocationSummary>('pickerLocations', fetchPickerLocations);
}

/** Standalone venues plus active partner locations, for service instance venues. */
export function useSharedVenueLocations() {
  return useCatalog<LocationSummary>('venueLocations', fetchVenueLocations);
}

export function invalidateSharedEntityTags() {
  invalidateAdminCatalog('entityTags');
}

/** Location mutations affect both location catalogs. */
export function invalidateSharedLocations() {
  invalidateAdminCatalog('pickerLocations');
  invalidateAdminCatalog('venueLocations');
}
