'use client';

import type { ReactNode } from 'react';

import { DeleteIcon } from '@/components/icons/action-icons';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminFilterBar } from '@/components/ui/admin-filter-bar';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import type { NoteRow } from '@/lib/entity-api';
import { formatDate } from '@/lib/format';
import type { AdminUser } from '@/types/leads';

/** Row id of the unsaved note; distinct from the parent table's draft id so test ids never collide. */
export const NOTE_DRAFT_ID = 'note-draft';

const COLUMN_COUNT = 4;

function resolveNoteAuthor(createdBy: string, users: AdminUser[]): string {
  const user = users.find((entry) => entry.sub === createdBy);
  return user?.name || user?.email || createdBy;
}

export function noteMetaLine(note: NoteRow, users: AdminUser[]): string {
  const author = resolveNoteAuthor(note.created_by, users);
  const created = formatDate(note.created_at ?? null);
  if (note.updated_at && note.updated_at !== note.created_at) {
    return `${author} · ${created} · Updated ${formatDate(note.updated_at)}`;
  }
  return `${author} · ${created}`;
}

function noteRowLabel(note: NoteRow): string {
  const firstLine = note.content.split('\n')[0]?.trim() ?? '';
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine || 'note';
}

export interface ContactNotesRecordTableProps {
  notes: NoteRow[];
  adminUsers: AdminUser[];
  isLoading: boolean;
  isMutating: boolean;
  error: string;
  emptyLabel: string;
  /** `NOTE_DRAFT_ID`, a note id, or `null` when no row is open. */
  expandedId: string | null;
  /** Editor for the open row; rendered inside the expansion. */
  detail: ReactNode;
  createDisabled?: boolean;
  onToggle: (id: string) => void;
  onDelete: (note: NoteRow) => void;
}

/**
 * Notes as a nested table-first list inside the expanded contact row: a `+`
 * control opens a draft row, clicking a note opens its editor beneath it,
 * and Delete lives in the Operations column.
 */
export function ContactNotesRecordTable({
  notes,
  adminUsers,
  isLoading,
  isMutating,
  error,
  emptyLabel,
  expandedId,
  detail,
  createDisabled = false,
  onToggle,
  onDelete,
}: ContactNotesRecordTableProps) {
  const isDraftOpen = expandedId === NOTE_DRAFT_ID;
  return (
    <AdminRecordTable
      embedded
      aria-label='Notes'
      columnCount={COLUMN_COUNT}
      rowCount={notes.length}
      isLoading={isLoading}
      error={error}
      errorTitle='Notes'
      emptyLabel={emptyLabel}
      filters={
        <AdminFilterBar
          trailing={
            <AdminCreateButton
              label='New note'
              active={isDraftOpen}
              disabled={createDisabled}
              onClick={() => onToggle(NOTE_DRAFT_ID)}
            />
          }
        />
      }
      head={
        <tr>
          <AdminDataTableHeadCell className='w-10' />
          <AdminDataTableHeadCell>Note</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='secondary'>Author</AdminDataTableHeadCell>
          <AdminDataTableOperationsHeadCell />
        </tr>
      }
    >
      {isDraftOpen ? (
        <AdminExpandableRow
          id={NOTE_DRAFT_ID}
          label='new note'
          expanded
          isDraft
          onToggle={() => onToggle(NOTE_DRAFT_ID)}
          columnCount={COLUMN_COUNT}
          cells={
            <>
              <AdminDataTableCell className='font-medium text-slate-900'>New note</AdminDataTableCell>
              <AdminDataTableCell priority='secondary' className='text-slate-400'>
                —
              </AdminDataTableCell>
            </>
          }
          actions={null}
          detail={detail}
        />
      ) : null}
      {notes.map((note) => {
        const meta = noteMetaLine(note, adminUsers);
        const isOpen = expandedId === note.id;
        return (
          <AdminExpandableRow
            key={note.id}
            id={note.id}
            label={noteRowLabel(note)}
            expanded={isOpen}
            onToggle={() => onToggle(note.id)}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='text-slate-900'>
                  <span className='line-clamp-2 wrap-anywhere whitespace-pre-wrap'>{note.content}</span>
                  <AdminDataTableCellMeta>{meta}</AdminDataTableCellMeta>
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='whitespace-nowrap text-xs text-slate-500'>
                  {meta}
                </AdminDataTableCell>
              </>
            }
            actions={
              <AdminRowActions
                actions={[
                  {
                    key: 'delete',
                    label: 'Delete note',
                    icon: <DeleteIcon className='h-4 w-4' />,
                    tone: 'danger',
                    disabled: isMutating,
                    onClick: () => onDelete(note),
                  },
                ]}
              />
            }
            detail={isOpen ? detail : null}
          />
        );
      })}
    </AdminRecordTable>
  );
}
