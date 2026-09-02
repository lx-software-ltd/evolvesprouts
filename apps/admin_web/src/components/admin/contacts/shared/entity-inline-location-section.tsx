'use client';

import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import {
  InlineLocationEditor,
  type InlineLocationEmbeddedSummary,
} from '@/components/admin/locations/inline-location-editor';
import type { InlineLocationDraft } from '@/components/admin/locations/inline-location-validation';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';

export interface EntityInlineLocationSectionProps {
  sectionId: string;
  stateKey: string;
  location: LocationSummary | null;
  embeddedSummary: InlineLocationEmbeddedSummary | null;
  areas: GeographicAreaSummary[];
  areasLoading: boolean;
  isSaving: boolean;
  isGeocoding: boolean;
  saveError: string;
  allowClearWhenLocked?: boolean;
  lockedSummaryExtra?: string | null;
  onDraftChange: (draft: InlineLocationDraft) => void;
  onClear: () => void;
  onGeocode: NonNullable<Parameters<typeof InlineLocationEditor>[0]['onGeocode']>;
}

export function EntityInlineLocationSection({
  sectionId,
  stateKey,
  location,
  embeddedSummary,
  areas,
  areasLoading,
  isSaving,
  isGeocoding,
  saveError,
  allowClearWhenLocked,
  lockedSummaryExtra,
  onDraftChange,
  onClear,
  onGeocode,
}: EntityInlineLocationSectionProps) {
  return (
    <AdminDisclosure id={sectionId} title='Location'>
      <InlineLocationEditor
        stateKey={stateKey}
        location={location}
        embeddedSummary={embeddedSummary}
        areas={areas}
        areasLoading={areasLoading}
        canModify
        hideLabel
        allowClearWhenLocked={allowClearWhenLocked}
        lockedSummaryExtra={lockedSummaryExtra}
        isSaving={isSaving}
        isGeocoding={isGeocoding}
        saveError={saveError}
        onDraftChange={onDraftChange}
        onClear={onClear}
        onGeocode={onGeocode}
      />
    </AdminDisclosure>
  );
}
