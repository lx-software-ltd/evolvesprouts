'use client';

import { useSharedVenueLocations } from './use-admin-catalog';

export function useLocationList() {
  const catalog = useSharedVenueLocations();
  return {
    locations: catalog.items,
    isLoading: catalog.isLoading,
    error: catalog.error,
    refetch: catalog.refetch,
  };
}
