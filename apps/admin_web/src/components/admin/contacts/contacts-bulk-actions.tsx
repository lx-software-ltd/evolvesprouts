'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatAdminContactPickerLabel, formatEnumLabel } from '@/lib/format';
import type { components } from '@/types/generated/admin-api.generated';

type AdminContact = components['schemas']['AdminContact'];

export interface ContactsBulkActionsProps {
  selectedCount: number;
  selectedContacts: AdminContact[];
  onBulkMerge: (contactIds: string[], keeperContactId: string) => Promise<void> | void;
}

/**
 * Bulk toolbar shown between the filters and the table once rows are
 * checked. Merge confirms before running; the confirm button shows the
 * shared in-flight state.
 */
export function ContactsBulkActions({
  selectedCount,
  selectedContacts,
  onBulkMerge,
}: ContactsBulkActionsProps) {
  const [running, setRunning] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [keeperContactId, setKeeperContactId] = useState('');

  useEffect(() => {
    if (!mergeOpen) {
      return;
    }
    setKeeperContactId((current) => current || selectedContacts[0]?.id || '');
  }, [mergeOpen, selectedContacts]);

  if (selectedCount <= 0) {
    return null;
  }

  const canMerge = selectedCount >= 2;

  async function runMerge() {
    if (!keeperContactId) {
      return;
    }
    setRunning(true);
    try {
      await onBulkMerge(
        selectedContacts.map((contact) => contact.id),
        keeperContactId
      );
      setMergeOpen(false);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <div
        className='mb-3 flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:flex-row md:items-center md:justify-between'
        data-testid='contacts-bulk-actions'
      >
        <p className='text-sm text-slate-700'>{selectedCount} contact(s) selected</p>
        {canMerge ? (
          <Button
            type='button'
            variant='outline'
            className='w-full shrink-0 self-start whitespace-nowrap bg-white sm:w-auto sm:self-auto'
            disabled={running}
            onClick={() => setMergeOpen(true)}
          >
            Merge contacts
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={mergeOpen}
        title='Merge selected contacts'
        description='Notes, enrollments, invoices, payments, conversations, certificates, tags, and sales leads from the other selected contacts move onto the keeper. Extra contacts are deleted. Open automated leads collapse when two would remain on the keeper.'
        confirmLabel='Merge contacts'
        variant='danger'
        confirmDisabled={!keeperContactId}
        confirmLoading={running}
        confirmLoadingLabel='Merging…'
        onCancel={() => {
          if (!running) {
            setMergeOpen(false);
          }
        }}
        onConfirm={() => void runMerge()}
      >
        <fieldset className='space-y-2'>
          <legend className='text-sm font-medium text-slate-900'>Keeper contact</legend>
          {selectedContacts.map((contact) => {
            const label = formatAdminContactPickerLabel(contact);
            const meta = [formatEnumLabel(contact.contact_type), formatEnumLabel(contact.relationship_type)]
              .filter(Boolean)
              .join(' · ');
            return (
              <label
                key={contact.id}
                className='flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700'
              >
                <input
                  type='radio'
                  name='keeper-contact'
                  className='mt-0.5 h-4 w-4 border-slate-300 text-slate-900'
                  checked={keeperContactId === contact.id}
                  disabled={running}
                  onChange={() => setKeeperContactId(contact.id)}
                />
                <span className='min-w-0'>
                  <span className='block font-medium text-slate-900'>{label}</span>
                  <span className='block text-slate-500'>{meta}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      </ConfirmDialog>
    </>
  );
}
