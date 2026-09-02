'use client';

import { useEffect, useId, useState } from 'react';

import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { ContactNotesTable } from '@/components/admin/contacts/contact-notes-table';
import { Button } from '@/components/ui/button';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { StatusBanner } from '@/components/status-banner';
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
  onClose?: () => void;
  onStandaloneNoteCountChange?: (contactId: string, count: number) => void;
  title?: string;
  description?: string;
  /**
   * `card` (default) renders the legacy titled composer + notes card pair.
   * `embedded` renders composer and table without titles for use inside an
   * expanded record row (see `ContactEditorPanel`).
   */
  layout?: 'card' | 'embedded';
}

function contactDisplayName(contact: NotesContactRef): string {
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return name || contact.email || contact.id;
}

export function ContactNotesPanel({
  contact,
  adminUsers,
  onClose,
  onStandaloneNoteCountChange,
  title,
  description,
  layout = 'card',
}: ContactNotesPanelProps) {
  const contentFieldId = useId();
  const formId = useId();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [contentDraft, setContentDraft] = useState('');
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();

  const contactId = contact?.id ?? null;
  const notesTitle = title ?? (contact ? `Notes · ${contactDisplayName(contact)}` : 'Notes');
  const notesDescription =
    description ??
    (contact
      ? 'Standalone contact notes (not tied to a sales lead). The table badge reflects this count only; concurrent edits elsewhere update after you refresh the contact list. Notes attached to sales leads are managed on the lead detail screen.'
      : 'Create the lead to add notes on the linked contact.');
  const emptyLabel = contactId
    ? 'No notes yet for this contact.'
    : 'Save the lead to add notes for the linked contact.';

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoadError('');
    setActionError('');
    setEditorMode('create');
    setEditingId(null);
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
    setEditorMode('create');
    setEditingId(null);
    setContentDraft('');
  }

  async function handleSaveNote() {
    if (!contactId || !contentDraft.trim()) {
      return;
    }
    setIsMutating(true);
    setActionError('');
    try {
      if (editorMode === 'create') {
        const created = await createAdminContactNote(contactId, { content: contentDraft.trim() });
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
    setEditorMode('edit');
    setEditingId(note.id);
    setContentDraft(note.content);
  }

  const composerDisabled = !contactId || isLoading || isMutating;
  const submitDisabled = composerDisabled || !contentDraft.trim();
  const submitLabel = editorMode === 'create' ? 'Add note' : 'Update note';
  const fieldLabel = editorMode === 'create' ? 'New note' : 'Edit note';

  const table = (
    <ContactNotesTable
      notes={notes}
      adminUsers={adminUsers}
      isLoading={isLoading}
      isMutating={isMutating}
      editingId={editingId}
      emptyLabel={emptyLabel}
      onEdit={startEdit}
      onDelete={(note) => void handleDeleteNote(note)}
    />
  );

  if (layout === 'embedded') {
    // Compact composer: one textarea row with the action beside it, then the
    // notes table at the same density as the contacts table above.
    return (
      <>
        <div className='space-y-3'>
          <form
            id={formId}
            className='flex flex-wrap items-end gap-2'
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveNote();
            }}
          >
            <div className='min-w-0 flex-1'>
              <Label htmlFor={contentFieldId}>{fieldLabel}</Label>
              <Textarea
                id={contentFieldId}
                value={contentDraft}
                onChange={(event) => setContentDraft(event.target.value)}
                rows={2}
                disabled={composerDisabled}
                placeholder='Add a note about this contact…'
              />
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              {editorMode === 'edit' ? (
                <Button type='button' variant='secondary' disabled={isMutating} onClick={resetEditor}>
                  Cancel edit
                </Button>
              ) : null}
              <Button type='submit' disabled={submitDisabled}>
                {isMutating ? 'Saving...' : submitLabel}
              </Button>
            </div>
          </form>
          {actionError ? (
            <StatusBanner variant='error' title='Note action failed'>
              {actionError}
            </StatusBanner>
          ) : null}
          {loadError ? (
            <StatusBanner variant='error' title='Could not load notes'>
              {loadError}
            </StatusBanner>
          ) : null}
          <div className='overflow-x-auto' aria-busy={isLoading}>
            {table}
          </div>
        </div>
        <ConfirmDialog {...confirmDialogProps} />
      </>
    );
  }

  return (
    <>
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        <AdminEditorCard
          title={notesTitle}
          description={notesDescription}
          actions={
            <>
              {editorMode === 'edit' ? (
                <Button type='button' variant='secondary' disabled={isMutating} onClick={resetEditor}>
                  Cancel
                </Button>
              ) : onClose ? (
                <Button type='button' variant='secondary' onClick={onClose}>
                  Close notes
                </Button>
              ) : null}
              <Button type='submit' form={formId} disabled={submitDisabled}>
                {submitLabel}
              </Button>
            </>
          }
        >
          {actionError ? (
            <StatusBanner variant='error' title='Note action failed'>
              {actionError}
            </StatusBanner>
          ) : null}
          <form
            id={formId}
            className='space-y-2'
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveNote();
            }}
          >
            <Label htmlFor={contentFieldId}>{fieldLabel}</Label>
            <Textarea
              id={contentFieldId}
              value={contentDraft}
              onChange={(event) => setContentDraft(event.target.value)}
              rows={editorMode === 'create' ? 3 : 4}
              disabled={composerDisabled}
              placeholder='Add a note about this contact…'
            />
          </form>
        </AdminEditorCard>

        <PaginatedTableCard
          title='Contact notes'
          description={`${notes.length.toLocaleString()} note(s)`}
          isLoading={isLoading}
          isLoadingMore={false}
          hasMore={false}
          error={loadError}
          loadingLabel='Loading notes…'
          onLoadMore={() => Promise.resolve()}
        >
          {table}
        </PaginatedTableCard>
      </div>

      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
