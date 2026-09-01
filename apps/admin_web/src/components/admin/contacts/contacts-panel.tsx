'use client';

import type { useAdminEntityContacts } from '@/hooks/use-admin-entity-contacts';
import { useContactsPanelEditor } from '@/hooks/use-contacts-panel-editor';
import { ContactEditorCard } from '@/components/admin/contacts/contact-editor-card';
import { ContactNotesPanel } from '@/components/admin/contacts/contact-notes-panel';
import { ContactsListTable } from '@/components/admin/contacts/contacts-list-table';
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
  const {
    contacts: rows,
    filters,
    setFilter,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
  } = contacts;

  const editor = useContactsPanelEditor({
    contacts,
    locations,
    geographicAreas,
    refreshLocations,
    refreshFamilyOrgLists,
  });

  return (
    <div className='space-y-6'>
      <ConfirmDialog {...editor.confirmDialogProps} />
      <ContactEditorCard
        editor={editor}
        tags={tags}
        geographicAreas={geographicAreas}
        areasLoading={areasLoading}
      />
      {editor.notesTarget ? (
        <ContactNotesPanel
          contact={editor.notesTarget}
          adminUsers={adminUsers}
          onClose={() => editor.setNotesTarget(null)}
          onStandaloneNoteCountChange={onPatchStandaloneNoteCount}
        />
      ) : null}
      <ContactsListTable
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
        onToggleNotes={(row) => {
          editor.setNotesTarget((current) => (current?.id === row.id ? null : row));
        }}
        onToggleActive={(row) => {
          void editor.updateContact(row.id, { active: !row.active }).then(() =>
            editor.refreshFamilyOrgLists?.()
          );
        }}
        onDeleteContact={editor.handleDeleteContact}
      />
    </div>
  );
}
