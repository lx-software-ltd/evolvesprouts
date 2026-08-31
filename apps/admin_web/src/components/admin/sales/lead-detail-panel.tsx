'use client';

import { useState } from 'react';

import { ActivityTimeline } from './activity-timeline';
import { LeadInfoSection } from './lead-info-section';
import { LeadQuickActions } from './lead-quick-actions';
import { NotesSection } from './notes-section';
import { StageControl } from './stage-control';

import { CONTACT_SOURCES, LEAD_TYPES } from '@/types/leads';
import type { AdminUser, ContactSource, FunnelStage, LeadDetail, LeadType } from '@/types/leads';

import { StatusBanner } from '@/components/status-banner';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PhoneField } from '@/components/ui/phone-field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatEnumLabel } from '@/lib/format';
import { contactPhoneRequestFields } from '@/lib/phone-request';

interface CreateLeadFormState {
  firstName: string;
  lastName: string;
  email: string;
  phoneRegion: string;
  phoneNational: string;
  instagramHandle: string;
  source: ContactSource;
  sourceDetail: string;
  leadType: LeadType;
  contactType: string;
  assignedTo: string;
  note: string;
}

const EMPTY_CREATE_FORM: CreateLeadFormState = {
  firstName: '',
  lastName: '',
  email: '',
  phoneRegion: 'HK',
  phoneNational: '',
  instagramHandle: '',
  source: 'manual',
  sourceDetail: '',
  leadType: 'consultation',
  contactType: 'parent',
  assignedTo: '',
  note: '',
};

export interface LeadDetailPanelProps {
  mode: 'create' | 'edit';
  lead: LeadDetail | null;
  users: AdminUser[];
  isLoading: boolean;
  error: string;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onCreate: (payload: {
    first_name: string;
    last_name?: string | null;
    email?: string | null;
    phone_region?: string | null;
    phone_number?: string | null;
    instagram_handle?: string | null;
    source: ContactSource;
    source_detail?: string | null;
    lead_type: LeadType;
    contact_type?: string | null;
    assigned_to?: string | null;
    note?: string | null;
  }) => Promise<void> | void;
  onUpdateStage: (stage: FunnelStage, lostReason?: string) => Promise<void> | void;
  onAddNote: (content: string) => Promise<void> | void;
  onAssign: (assignedTo: string | null) => Promise<void> | void;
}

