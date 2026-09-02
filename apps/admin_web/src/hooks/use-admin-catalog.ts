'use client';

import { useCallback } from 'react';

import { hashKey, useQuery } from '@tanstack/react-query';

import { getAdminQueryClient } from '@/lib/admin-query-client';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import { listEntityTags, type EntityTagRef } from '@/lib/entity-api';
import { listAdminUsers, listInstructorUsers } from '@/lib/users-api';
import {
  listAllLocations,
  listAllVenueAndPartnerLocations,
  listGeographicAreas,
} from '@/lib/services-api';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';
import type { AdminUser } from '@/types/leads';

import { toErrorMessage } from './hook-errors';

/** Reference data changes rarely; keep it fresh for the whole session. */
const CATALOG_STALE_TIME_MS = 10 * 60_000;
const EMPTY_ITEMS: never[] = [];

function useCatalog<TItem>(
  queryKey: readonly unknown[],
  fetcher: () => Promise<TItem[]>,
  options: { enabled?: boolean } = {}
) {
  const enabled = options.enabled ?? true;
  const queryClient = getAdminQueryClient();
  const query = useQuery<TItem[], unknown>(
    {
      queryKey,
      queryFn: fetcher,
      enabled,
      staleTime: CATALOG_STALE_TIME_MS,
    },
    queryClient
  );

  const keyHash = hashKey(queryKey);
  const refetch = useCallback(async () => {
    try {
      await queryClient.fetchQuery({ queryKey, queryFn: fetcher, staleTime: 0, retry: false });
    } catch {
      // Surfaced through `error` below.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key factories return fresh arrays; compare by hash
  }, [queryClient, fetcher, keyHash]);

  return {
    items: (query.data ?? EMPTY_ITEMS) as TItem[],
    isLoading: enabled && query.isPending,
    error: query.error ? toErrorMessage(query.error, 'Failed to load catalog.') : '',
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
  return useCatalog<EntityTagRef>(adminQueryKeys.catalog.entityTags(), fetchEntityTags, options);
}

export function useSharedAdminUsers() {
  return useCatalog<AdminUser>(adminQueryKeys.catalog.adminUsers(), fetchAdminUsers);
}

export function useSharedInstructorUsers(options: { enabled?: boolean } = {}) {
  return useCatalog<AdminUser>(
    adminQueryKeys.catalog.instructorUsers(),
    fetchInstructorUsers,
    options
  );
}

export function useSharedGeographicAreas() {
  return useCatalog<GeographicAreaSummary>(
    adminQueryKeys.catalog.geographicAreas(),
    fetchGeographicAreas
  );
}

/** Every location (venues plus family / organisation addresses) for address pickers. */
export function useSharedPickerLocations() {
  return useCatalog<LocationSummary>(
    adminQueryKeys.catalog.pickerLocations(),
    fetchPickerLocations
  );
}

/** Standalone venues plus active partner locations, for service instance venues. */
export function useSharedVenueLocations() {
  return useCatalog<LocationSummary>(adminQueryKeys.catalog.venueLocations(), fetchVenueLocations);
}

export function invalidateSharedEntityTags() {
  void getAdminQueryClient().invalidateQueries({ queryKey: adminQueryKeys.catalog.entityTags() });
}

/** Location mutations affect both location catalogs. */
export function invalidateSharedLocations() {
  const queryClient = getAdminQueryClient();
  void queryClient.invalidateQueries({ queryKey: adminQueryKeys.catalog.pickerLocations() });
  void queryClient.invalidateQueries({ queryKey: adminQueryKeys.catalog.venueLocations() });
}
