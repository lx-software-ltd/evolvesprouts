'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { usePartners } from '@/hooks/use-partners';
import { useEntityInlineLocation } from '@/hooks/use-entity-inline-location';
import { useEntityPanelEditorShell } from '@/hooks/use-entity-panel-editor-shell';
import { useExpandedRecordForm } from '@/hooks/use-expanded-record-form';
import type { InlineLocationEmbeddedSummary } from '@/components/admin/locations/inline-location-editor';
import { INSTANCE_SLUG_PATTERN } from '@/lib/slug-utils';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];
type AdminOrganization = ApiSchemas['AdminOrganization'];

/** Query parameter that mirrors the expanded partner row (`?partner=<id>` or `?partner=new`). */
export const ADMIN_PARTNER_QUERY_PARAM = 'partner';

export interface UsePartnerPanelEditorInput {
  partners: ReturnType<typeof usePartners>;
  locations: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  refreshLocations: () => Promise<void> | void;
}

/**
 * Editor state for the table-first Partners panel: the expanded row drives
 * create/edit mode, field setters flag the editor dirty, and the inline
 * location draft feeds the shared dirty check so row switches ask first.
 */
export function usePartnerPanelEditor({
  partners,
  locations,
  geographicAreas,
  refreshLocations,
}: UsePartnerPanelEditorInput) {
  const { partners: rows, isLoading, isSaving, createPartner, updatePartner, deletePartner } = partners;

  const {
    confirmDialogProps,
    requestConfirm,
    deleteActionError,
    setDeleteActionError,
    editorMode,
    selectedId,
    expanded,
    externalDirtyRef,
    clearDirty,
    markDirty,
    track,
  } = useEntityPanelEditorShell({ paramName: ADMIN_PARTNER_QUERY_PARAM });
  const [name, setName] = useState('');
  const [organizationType, setOrganizationType] =
    useState<ApiSchemas['EntityOrganizationType']>('company');
  const [partnerKey, setPartnerKey] = useState('');
  const [legalName, setLegalName] = useState('');
  const [website, setWebsite] = useState('');
  const [pendingLocationId, setPendingLocationId] = useState<string | null>(null);
  const [optimisticLocationSummary, setOptimisticLocationSummary] =
    useState<InlineLocationEmbeddedSummary | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);

  const selected = useMemo(() => rows.find((o) => o.id === selectedId) ?? null, [rows, selectedId]);

  const location = useEntityInlineLocation({
    editorMode,
    selectedId,
    stateKeyPrefix: 'partner',
    pendingLocationId,
    setPendingLocationId,
    optimisticLocationSummary,
    setOptimisticLocationSummary,
    selectedLocationSummary: selected?.location_summary,
    locations,
    geographicAreas,
    refreshLocations,
  });

  const locationDraftDirty = location.locationDraftDirty;
  useEffect(() => {
    externalDirtyRef.current = () => locationDraftDirty;
  }, [externalDirtyRef, locationDraftDirty]);

  const resetLocationDraft = location.resetLocationDraft;

  const clearForm = useCallback(() => {
    setName('');
    setOrganizationType('company');
    setPartnerKey('');
    setLegalName('');
    setWebsite('');
    setPendingLocationId(null);
    setOptimisticLocationSummary(null);
    resetLocationDraft();
    setTagIds([]);
    setActive(true);
    clearDirty();
  }, [clearDirty, resetLocationDraft]);

  const applyRow = useCallback(
    (row: AdminOrganization) => {
      setName(row.name);
      setOrganizationType(row.organization_type);
      setPartnerKey(row.partner_key ?? '');
      setLegalName(row.legal_name ?? '');
      setWebsite(row.website ?? '');
      setPendingLocationId(row.location_id ?? null);
      setOptimisticLocationSummary(null);
      resetLocationDraft();
      setTagIds([...row.tag_ids]);
      setActive(row.active);
      clearDirty();
    },
    [clearDirty, resetLocationDraft]
  );

  useExpandedRecordForm<AdminOrganization>({
    expandedId: expanded.expandedId,
    rows,
    isLoading,
    applyRow,
    reset: clearForm,
    collapse: expanded.collapse,
  });

  const partnerKeyTrimmed = partnerKey.trim().toLowerCase();
  const partnerKeyPatternInvalid = Boolean(partnerKeyTrimmed) && !INSTANCE_SLUG_PATTERN.test(partnerKeyTrimmed);
  const canSubmit = Boolean(name.trim()) && !location.locationDraftInvalid && !partnerKeyPatternInvalid;

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) {
      return;
    }
    try {
      const resolved = await location.commitLocationForSubmit();
      if (resolved.status === 'abort') {
        return;
      }
      const loc = resolved.locationId;
      const shared = {
        name: name.trim(),
        organization_type: organizationType,
        relationship_type: 'partner' as const,
        partner_key: partnerKey.trim() || null,
        legal_name: legalName.trim() || null,
        website: website.trim() || null,
        location_id: loc,
        tag_ids: tagIds,
      };
      if (editorMode === 'create') {
        await createPartner(shared);
        clearDirty();
        expanded.collapse();
        return;
      }
      if (!selected) {
        return;
      }
      await updatePartner(selected.id, { ...shared, active });
      clearDirty();
    } catch {
      // Keep inline form state visible to let users retry.
    }
  }

  async function handleDeletePartner(row: AdminOrganization): Promise<void> {
    const confirmed = await requestConfirm({
      title: 'Delete partner',
      description: `Permanently delete "${row.name}"? This removes the partner organisation from the database and cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    setDeleteActionError('');
    try {
      await deletePartner(row.id);
      if (selectedId === row.id) {
        clearDirty();
        expanded.collapse();
      }
    } catch (err) {
      setDeleteActionError(err instanceof Error ? err.message : 'Failed to delete partner');
    }
  }

  return {
    confirmDialogProps,
    deleteActionError,
    setDeleteActionError,
    expanded,
    editorMode,
    selectedId,
    selected,
    name,
    setName: track(setName),
    organizationType,
    setOrganizationType: track(setOrganizationType),
    partnerKey,
    setPartnerKey: track(setPartnerKey),
    partnerKeyPatternInvalid,
    legalName,
    setLegalName: track(setLegalName),
    website,
    setWebsite: track(setWebsite),
    tagIds,
    setTagIds: track(setTagIds),
    active,
    setActive: track(setActive),
    isSaving,
    canSubmit,
    location: {
      ...location,
      clearPendingLocation: () => {
        markDirty();
        location.clearPendingLocation();
      },
    },
    handleSubmit,
    handleDeletePartner,
  };
}