export function LeadDetailPanel({
  mode,
  lead,
  users,
  isLoading,
  error,
  onStartCreate,
  onCancelCreate,
  onCreate,
  onUpdateStage,
  onAddNote,
  onAssign,
}: LeadDetailPanelProps) {
  const [createForm, setCreateForm] = useState<CreateLeadFormState>(EMPTY_CREATE_FORM);

  const handleCreate = async () => {
    try {
      await onCreate({
        first_name: createForm.firstName.trim(),
        last_name: createForm.lastName.trim() || null,
        email: createForm.email.trim() || null,
        ...contactPhoneRequestFields(createForm.phoneRegion, createForm.phoneNational),
        instagram_handle: createForm.instagramHandle.trim() || null,
        source: createForm.source,
        source_detail: createForm.sourceDetail.trim() || null,
        lead_type: createForm.leadType,
        contact_type: createForm.contactType || null,
        assigned_to: createForm.assignedTo || null,
        note: createForm.note.trim() || null,
      });
      onCancelCreate();
    } catch {
      // Keep the form visible to let users correct and retry.
    }
  };

  if (mode === 'create') {
    return (
      <AdminEditorCard
        title='Create Lead'
        description='Create a new lead inline above the pipeline table.'
        actions={
          <>
            <Button type='button' variant='secondary' onClick={onCancelCreate} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              type='button'
              onClick={() => void handleCreate()}
              disabled={isLoading || createForm.firstName.trim().length === 0}
            >
              {isLoading ? 'Creating...' : 'Create lead'}
            </Button>
          </>
        }
      >
        {error ? (
          <StatusBanner variant='error' title='Create Lead'>
            {error}
          </StatusBanner>
        ) : null}

        <div className='space-y-3'>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
            <Input
              value={createForm.firstName}
              onChange={(event) => setCreateForm((previous) => ({ ...previous, firstName: event.target.value }))}
              placeholder='First name *'
            />
            <Input
              value={createForm.lastName}
              onChange={(event) => setCreateForm((previous) => ({ ...previous, lastName: event.target.value }))}
              placeholder='Last name'
            />
            <Input
              value={createForm.email}
              onChange={(event) => setCreateForm((previous) => ({ ...previous, email: event.target.value }))}
              type='email'
              placeholder='Email'
            />
            <div className='md:col-span-2'>
              <PhoneField
                region={createForm.phoneRegion}
                national={createForm.phoneNational}
                onRegionChange={(value) =>
                  setCreateForm((previous) => ({ ...previous, phoneRegion: value }))
                }
                onNationalChange={(value) =>
                  setCreateForm((previous) => ({ ...previous, phoneNational: value }))
                }
                regionLabel='Phone country / region'
                nationalLabel='Phone number (national digits)'
              />
            </div>
            <Input
              value={createForm.instagramHandle}
              onChange={(event) =>
                setCreateForm((previous) => ({ ...previous, instagramHandle: event.target.value }))
              }
              placeholder='Instagram handle'
            />
            <Select
              value={createForm.source}
              onChange={(event) =>
                setCreateForm((previous) => ({ ...previous, source: event.target.value as ContactSource }))
              }
            >
              {CONTACT_SOURCES.map((sourceOption) => (
                <option key={sourceOption} value={sourceOption}>
                  {formatEnumLabel(sourceOption)}
                </option>
              ))}
            </Select>
            <Input
              value={createForm.sourceDetail}
              onChange={(event) =>
                setCreateForm((previous) => ({ ...previous, sourceDetail: event.target.value }))
              }
              placeholder='Source detail'
            />
            <Select
              value={createForm.leadType}
              onChange={(event) =>
                setCreateForm((previous) => ({ ...previous, leadType: event.target.value as LeadType }))
              }
            >
              {LEAD_TYPES.map((leadTypeOption) => (
                <option key={leadTypeOption} value={leadTypeOption}>
                  {formatEnumLabel(leadTypeOption)}
                </option>
              ))}
            </Select>
            <Select
              value={createForm.contactType}
              onChange={(event) =>
                setCreateForm((previous) => ({ ...previous, contactType: event.target.value }))
              }
            >
              <option value='parent'>Parent</option>
              <option value='child'>Child</option>
              <option value='helper'>Helper</option>
              <option value='professional'>Professional</option>
              <option value='other'>Other</option>
            </Select>
            <Select
              value={createForm.assignedTo}
              onChange={(event) =>
                setCreateForm((previous) => ({ ...previous, assignedTo: event.target.value }))
              }
            >
              <option value=''>Unassigned</option>
              {users.map((user) => (
                <option key={user.sub} value={user.sub}>
                  {user.name || user.email || user.sub}
                </option>
              ))}
            </Select>
          </div>
          <Textarea
            value={createForm.note}
            onChange={(event) => setCreateForm((previous) => ({ ...previous, note: event.target.value }))}
            placeholder='Initial note'
            rows={3}
          />
        </div>
      </AdminEditorCard>
    );
  }

  return (
    <Card title='Lead Details' className='space-y-4'>
      <div className='flex justify-start gap-2'>
        <Button type='button' onClick={onStartCreate}>
          New lead
        </Button>
      </div>

      {error ? (
        <StatusBanner variant='error' title='Lead'>
          {error}
        </StatusBanner>
      ) : null}

      {!lead ? (
        <p className='text-sm text-slate-600'>Select a lead to view details, or create a new lead.</p>
      ) : (
        <div className='space-y-4'>
          <LeadInfoSection lead={lead} />
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <StageControl currentStage={lead.funnelStage} isLoading={isLoading} onUpdateStage={onUpdateStage} />
            <LeadQuickActions
              lead={lead}
              users={users}
              isLoading={isLoading}
              onMarkConverted={() => onUpdateStage('converted')}
              onMarkLost={(lostReason) => onUpdateStage('lost', lostReason)}
              onAssign={onAssign}
            />
          </div>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <NotesSection notes={lead.notes} users={users} isLoading={isLoading} onAddNote={onAddNote} />
            <ActivityTimeline events={lead.events} users={users} />
          </div>
        </div>
      )}
    </Card>
  );
}
