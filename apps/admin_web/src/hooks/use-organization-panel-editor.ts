'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { useAdminEntityOrganizations } from '@/hooks/use-admin-entity-organizations';
import { useEntityPanelEditorShell } from '@/hooks/use-entity-panel-editor-shell';
import { useEntityInlineLocation } from '@/hooks/use-entity-inline-location';
import { useEntityServiceLabels } from '@/hooks/use-entity-service-labels';
import { useExpandedRecordForm } from '@/hooks/use-expanded-record-form';
import type { InlineLocationEmbeddedSummary } from '@/components/admin/locations/inline-location-editor';
import { ADMIN_ORGANIZATION_QUERY_PARAM } from '@/lib/contact-related-links';
import { listAdminOrganizationServices } from '@/lib/entity-api';
import { contactEligibleForEntityMembership } from '@/lib/entity-contact-eligibility';
import {
  ORGANIZATION_RELATIONSHIP_TYPES,
  relationshipTypeForEditor,
} from '@/types/entity-relationship';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];
type AdminOrganization = ApiSchemas['AdminOrganization'];

export interface UseOrganizationPanelEditorInput {
  organizations: ReturnType<typeof useAdminEntityOrganizations>;
  locations: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  refreshLocations: () => Promise<void> | void;
  contactOptions: { id: string; label: string }[];
  contactsForMembership: {
    id: string;
    contact_type?: ApiSchemas['EntityContactType'];
    family_ids: string[];
    organization_ids: string[];
  }[];
}

export function useOrganizationPanelEditor({
  organizations,
  locations,
  geographicAreas,
  refreshLocations,
  contactOptions,
  contactsForMembership,
}: UseOrganizationPanelEditorInput) {
  const {
    organizations: rows,
    isLoading,
    isSaving,
    createOrganization,
    updateOrganization,
    addMember,
    removeMember,
    updateMember,
    deleteOrganization,
    relationshipOptions,
  } = organizations;

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
  } = useEntityPanelEditorShell({ paramName: ADMIN_ORGANIZATION_QUERY_PARAM });
  const [name, setName] = useState('');
  const [organizationType, setOrganizationType] =
    useState<ApiSchemas['EntityOrganizationType']>('company');
  const [relationshipType, setRelationshipType] =
    useState<ApiSchemas['EntityOrganizationRelationshipType']>('prospect');
  const [website, setWebsite] = useState('');
  const [pendingLocationId, setPendingLocationId] = useState<string | null>(null);
  const [optimisticLocationSummary, setOptimisticLocationSummary] =
    useState<InlineLocationEmbeddedSummary | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [memberContactId, setMemberContactId] = useState('');
  const [removeTarget, setRemoveTarget] = useState<{ memberId: string; label: string } | null>(
    null
  );

  const serviceLabels = useEntityServiceLabels(
    editorMode,
    selectedId,
    useCallback((entityId, signal) => listAdminOrganizationServices(entityId, signal), [])
  );

  const selected = useMemo(
    () => rows.find((o) => o.id === selectedId) ?? null,
    [rows, selectedId]
  );

  const location = useEntityInlineLocation({
    editorMode,
    selectedId,
    stateKeyPrefix: 'org',
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

  const locationLockedReadOnly = Boolean(location.resolvedLocation?.lockedFromPartnerOrg);
  const resetLocationDraft = location.resetLocationDraft;

  const clearForm = useCallback(() => {
    setName('');
    setOrganizationType('company');
    setRelationshipType('prospect');
    setWebsite('');
    setPendingLocationId(null);
    setOptimisticLocationSummary(null);
    resetLocationDraft();
    setTagIds([]);
    setActive(true);
    setMemberContactId('');
    clearDirty();
  }, [clearDirty, resetLocationDraft]);

  const applyRow = useCallback(
    (row: AdminOrganization) => {
      setName(row.name);
      setOrganizationType(row.organization_type);
      setRelationshipType(
        relationshipTypeForEditor(row.relationship_type, ORGANIZATION_RELATIONSHIP_TYPES)
      );
      setWebsite(row.website ?? '');
      setPendingLocationId(row.location_id ?? null);
      setOptimisticLocationSummary(null);
      resetLocationDraft();
      setTagIds([...row.tag_ids]);
      setActive(row.active);
      setMemberContactId('');
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

  const memberContactOptions = useMemo(() => {
    return contactOptions.filter((c) => {
      const row = contactsForMembership.find((x) => x.id === c.id);
      if (!row) {
        return true;
      }
      return contactEligibleForEntityMembership(row, selectedId, 'organization');
    });
  }, [contactOptions, contactsForMembership, selectedId]);

  async function handlePrimaryMemberChange(memberId: string, nextChecked: boolean): Promise<void> {
    if (!selected) {
      return;
    }
    try {
      await updateMember(selected.id, memberId, { is_primary_contact: nextChecked });
    } catch {
      // Retry preserved.
    }
  }

  async function handleSubmit(): Promise<void> {
    try {
      const resolved = await location.commitLocationForSubmit();
      if (resolved.status === 'abort') {
        return;
      }
      const loc = resolved.locationId;
      if (editorMode === 'create') {
        await createOrganization({
          name: name.trim(),
          organization_type: organizationType,
          relationship_type: relationshipType,
          website: website.trim() || null,
          location_id: loc,
          tag_ids: tagIds,
        });
        clearDirty();
        expanded.collapse();
        return;
      }
      if (!selected) {
        return;
      }
      await updateOrganization(selected.id, {
        name: name.trim(),
        organization_type: organizationType,
        relationship_type: relationshipType,
        website: website.trim() || null,
        location_id: loc,
        active,
        tag_ids: tagIds,
      });
      clearDirty();
    } catch {
      // Retry preserved.
    }
  }

  async function handleAddMember(): Promise<void> {
    if (!selected || !memberContactId.trim()) {
      return;
    }
    try {
      await addMember(selected.id, {
        contact_id: memberContactId.trim(),
        is_primary_contact: false,
      });
      setMemberContactId('');
    } catch {
      // Retry preserved.
    }
  }

  async function handleDeleteOrganization(row: AdminOrganization): Promise<void> {
    const confirmed = await requestConfirm({
      title: 'Delete organisation',
      description: `Permanently delete "${row.name}"? This removes the organisation from the database and cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    setDeleteActionError('');
    try {
      await deleteOrganization(row.id);
      if (selectedId === row.id) {
        clearDirty();
        expanded.collapse();
      }
    } catch (err) {
      setDeleteActionError(
        err instanceof Error ? err.message : 'Failed to delete organisation'
      );
    }
  }

  async function confirmRemoveMember() {
    if (!removeTarget || !selected) {
      setRemoveTarget(null);
      return;
    }
    try {
      await removeMember(selected.id, removeTarget.memberId);
    } finally {
      setRemoveTarget(null);
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
    relationshipType,
    setRelationshipType: track(setRelationshipType),
    relationshipOptions,
    website,
    setWebsite: track(setWebsite),
    tagIds,
    setTagIds: track(setTagIds),
    active,
    setActive: track(setActive),
    isSaving,
    serviceLabels,
    memberContactId,
    setMemberContactId,
    memberContactOptions,
    removeTarget,
    setRemoveTarget,
    location: {
      ...location,
      clearPendingLocation: () => {
        markDirty();
        location.clearPendingLocation();
      },
    },
    locationLockedReadOnly,
    handleSubmit,
    handleAddMember,
    handleDeleteOrganization,
    handlePrimaryMemberChange,
    confirmRemoveMember,
  };
}
