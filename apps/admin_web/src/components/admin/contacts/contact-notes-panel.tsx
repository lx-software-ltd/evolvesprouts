'use client';

import { useEffect, useId, useState } from 'react';

import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import {
  ContactNotesRecordTable,
  NOTE_DRAFT_ID,
} from '@/components/admin/contacts/contact-notes-record-table';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  createAdminContactNote,
  deleteAdminContactNote,
  listAdminContactNotes,
  updateAdminContactNote,
  type NoteRow,
} from '@/lib/entity-api';
import type { AdminUser } from '@/types/leads';
import type { components } from '@/types/generated/admin-api.generated';

type AdminContact = components['schemas']['AdminContact'];

export type NotesContactRef = Pick<AdminContact, 'id' | 'first_name'> &
  Partial<Pick<AdminContact, 'last_name' | 'email'>>;

export interface ContactNotesPanelProps {
  contact: NotesContactRef | null;
  adminUsers: AdminUser[];
  onStandaloneNoteCountChange?: (contactId: string, count: number) => void;
}

/**
 * Standalone contact notes as a nested table-first list inside an expanded
 * contact or lead row: `New note` opens a draft row, clicking a note opens its
 * editor beneath it, and Delete stays in the Operations column.
 */
export function ContactNotesPanel({
  contact,
  adminUsers,
  onStandaloneNoteCountChange,
}: ContactNotesPanelProps) {
  const contentFieldId = useId();
  const formId = useId();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  /** `NOTE_DRAFT_ID`, a note id, or `null`; drives both layouts' editor state. */
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [contentDraft, setContentDraft] = useState('');
  const editingId = expandedNoteId && expandedNoteId !== NOTE_DRAFT_ID ? expandedNoteId : null;
  const editorMode: 'create' | 'edit' = editingId ? 'edit' : 'create';
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();

  const contactId = contact?.id ?? null;
  const emptyLabel = contactId
    ? 'No notes yet for this contact.'
    : 'Save the lead to add notes for the linked contact.';

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoadError('');
    setActionError('');
    setExpandedNoteId(null);
    setContentDraft('');
    if (!contactId) {
      setNotes([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    void (async () => {
      try {
        const rows = await listAdminContactNotes(contactId, controller.signal);
        if (!cancelled) {
          const nextNotes = Array.isArray(rows) ? rows : [];
          setNotes(nextNotes);
          onStandaloneNoteCountChange?.(contactId, nextNotes.length);
        }
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        setLoadError(err instanceof Error ? err.message : 'Failed to load notes');
        setNotes([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [contactId, onStandaloneNoteCountChange]);

  function resetEditor() {
    setExpandedNoteId(null);
    setContentDraft('');
  }

  function openDraft() {
    setExpandedNoteId(NOTE_DRAFT_ID);
    setContentDraft('');
  }

  /** Row click: open the note's editor, or collapse it when already open. */
  function toggleNoteRow(id: string) {
    if (expandedNoteId === id) {
      resetEditor();
      return;
    }
    if (id === NOTE_DRAFT_ID) {
      openDraft();
      return;
    }
    const note = notes.find((entry) => entry.id === id);
    if (note) {
      startEdit(note);
    }
  }

  async function handleSaveNote() {
    if (!contactId || !contentDraft.trim()) {
      return;
    }
    setIsMutating(true);
    setActionError('');
    try {
      if (editorMode === 'create') {
        const created = await createAdminContactNote(contactId, {
          content: contentDraft.trim(),
        });
        if (created) {
          const next = [created, ...notes];
          setNotes(next);
          resetEditor();
          onStandaloneNoteCountChange?.(contactId, next.length);
        }
        return;
      }
      if (!editingId) {
        return;
      }
      const updated = await updateAdminContactNote(contactId, editingId, {
        content: contentDraft.trim(),
      });
      if (updated) {
        const next = notes.map((note) => (note.id === updated.id ? updated : note));
        setNotes(next);
        resetEditor();
        onStandaloneNoteCountChange?.(contactId, next.length);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setIsMutating(false);
    }
  }

  async function handleDeleteNote(note: NoteRow) {
    if (!contactId) {
      return;
    }
    const confirmed = await requestConfirm({
      title: 'Delete note',
      description: 'Permanently delete this note? This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    setIsMutating(true);
    setActionError('');
    try {
      await deleteAdminContactNote(contactId, note.id);
      const next = notes.filter((entry) => entry.id !== note.id);
      setNotes(next);
      if (editingId === note.id) {
        resetEditor();
      }
      onStandaloneNoteCountChange?.(contactId, next.length);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete note');
    } finally {
      setIsMutating(false);
    }
  }

  function startEdit(note: NoteRow) {
    setExpandedNoteId(note.id);
    setContentDraft(note.content);
  }

  const composerDisabled = !contactId || isLoading || isMutating;
  const submitDisabled = composerDisabled || !contentDraft.trim();
  const submitLabel = editorMode === 'create' ? 'Add note' : 'Update note';
  const fieldLabel = editorMode === 'create' ? 'New note' : 'Edit note';

  const noteEditor = (
    <AdminEditorPanel
      actions={
        <AdminEditorActions
          mode={editorMode}
          formId={formId}
          isSaving={isMutating}
          submitDisabled={submitDisabled}
          submitLabel={submitLabel}
        />
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void handleSaveNote();
        }}
      >
        <AdminFieldGrid columns={1}>
          <AdminField label={fieldLabel} htmlFor={contentFieldId}>
            <Textarea
              id={contentFieldId}
              value={contentDraft}
              onChange={(event) => setContentDraft(event.target.value)}
              rows={3}
              disabled={composerDisabled}
              placeholder='Add a note about this contact…'
            />
          </AdminField>
        </AdminFieldGrid>
      </form>
    </AdminEditorPanel>
  );
  return (
    <>
      <ContactNotesRecordTable
        notes={notes}
        adminUsers={adminUsers}
        isLoading={isLoading}
        isMutating={isMutating}
        error={loadError || actionError}
        emptyLabel={emptyLabel}
        expandedId={expandedNoteId}
        detail={noteEditor}
        createDisabled={!contactId || isMutating}
        onToggle={toggleNoteRow}
        onDelete={(note) => void handleDeleteNote(note)}
      />
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
