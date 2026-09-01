'use client';

import { useEffect, useId, useState } from 'react';

import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { DeleteIcon, PencilIcon } from '@/components/icons/action-icons';
import { Button } from '@/components/ui/button';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
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
import { formatDate } from '@/lib/format';
import type { AdminUser } from '@/types/leads';
import type { components } from '@/types/generated/admin-api.generated';

type AdminContact = components['schemas']['AdminContact'];

const NOTES_EDITOR_FORM_ID = 'contact-notes-editor-form';

export type NotesContactRef = Pick<AdminContact, 'id' | 'first_name'> &
  Partial<Pick<AdminContact, 'last_name' | 'email'>>;

export interface ContactNotesPanelProps {
  contact: NotesContactRef | null;
  adminUsers: AdminUser[];
  onClose?: () => void;
  onStandaloneNoteCountChange?: (contactId: string, count: number) => void;
  title?: string;
  description?: string;
}

function contactDisplayName(contact: NotesContactRef): string {
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return name || contact.email || contact.id;
}

function resolveNoteAuthor(createdBy: string, users: AdminUser[]): string {
  const user = users.find((entry) => entry.sub === createdBy);
  return user?.name || user?.email || createdBy;
}

function noteMetaLine(note: NoteRow, users: AdminUser[]): string {
  const author = resolveNoteAuthor(note.created_by, users);
  const created = formatDate(note.created_at ?? null);
  if (note.updated_at && note.updated_at !== note.created_at) {
    return `${author} · ${created} · Updated ${formatDate(note.updated_at)}`;
  }
  return `${author} · ${created}`;
}

export function ContactNotesPanel({
  contact,
  adminUsers,
  onClose,
  onStandaloneNoteCountChange,
  title,
  description,
}: ContactNotesPanelProps) {
  const contentFieldId = useId();
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
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load notes');
          setNotes([]);
        }
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
            <Button
              type='submit'
              form={NOTES_EDITOR_FORM_ID}
              disabled={!contactId || isLoading || isMutating || !contentDraft.trim()}
            >
              {editorMode === 'create' ? 'Add note' : 'Update note'}
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
          id={NOTES_EDITOR_FORM_ID}
          className='space-y-2'
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveNote();
          }}
        >
          <Label htmlFor={contentFieldId}>
            {editorMode === 'create' ? 'New note' : 'Edit note'}
          </Label>
          <Textarea
            id={contentFieldId}
            value={contentDraft}
            onChange={(event) => setContentDraft(event.target.value)}
            rows={editorMode === 'create' ? 3 : 4}
            disabled={!contactId || isLoading || isMutating}
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
        <AdminDataTable>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Note</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Author</AdminDataTableHeadCell>
              <AdminDataTableOperationsHeadCell />
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {!isLoading && notes.length === 0 ? (
              <tr>
                <AdminDataTableCell colSpan={3} className='py-8 text-sm text-slate-600'>
                  {contactId
                    ? 'No notes yet for this contact.'
                    : 'Save the lead to add notes for the linked contact.'}
                </AdminDataTableCell>
              </tr>
            ) : (
              notes.map((note) => (
                <tr
                  key={note.id}
                  className={editingId === note.id ? 'bg-slate-100' : 'hover:bg-slate-50'}
                >
                  <AdminDataTableCell className='whitespace-pre-wrap text-sm text-slate-900'>
                    {note.content}
                  </AdminDataTableCell>
                  <AdminDataTableCell className='text-xs text-slate-500'>
                    {noteMetaLine(note, adminUsers)}
                  </AdminDataTableCell>
                  <AdminDataTableCell className='text-right'>
                    <div className='flex flex-wrap justify-end gap-2'>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        className='h-8 min-w-8 overflow-visible px-0'
                        disabled={isMutating}
                        onClick={() => startEdit(note)}
                        aria-label='Edit note'
                        title='Edit note'
                      >
                        <PencilIcon className='h-4 w-4 shrink-0' aria-hidden />
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='danger'
                        className='h-8 min-w-8 overflow-visible px-0'
                        disabled={isMutating}
                        onClick={() => void handleDeleteNote(note)}
                        aria-label='Delete note'
                        title='Delete note'
                      >
                        <DeleteIcon className='h-4 w-4 shrink-0' aria-hidden />
                      </Button>
                    </div>
                  </AdminDataTableCell>
                </tr>
              ))
            )}
          </AdminDataTableBody>
        </AdminDataTable>
      </PaginatedTableCard>
      </div>

      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
