'use client';

import { DeleteIcon, PencilIcon } from '@/components/icons/action-icons';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import type { NoteRow } from '@/lib/entity-api';
import { formatDate } from '@/lib/format';
import type { AdminUser } from '@/types/leads';

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

export interface ContactNotesTableProps {
  notes: NoteRow[];
  adminUsers: AdminUser[];
  isLoading: boolean;
  isMutating: boolean;
  editingId: string | null;
  emptyLabel: string;
  onEdit: (note: NoteRow) => void;
  onDelete: (note: NoteRow) => void;
}

export function ContactNotesTable({
  notes,
  adminUsers,
  isLoading,
  isMutating,
  editingId,
  emptyLabel,
  onEdit,
  onDelete,
}: ContactNotesTableProps) {
  return (
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
              {emptyLabel}
            </AdminDataTableCell>
          </tr>
        ) : (
          notes.map((note) => (
            <tr key={note.id} className={editingId === note.id ? 'bg-slate-100' : 'hover:bg-slate-50'}>
              <AdminDataTableCell className='whitespace-pre-wrap text-sm text-slate-900'>
                {note.content}
              </AdminDataTableCell>
              <AdminDataTableCell className='whitespace-nowrap text-xs text-slate-500'>
                {noteMetaLine(note, adminUsers)}
              </AdminDataTableCell>
              <AdminDataTableCell className='text-right'>
                <AdminRowActions
                  actions={[
                    {
                      key: 'edit',
                      label: 'Edit note',
                      icon: <PencilIcon className='h-4 w-4' />,
                      disabled: isMutating,
                      onClick: () => onEdit(note),
                    },
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
              </AdminDataTableCell>
            </tr>
          ))
        )}
      </AdminDataTableBody>
    </AdminDataTable>
  );
}
