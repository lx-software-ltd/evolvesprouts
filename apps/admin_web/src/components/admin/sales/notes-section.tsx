'use client';

import { useState } from 'react';

import type { AdminUser, LeadNote } from '@/types/leads';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { formatDate } from '@/lib/format';

export interface NotesSectionProps {
  notes: LeadNote[];
  users: AdminUser[];
  isLoading: boolean;
  onAddNote: (content: string) => Promise<void> | void;
}

function resolveAuthor(createdBy: string, users: AdminUser[]): string {
  const user = users.find((entry) => entry.sub === createdBy);
  return user?.name || user?.email || createdBy;
}

export function NotesSection({ notes, users, isLoading, onAddNote }: NotesSectionProps) {
  const [noteContent, setNoteContent] = useState('');

  return (
    <Card title='Notes' className='h-full space-y-3'>
      <div className='space-y-2'>
        <Textarea
          value={noteContent}
          onChange={(event) => setNoteContent(event.target.value)}
          placeholder='Add note'
          rows={3}
        />
        <Button
          type='button'
          size='sm'
          disabled={isLoading || noteContent.trim().length === 0}
          onClick={async () => {
            await onAddNote(noteContent.trim());
            setNoteContent('');
          }}
        >
          Add note
        </Button>
      </div>
      <div className='space-y-2'>
        {notes.length === 0 ? (
          <p className='text-sm text-slate-600'>No notes yet.</p>
        ) : (
          notes.map((note) => (
            <article key={note.id} className='rounded-md border border-slate-200 p-3'>
              <p className='text-sm text-slate-900'>{note.content}</p>
              <p className='mt-2 text-xs text-slate-600'>
                {resolveAuthor(note.created_by, users)} • {formatDate(note.created_at)}
              </p>
            </article>
          ))
        )}
      </div>
    </Card>
  );
}
