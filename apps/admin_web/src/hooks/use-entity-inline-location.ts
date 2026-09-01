'use client';

import { useCallback, useMemo, useState } from 'react';

import type { InlineLocationEmbeddedSummary } from '@/components/admin/locations/inline-location-editor';
import {
  EMPTY_INLINE_LOCATION_DRAFT,
  type InlineLocationDraft,
} from '@/components/admin/locations/inline-location-validation';
import { useGeocodeVenueAddress } from '@/hooks/use-geocode-venue-address';
import { useInlineLocationSave } from '@/hooks/use-inline-location-save';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';

export interface EntityLocationSummarySource {
  id: string;
  name?: string | null;
  address?: string | null;
  area_name?: string | null;
  area_id?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface UseEntityInlineLocationOptions {
  editorMode: 'create' | 'edit';
  selectedId: string | null;
  stateKeyPrefix: string;
  pendingLocationId: string | null;
  setPendingLocationId: (locationId: string | null) => void;
  optimisticLocationSummary: InlineLocationEmbeddedSummary | null;
  setOptimisticLocationSummary: (summary: InlineLocationEmbeddedSummary | null) => void;
  selectedLocationSummary: EntityLocationSummarySource | null | undefined;
  locations: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  refreshLocations: () => Promise<void> | void;
}

export type LocationSubmitResolution =
  | { status: 'abort' }
  | { status: 'ready'; locationId: string | null };

export function useEntityInlineLocation({
  editorMode,
  selectedId,
  stateKeyPrefix,
  pendingLocationId,
  setPendingLocationId,
  optimisticLocationSummary,
  setOptimisticLocationSummary,
  selectedLocationSummary,
  locations,
  geographicAreas,
  refreshLocations,
}: UseEntityInlineLocationOptions) {
  const [locationDraft, setLocationDraft] = useState<InlineLocationDraft>(EMPTY_INLINE_LOCATION_DRAFT);

  const inlineLocationStateKey =
    editorMode === 'create' ? `${stateKeyPrefix}-new` : `${stateKeyPrefix}:${selectedId ?? 'none'}`;

  const resolvedLocation = useMemo(() => {
    if (!pendingLocationId) {
      return null;
    }
    return locations.find((location) => location.id === pendingLocationId) ?? null;
  }, [locations, pendingLocationId]);

  const embeddedLocationSummary = useMemo((): InlineLocationEmbeddedSummary | null => {
    if (resolvedLocation) {
      return null;
    }
    if (!pendingLocationId) {
      return null;
    }
    if (optimisticLocationSummary && optimisticLocationSummary.id === pendingLocationId) {
      return optimisticLocationSummary;
    }
    const summary = selectedLocationSummary;
    if (summary && summary.id === pendingLocationId) {
      return {
        id: summary.id,
        name: summary.name ?? null,
        address: summary.address ?? null,
        areaName: summary.area_name ?? 'Unknown area',
        areaId: summary.area_id,
        lat: summary.lat ?? null,
        lng: summary.lng ?? null,
      };
    }
    return null;
  }, [resolvedLocation, pendingLocationId, optimisticLocationSummary, selectedLocationSummary]);

  function summaryFromLocationRow(location: LocationSummary): InlineLocationEmbeddedSummary {
    const areaName = geographicAreas.find((area) => area.id === location.areaId)?.name ?? 'Unknown area';
    return {
      id: location.id,
      name: location.name,
      address: location.address,
      areaName,
      areaId: location.areaId,
      lat: location.lat,
      lng: location.lng,
    };
  }

  const {
    status: locationSaveStatus,
    commitDraft,
    clearError: clearLocationSaveError,
  } = useInlineLocationSave(refreshLocations);
  const { geocode: geocodeLocation, isGeocoding: locationGeocoding } = useGeocodeVenueAddress();

  const onLocationDraftChange = useCallback((draft: InlineLocationDraft) => {
    setLocationDraft(draft);
  }, []);

  const resetLocationDraft = useCallback(() => {
    setLocationDraft(EMPTY_INLINE_LOCATION_DRAFT);
    clearLocationSaveError();
  }, [clearLocationSaveError]);

  function clearPendingLocation() {
    setPendingLocationId(null);
    setOptimisticLocationSummary(null);
    clearLocationSaveError();
  }

  async function commitLocationForSubmit(): Promise<LocationSubmitResolution> {
    if (locationDraft.isInvalid) {
      return { status: 'abort' };
    }
    if (locationDraft.isPersistable) {
      try {
        const committed = await commitDraft(locationDraft.existingLocationId, locationDraft);
        if (!committed) {
          return { status: 'abort' };
        }
        setPendingLocationId(committed.id);
        if (committed.created) {
          setOptimisticLocationSummary(summaryFromLocationRow(committed.created));
        }
        return { status: 'ready', locationId: committed.id };
      } catch {
        return { status: 'abort' };
      }
    }
    if (locationDraft.isEditing) {
      return { status: 'ready', locationId: locationDraft.isEmpty ? null : pendingLocationId };
    }
    return { status: 'ready', locationId: pendingLocationId };
  }

  const locationDraftInvalid = locationDraft.isInvalid || locationSaveStatus.isSaving;

  return {
    inlineLocationStateKey,
    resolvedLocation,
    embeddedLocationSummary,
    locationSaveStatus,
    locationGeocoding,
    geocodeLocation,
    clearLocationSaveError,
    clearPendingLocation,
    resetLocationDraft,
    onLocationDraftChange,
    commitLocationForSubmit,
    locationDraftInvalid,
    summaryFromLocationRow,
  };
}
