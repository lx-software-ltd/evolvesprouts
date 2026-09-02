'use client';

import { useCallback } from 'react';

import {
  createLocation,
  deleteLocation,
  listLocations,
  updateLocation,
  updateLocationPartial,
} from '@/lib/services-api';
import { DEFAULT_VENUE_FILTERS } from '@/types/services';
import type { LocationSummary, VenueFilters } from '@/types/services';

import type { components } from '@/types/generated/admin-api.generated';

import { invalidateSharedPickerLocations, useSharedGeographicAreas } from './use-admin-catalog';
import { useListMutate } from './use-list-mutate';
import { usePaginatedList } from './use-paginated-list';

type ApiSchemas = components['schemas'];

const DEBOUNCE_KEYS: (keyof VenueFilters)[] = ['search'];

export function useVenues(options: { onMutationSuccess?: () => void | Promise<void> } = {}) {
  const { onMutationSuccess } = options;
  const areasCatalog = useSharedGeographicAreas();
  const geographicAreas = areasCatalog.items;
  const areasLoading = areasCatalog.isLoading;
  const areasError = areasCatalog.error;

  const fetcher = useCallback(
    (params: VenueFilters & { cursor: string | null; limit: number; signal: AbortSignal }) =>
      listLocations(
        {
          cursor: params.cursor,
          limit: params.limit,
          areaId: params.areaId || undefined,
          search: params.search,
          excludeAddresses: true,
        },
        params.signal
      ),
    []
  );

  const list = usePaginatedList<LocationSummary, VenueFilters>({
    fetcher,
    defaultFilters: DEFAULT_VENUE_FILTERS,
    errorPrefix: 'Failed to load venues',
    debounceKeys: DEBOUNCE_KEYS,
  });

  const { refetch } = list;
  const { isSaving, mutate } = useListMutate(refetch, {
    onAfterSuccess: async () => {
      invalidateSharedPickerLocations();
      await onMutationSuccess?.();
    },
  });

  const createVenue = useCallback(
    async (payload: ApiSchemas['CreateLocationRequest']) => mutate(async () => createLocation(payload)),
    [mutate]
  );

  const updateVenue = useCallback(
    async (venueId: string, payload: ApiSchemas['UpdateLocationRequest']) =>
      mutate(async () => updateLocation(venueId, payload)),
    [mutate]
  );

  const updateVenuePartial = useCallback(
    async (venueId: string, payload: ApiSchemas['PartialUpdateLocationRequest']) =>
      mutate(async () => updateLocationPartial(venueId, payload)),
    [mutate]
  );

  const deleteVenue = useCallback(
    async (venueId: string) =>
      mutate(async () => {
        await deleteLocation(venueId);
      }),
    [mutate]
  );

  return {
    venues: list.items,
    filters: list.filters,
    setFilter: list.setFilter,
    isLoading: list.isLoading,
    isLoadingMore: list.isLoadingMore,
    isSaving,
    error: list.error || areasError,
    refetch: list.refetch,
    loadMore: list.loadMore,
    hasMore: list.hasMore,
    totalCount: list.totalCount,
    createVenue,
    updateVenue,
    updateVenuePartial,
    deleteVenue,
    geographicAreas,
    areasLoading,
  };
}
