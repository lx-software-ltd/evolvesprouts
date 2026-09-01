'use client';

import { useCallback, useMemo, useState, type MouseEvent } from 'react';

import type { useAdminEntityOrganizations } from '@/hooks/use-admin-entity-organizations';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useEntityInlineLocation } from '@/hooks/use-entity-inline-location';
import { useEntityServiceLabels } from '@/hooks/use-entity-service-labels';
import type { InlineLocationEmbeddedSummary } from '@/components/admin/locations/inline-location-editor';
import { listAdminOrganizationServices } from '@/lib/entity-api';
import { contactEligibleForEntityMembership } from '@/lib/entity-contact-eligibility';
import {
  ORGANIZATION_RELATIONSHIP_TYPES,
  relationshipTypeForEditor,
} from '@/types/entity-relationship';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

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
    isSaving,
    createOrganization,
    updateOrganization,
    addMember,
    removeMember,
    updateMember,
    deleteOrganization,
    relationshipOptions,
  } = organizations;

  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [deleteActionError, setDeleteActionError] = useState('');

  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const locationLockedReadOnly = Boolean(location.resolvedLocation?.lockedFromPartnerOrg);

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

  async function resetCreateForm() {
    setEditorMode('create');
    setSelectedId(null);
    setName('');
    setOrganizationType('company');
    setRelationshipType('prospect');
    setWebsite('');
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
        await createOrganization({
          name: name.trim(),
          organization_type: organizationType,
          relationship_type: relationshipType,
          website: website.trim() || null,
          location_id: loc,
          tag_ids: tagIds,
        });
        await resetCreateForm();
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

  async function handleDeleteOrganization(
    row: ApiSchemas['AdminOrganization'],
    clickEvent: MouseEvent<HTMLButtonElement>
  ): Promise<void> {
    clickEvent.stopPropagation();
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
        await resetCreateForm();
      }
    } catch (err) {
      setDeleteActionError(
        err instanceof Error ? err.message : 'Failed to delete organisation'
      );
    }
  }

  function selectRow(id: string) {
    const row = rows.find((o) => o.id === id);
    if (!row) {
      return;
    }
    setSelectedId(id);
    setEditorMode('edit');
    setName(row.name);
    setOrganizationType(row.organization_type);
    setRelationshipType(
      relationshipTypeForEditor(row.relationship_type, ORGANIZATION_RELATIONSHIP_TYPES)
    );
    setWebsite(row.website ?? '');
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
    name,
    setName,
    organizationType,
    setOrganizationType,
    relationshipType,
    setRelationshipType,
    relationshipOptions,
    website,
    setWebsite,
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
    locationLockedReadOnly,
    resetCreateForm,
    handleSubmit,
    handleAddMember,
    handleDeleteOrganization,
    handlePrimaryMemberChange,
    selectRow,
    confirmRemoveMember,
  };
}
