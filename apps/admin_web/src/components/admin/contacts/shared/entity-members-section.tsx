'use client';

import { useState } from 'react';

import { DeleteIcon } from '@/components/icons/action-icons';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminFilterBar } from '@/components/ui/admin-filter-bar';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatEnumLabel } from '@/lib/format';

/** Row id of the unsaved membership; distinct from the parent table's draft id. */
export const MEMBER_DRAFT_ID = 'member-draft';

const COLUMN_COUNT = 5;

export interface EntityMemberRow {
  id: string;
  contact_id: string;
  contact_label?: string | null;
  role: string;
  is_primary_contact: boolean;
}

export interface EntityMembersSectionProps {
  sectionId: string;
  contactSelectId: string;
  entityLabel: string;
  helpText: string;
  members: EntityMemberRow[];
  memberContactId: string;
  memberContactOptions: { id: string; label: string }[];
  isSaving: boolean;
  onMemberContactIdChange: (contactId: string) => void;
  onAddMember: () => void | Promise<void>;
  onPrimaryChange: (memberId: string, checked: boolean) => void;
  onRemoveRequest: (memberId: string, label: string) => void;
}

/**
 * Members as a nested table-first list inside the family / organisation
 * editor: `+` opens a draft row with the contact picker, clicking a member
 * opens its editor (primary-contact flag), Remove stays in Operations.
 */
export function EntityMembersSection({
  sectionId,
  contactSelectId,
  entityLabel,
  helpText,
  members,
  memberContactId,
  memberContactOptions,
  isSaving,
  onMemberContactIdChange,
  onAddMember,
  onPrimaryChange,
  onRemoveRequest,
}: EntityMembersSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Collapse the draft once the parent confirms the add by growing the list.
  const [seenCount, setSeenCount] = useState(members.length);
  if (members.length !== seenCount) {
    setSeenCount(members.length);
    if (members.length > seenCount && expandedId === MEMBER_DRAFT_ID) {
      setExpandedId(null);
    }
  }

  const isDraftOpen = expandedId === MEMBER_DRAFT_ID;
  const formId = `${sectionId}-add-form`;

  function toggle(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  const draftEditor = (
    <AdminEditorPanel
      actions={
        <AdminEditorActions
          mode='create'
          formId={formId}
          isSaving={isSaving}
          submitDisabled={!memberContactId}
          submitLabel='Add member'
        />
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void onAddMember();
        }}
      >
        <AdminFieldGrid columns={2}>
          <AdminField label='Contact' htmlFor={contactSelectId} hint={helpText}>
            <Select
              id={contactSelectId}
              value={memberContactId}
              onChange={(event) => onMemberContactIdChange(event.target.value)}
            >
              <option value=''>Select contact</option>
              {memberContactOptions.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.label}
                </option>
              ))}
            </Select>
          </AdminField>
        </AdminFieldGrid>
      </form>
    </AdminEditorPanel>
  );

  function memberEditor(member: EntityMemberRow, label: string) {
    const primaryId = `${sectionId}-${member.id}-primary`;
    return (
      <AdminEditorPanel>
        <AdminFieldGrid columns={4}>
          <AdminField label='Contact' htmlFor={`${sectionId}-${member.id}-contact`} span={2}>
            <Input id={`${sectionId}-${member.id}-contact`} value={label} readOnly aria-readonly='true' />
          </AdminField>
          <AdminField label='Role' htmlFor={`${sectionId}-${member.id}-role`} hint={helpText}>
            <Input
              id={`${sectionId}-${member.id}-role`}
              value={formatEnumLabel(member.role)}
              readOnly
              aria-readonly='true'
            />
          </AdminField>
          <AdminField label='Primary contact' hint='Saved immediately.'>
            <label className='flex h-10 items-center gap-2 text-sm text-slate-800 sm:h-9' htmlFor={primaryId}>
              <input
                id={primaryId}
                type='checkbox'
                className='h-4 w-4 rounded border-slate-300'
                checked={member.is_primary_contact}
                disabled={isSaving}
                onChange={(event) => {
                  onPrimaryChange(member.id, event.target.checked);
                }}
                aria-label={`Primary contact for ${label}`}
              />
              {member.is_primary_contact ? 'Yes' : 'No'}
            </label>
          </AdminField>
        </AdminFieldGrid>
      </AdminEditorPanel>
    );
  }

  return (
    <AdminDisclosure id={sectionId} title='Members' summary={members.length}>
      <AdminRecordTable
        embedded
        aria-label='Members'
        columnCount={COLUMN_COUNT}
        rowCount={members.length}
        isLoading={false}
        emptyLabel={`No members yet. Use + to add a contact to this ${entityLabel}.`}
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='New member'
                active={isDraftOpen}
                disabled={isSaving}
                onClick={() => toggle(MEMBER_DRAFT_ID)}
              />
            }
          />
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Contact</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Role</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Primary contact</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {isDraftOpen ? (
          <AdminExpandableRow
            id={MEMBER_DRAFT_ID}
            label='new member'
            expanded
            isDraft
            onToggle={() => toggle(MEMBER_DRAFT_ID)}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New member</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
              </>
            }
            actions={null}
            detail={draftEditor}
          />
        ) : null}
        {members.map((member) => {
          const label = member.contact_label || member.contact_id;
          const isOpen = expandedId === member.id;
          const role = formatEnumLabel(member.role);
          return (
            <AdminExpandableRow
              key={member.id}
              id={member.id}
              label={label}
              expanded={isOpen}
              onToggle={() => toggle(member.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell>
                    {label}
                    <AdminDataTableCellMeta>
                      {role}
                      {member.is_primary_contact ? ' · Primary contact' : ''}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary'>{role}</AdminDataTableCell>
                  <AdminDataTableCell priority='secondary'>{member.is_primary_contact ? 'Yes' : '—'}</AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'remove',
                      label: `Remove ${label} from ${entityLabel}`,
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: isSaving,
                      onClick: () => onRemoveRequest(member.id, label),
                    },
                  ]}
                />
              }
              detail={isOpen ? memberEditor(member, label) : null}
            />
          );
        })}
      </AdminRecordTable>
    </AdminDisclosure>
  );
}
