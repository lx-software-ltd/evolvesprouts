'use client';

import { DeleteIcon } from '@/components/icons/action-icons';
import { Button } from '@/components/ui/button';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatEnumLabel } from '@/lib/format';

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
  onAddMember: () => void;
  onPrimaryChange: (memberId: string, checked: boolean) => void;
  onRemoveRequest: (memberId: string, label: string) => void;
}

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
  return (
    <AdminDisclosure id={sectionId} title='Members' summary={members.length}>
      <div className='space-y-3 pt-1'>
        <div className='flex flex-wrap items-end gap-3'>
          <div className='min-w-[200px] flex-1'>
            <Label htmlFor={contactSelectId}>Contact</Label>
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
          </div>
          <Button type='button' disabled={isSaving || !memberContactId} onClick={onAddMember}>
            Add member
          </Button>
        </div>
        <p className='text-xs text-slate-600'>{helpText}</p>
        <AdminDataTable tableClassName='min-w-[520px]'>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Contact</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Role</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Primary contact</AdminDataTableHeadCell>
              <AdminDataTableOperationsHeadCell />
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {members.map((member) => {
              const label = member.contact_label || member.contact_id;
              return (
                <tr key={member.id}>
                  <AdminDataTableCell>{label}</AdminDataTableCell>
                  <AdminDataTableCell>{formatEnumLabel(member.role)}</AdminDataTableCell>
                  <AdminDataTableCell>
                    <input
                      type='checkbox'
                      className='h-4 w-4 rounded border-slate-300'
                      checked={member.is_primary_contact}
                      disabled={isSaving}
                      onChange={(event) => {
                        onPrimaryChange(member.id, event.target.checked);
                      }}
                      aria-label={`Primary contact for ${label}`}
                    />
                  </AdminDataTableCell>
                  <AdminDataTableCell className='text-right'>
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
                  </AdminDataTableCell>
                </tr>
              );
            })}
          </AdminDataTableBody>
        </AdminDataTable>
      </div>
    </AdminDisclosure>
  );
}
