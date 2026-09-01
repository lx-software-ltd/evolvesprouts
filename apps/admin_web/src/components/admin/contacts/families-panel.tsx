'use client';

import type { useAdminEntityFamilies } from '@/hooks/use-admin-entity-families';
import { useFamilyPanelEditor } from '@/hooks/use-family-panel-editor';
import { FamilyEditorCard } from '@/components/admin/contacts/family-editor-card';
import { FamiliesListTable } from '@/components/admin/contacts/families-list-table';
import { EntityRemoveMemberDialog } from '@/components/admin/contacts/shared/entity-remove-member-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { EntityTagRef } from '@/lib/entity-api';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export interface FamiliesPanelProps {
  families: ReturnType<typeof useAdminEntityFamilies>;
  tags: EntityTagRef[];
  locations: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
  refreshLocations: () => Promise<void> | void;
  contactOptions: { id: string; label: string }[];
  contactsForMembership: {
    id: string;
    contact_type: ApiSchemas['EntityContactType'];
    family_ids: string[];
    organization_ids: string[];
  }[];
}

export function FamiliesPanel({
  families,
  tags,
  locations,
  geographicAreas,
  areasLoading,
  refreshLocations,
  contactOptions,
  contactsForMembership,
}: FamiliesPanelProps) {
  const {
    families: rows,
    filters,
    setFilter,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
  } = families;

  const editor = useFamilyPanelEditor({
    families,
    locations,
    geographicAreas,
    refreshLocations,
    contactOptions,
    contactsForMembership,
  });

  return (
    <div className='space-y-6'>
      <ConfirmDialog {...editor.confirmDialogProps} />
      <FamilyEditorCard
        editor={editor}
        tags={tags}
        geographicAreas={geographicAreas}
        areasLoading={areasLoading}
      />
      <FamiliesListTable
        rows={rows}
        filters={filters}
        setFilter={setFilter}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        error={error}
        loadMore={loadMore}
        isSaving={editor.isSaving}
        selectedId={editor.selectedId}
        deleteActionError={editor.deleteActionError}
        onClearDeleteError={() => editor.setDeleteActionError('')}
        onSelectRow={editor.selectRow}
        onDeleteFamily={editor.handleDeleteFamily}
      />
      <EntityRemoveMemberDialog
        open={editor.removeTarget !== null}
        entityLabel='family'
        memberLabel={editor.removeTarget?.label ?? null}
        isSaving={editor.isSaving}
        onCancel={() => editor.setRemoveTarget(null)}
        onConfirm={() => void editor.confirmRemoveMember()}
      />
    </div>
  );
}
