'use client';

import type { useAdminEntityContacts } from '@/hooks/use-admin-entity-contacts';
import { useContactsPanelEditor } from '@/hooks/use-contacts-panel-editor';
import { ContactEditorPanel } from '@/components/admin/contacts/contact-editor-panel';
import { ContactsRecordTable } from '@/components/admin/contacts/contacts-record-table';
import { AdminDiscardChangesDialog } from '@/components/ui/admin-discard-changes-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { EntityTagRef } from '@/lib/entity-api';
import type { AdminUser } from '@/types/leads';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';

export interface ContactsPanelProps {
  contacts: ReturnType<typeof useAdminEntityContacts>;
  adminUsers: AdminUser[];
  onPatchStandaloneNoteCount: (contactId: string, standaloneNoteCount: number) => void;
  tags: EntityTagRef[];
  locations: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
  refreshLocations: () => Promise<void> | void;
  refreshFamilyOrgLists?: () => void | Promise<void>;
}

export function ContactsPanel({
  contacts,
  adminUsers,
  onPatchStandaloneNoteCount,
  tags,
  locations,
  geographicAreas,
  areasLoading,
  refreshLocations,
  refreshFamilyOrgLists,
}: ContactsPanelProps) {
  const { contacts: rows, filters, setFilter, isLoading, isLoadingMore, hasMore, error, loadMore } =
    contacts;

  const editor = useContactsPanelEditor({
    contacts,
    locations,
    geographicAreas,
    refreshLocations,
    refreshFamilyOrgLists,
  });

  return (
    <>
      <ConfirmDialog {...editor.confirmDialogProps} />
      <AdminDiscardChangesDialog prompt={editor.expanded.discardPrompt} />
      <ContactsRecordTable
        rows={rows}
        pinnedRow={editor.pinnedRow}
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
          <ContactEditorPanel
            editor={editor}
            tags={tags}
            geographicAreas={geographicAreas}
            areasLoading={areasLoading}
            adminUsers={adminUsers}
            onPatchStandaloneNoteCount={onPatchStandaloneNoteCount}
          />
        }
        onOpenNotes={editor.openNotes}
        onToggleActive={(row) => {
          void editor.updateContact(row.id, { active: !row.active }).then(() =>
            editor.refreshFamilyOrgLists?.()
          );
        }}
        onDeleteContact={(row) => void editor.handleDeleteContact(row)}
      />
    </>
  );
}
