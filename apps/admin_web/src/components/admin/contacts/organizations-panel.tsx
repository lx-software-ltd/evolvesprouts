'use client';

import type { useAdminEntityOrganizations } from '@/hooks/use-admin-entity-organizations';
import { useOrganizationPanelEditor } from '@/hooks/use-organization-panel-editor';
import { OrganizationEditorPanel } from '@/components/admin/contacts/organization-editor-panel';
import { OrganizationsRecordTable } from '@/components/admin/contacts/organizations-record-table';
import { EntityRemoveMemberDialog } from '@/components/admin/contacts/shared/entity-remove-member-dialog';
import { AdminDiscardChangesDialog } from '@/components/ui/admin-discard-changes-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { EntityTagRef } from '@/lib/entity-api';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export interface OrganizationsPanelProps {
  organizations: ReturnType<typeof useAdminEntityOrganizations>;
  tags: EntityTagRef[];
  locations: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
  refreshLocations: () => Promise<void> | void;
  contactOptions: { id: string; label: string }[];
  contactsForMembership: {
    id: string;
    contact_type?: ApiSchemas['EntityContactType'];
    family_ids: string[];
    organization_ids: string[];
  }[];
}

export function OrganizationsPanel({
  organizations,
  tags,
  locations,
  geographicAreas,
  areasLoading,
  refreshLocations,
  contactOptions,
  contactsForMembership,
}: OrganizationsPanelProps) {
  const {
    organizations: rows,
    filters,
    setFilter,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
  } = organizations;

  const editor = useOrganizationPanelEditor({
    organizations,
    locations,
    geographicAreas,
    refreshLocations,
    contactOptions,
    contactsForMembership,
  });

  return (
    <>
      <ConfirmDialog {...editor.confirmDialogProps} />
      <AdminDiscardChangesDialog prompt={editor.expanded.discardPrompt} />
      <OrganizationsRecordTable
        rows={rows}
        filters={filters}
        setFilter={setFilter}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        error={error}
        loadMore={loadMore}
        isSaving={editor.isSaving}
        deleteActionError={editor.deleteActionError}
        onClearDeleteError={() => editor.setDeleteActionError('')}
        expanded={editor.expanded}
        detail={
          <OrganizationEditorPanel
            editor={editor}
            tags={tags}
            geographicAreas={geographicAreas}
            areasLoading={areasLoading}
          />
        }
        onDeleteOrganization={(row) => void editor.handleDeleteOrganization(row)}
      />
      <EntityRemoveMemberDialog
        open={editor.removeTarget !== null}
        entityLabel='organisation'
        memberLabel={editor.removeTarget?.label ?? null}
        isSaving={editor.isSaving}
        onCancel={() => editor.setRemoveTarget(null)}
        onConfirm={() => void editor.confirmRemoveMember()}
      />
    </>
  );
}
