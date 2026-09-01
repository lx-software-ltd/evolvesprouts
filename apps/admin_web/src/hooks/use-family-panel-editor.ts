'use client';

import { useCallback, useMemo, useState, type MouseEvent } from 'react';

import type { useAdminEntityFamilies } from '@/hooks/use-admin-entity-families';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useEntityInlineLocation } from '@/hooks/use-entity-inline-location';
import { useEntityServiceLabels } from '@/hooks/use-entity-service-labels';
import type { InlineLocationEmbeddedSummary } from '@/components/admin/locations/inline-location-editor';
import { listAdminFamilyServices } from '@/lib/entity-api';
import { contactEligibleForEntityMembership } from '@/lib/entity-contact-eligibility';
import {
  FAMILY_RELATIONSHIP_TYPES,
  relationshipTypeForEditor,
} from '@/types/entity-relationship';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export interface UseFamilyPanelEditorInput {
  families: ReturnType<typeof useAdminEntityFamilies>;
  locations: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  refreshLocations: () => Promise<void> | void;
  contactOptions: { id: string; label: string }[];
  contactsForMembership: {
    id: string;
    contact_type: ApiSchemas['EntityContactType'];
    family_ids: string[];
    organization_ids: string[];
  }[];
}

export function useFamilyPanelEditor({
  families,
  locations,
  geographicAreas,
  refreshLocations,
  contactOptions,
  contactsForMembership,
}: UseFamilyPanelEditorInput) {
  const {
    families: rows,
    isSaving,
    createFamily,
    updateFamily,
    addMember,
    removeMember,
    updateMember,
    deleteFamily,
  } = families;

  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [deleteActionError, setDeleteActionError] = useState('');

  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [familyName, setFamilyName] = useState('');
  const [relationshipType, setRelationshipType] =
    useState<(typeof FAMILY_RELATIONSHIP_TYPES)[number]>('prospect');
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
    useCallback((entityId, signal) => listAdminFamilyServices(entityId, signal), [])
  );

  const selected = useMemo(
    () => rows.find((f) => f.id === selectedId) ?? null,
    [rows, selectedId]
  );

  const location = useEntityInlineLocation({
    editorMode,
    selectedId,
    stateKeyPrefix: 'family',
    pendingLocationId,
    setPendingLocationId,
    optimisticLocationSummary,
    setOptimisticLocationSummary,
    selectedLocationSummary: selected?.location_summary,
    locations,
    geographicAreas,
    refreshLocations,
  });

  const memberContactOptions = useMemo(() => {
    return contactOptions.filter((c) => {
      const row = contactsForMembership.find((x) => x.id === c.id);
      if (!row) {
        return true;
      }
      return contactEligibleForEntityMembership(row, selectedId, 'family');
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

  async function resetCreateForm() {
    setEditorMode('create');
    setSelectedId(null);
    setFamilyName('');
    setRelationshipType('prospect');
    setPendingLocationId(null);
    setOptimisticLocationSummary(null);
    location.resetLocationDraft();
    setTagIds([]);
    setActive(true);
    setMemberContactId('');
  }

  async function handleSubmit(): Promise<void> {
    try {
      const resolved = await location.commitLocationForSubmit();
      if (resolved.status === 'abort') {
        return;
      }
      const loc = resolved.locationId;
      if (editorMode === 'create') {
        await createFamily({
          family_name: familyName.trim(),
          relationship_type: relationshipType,
          location_id: loc,
          tag_ids: tagIds,
        });
        await resetCreateForm();
        return;
      }
      if (!selected) {
        return;
      }
      await updateFamily(selected.id, {
        family_name: familyName.trim(),
        relationship_type: relationshipType,
        location_id: loc,
        active,
        tag_ids: tagIds,
      });
    } catch {
      // Keep form state for retry.
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

  async function handleDeleteFamily(
    row: ApiSchemas['AdminFamily'],
    clickEvent: MouseEvent<HTMLButtonElement>
  ): Promise<void> {
    clickEvent.stopPropagation();
    const confirmed = await requestConfirm({
      title: 'Delete family',
      description: `Permanently delete "${row.family_name}"? This removes the family from the database and cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    setDeleteActionError('');
    try {
      await deleteFamily(row.id);
      if (selectedId === row.id) {
        await resetCreateForm();
      }
    } catch (err) {
      setDeleteActionError(err instanceof Error ? err.message : 'Failed to delete family');
    }
  }

  function selectRow(id: string) {
    const row = rows.find((f) => f.id === id);
    if (!row) {
      return;
    }
    setSelectedId(id);
    setEditorMode('edit');
    setFamilyName(row.family_name);
    setRelationshipType(
      relationshipTypeForEditor(row.relationship_type, FAMILY_RELATIONSHIP_TYPES)
    );
    setPendingLocationId(row.location_id ?? null);
    setOptimisticLocationSummary(null);
    location.resetLocationDraft();
    setTagIds([...row.tag_ids]);
    setActive(row.active);
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
    editorMode,
    selectedId,
    selected,
    familyName,
    setFamilyName,
    relationshipType,
    setRelationshipType,
    tagIds,
    setTagIds,
    active,
    setActive,
    isSaving,
    serviceLabels,
    memberContactId,
    setMemberContactId,
    memberContactOptions,
    removeTarget,
    setRemoveTarget,
    location,
    resetCreateForm,
    handleSubmit,
    handleAddMember,
    handleDeleteFamily,
    handlePrimaryMemberChange,
    selectRow,
    confirmRemoveMember,
  };
}
