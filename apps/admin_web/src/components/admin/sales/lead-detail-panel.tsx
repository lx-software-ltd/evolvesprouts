'use client';

import { useState } from 'react';

import { ActivityTimeline } from './activity-timeline';
import { LeadConversationCard } from './lead-conversation-card';

import { ContactNotesPanel } from '@/components/admin/contacts/contact-notes-panel';
import { CONTACT_TYPES } from '@/lib/contacts/contacts-panel-constants';
import { instagramHandleForStorage } from '@/lib/contacts/contacts-panel-helpers';
import { formatEnumLabel } from '@/lib/format';
import { contactPhoneRequestFields } from '@/lib/phone-request';
import { CONTACT_SOURCES, FUNNEL_STAGES, LEAD_TYPES } from '@/types/leads';
import type { AdminUser, ContactSource, FunnelStage, LeadDetail, LeadType } from '@/types/leads';
import type { components } from '@/types/generated/admin-api.generated';
import type { CreateLeadEntryInput, UpdateLeadEntryInput } from '@/hooks/use-lead-mutations';

import { StatusBanner } from '@/components/status-banner';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneField } from '@/components/ui/phone-field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type EntityContactType = components['schemas']['EntityContactType'];

const LEAD_EDITOR_FORM_ID = 'lead-editor-form';

interface LeadEditorFormState {
  firstName: string;
  lastName: string;
  email: string;
  phoneRegion: string;
  phoneNational: string;
  instagramHandle: string;
  source: ContactSource;
  sourceDetail: string;
  leadType: LeadType;
  contactType: EntityContactType;
  assignedTo: string;
  funnelStage: FunnelStage;
  lostReason: string;
}

const EMPTY_EDITOR_FORM: LeadEditorFormState = {
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
  funnelStage: 'new',
  lostReason: '',
};

function asContactType(value: string | null | undefined): EntityContactType {
  return CONTACT_TYPES.includes(value as EntityContactType)
    ? (value as EntityContactType)
    : 'parent';
}

function formFromLead(lead: LeadDetail): LeadEditorFormState {
  return {
    firstName: lead.contact.firstName ?? '',
    lastName: lead.contact.lastName ?? '',
    email: lead.contact.email ?? '',
    phoneRegion: lead.contact.phoneRegion ?? 'HK',
    phoneNational: lead.contact.phoneNationalNumber ?? '',
    instagramHandle: instagramHandleForStorage(lead.contact.instagramHandle) ?? '',
    source: lead.contact.source ?? 'manual',
    sourceDetail: lead.contact.sourceDetail ?? '',
    leadType: lead.leadType,
    contactType: asContactType(lead.contact.contactType),
    assignedTo: lead.assignedTo ?? '',
    funnelStage: lead.funnelStage,
    lostReason: lead.lostReason ?? '',
  };
}

export interface LeadDetailPanelProps {
  mode: 'create' | 'edit';
  lead: LeadDetail | null;
  users: AdminUser[];
  defaultAssignedTo?: string | null;
  isLoading: boolean;
  error: string;
  onStartCreate: () => void;
  onCreate: (payload: CreateLeadEntryInput) => Promise<void> | void;
  onUpdate: (payload: UpdateLeadEntryInput) => Promise<void> | void;
}

export function LeadDetailPanel({
  mode,
  lead,
  users,
  defaultAssignedTo = null,
  isLoading,
  error,
  onStartCreate,
  onCreate,
  onUpdate,
}: LeadDetailPanelProps) {
  const [form, setForm] = useState<LeadEditorFormState>(() =>
    mode === 'edit' && lead
      ? formFromLead(lead)
      : { ...EMPTY_EDITOR_FORM, assignedTo: defaultAssignedTo ?? '' }
  );
  const [hydratedLeadId, setHydratedLeadId] = useState<string | null>(
    mode === 'edit' && lead ? lead.id : null
  );
  const [assigneeTouched, setAssigneeTouched] = useState(false);
  const [appliedDefault, setAppliedDefault] = useState(
    Boolean(mode === 'create' && defaultAssignedTo)
  );

  if (mode === 'edit' && lead && hydratedLeadId !== lead.id) {
    setHydratedLeadId(lead.id);
    setForm(formFromLead(lead));
    setAssigneeTouched(false);
    setAppliedDefault(true);
  } else if (mode === 'create' && hydratedLeadId !== null) {
    setHydratedLeadId(null);
    setForm({ ...EMPTY_EDITOR_FORM, assignedTo: defaultAssignedTo ?? '' });
    setAssigneeTouched(false);
    setAppliedDefault(Boolean(defaultAssignedTo));
  } else if (
    mode === 'create' &&
    !assigneeTouched &&
    !appliedDefault &&
    defaultAssignedTo
  ) {
    setForm((previous) => ({ ...previous, assignedTo: defaultAssignedTo }));
    setAppliedDefault(true);
  }

  const needsLostReason = mode === 'edit' && form.funnelStage === 'lost';
  const saveDisabled =
    isLoading ||
    form.firstName.trim().length === 0 ||
    (needsLostReason && form.lostReason.trim().length === 0);

  const handleSubmit = async () => {
    const phone = contactPhoneRequestFields(form.phoneRegion, form.phoneNational);
    const sharedContact = {
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim() || null,
      email: form.email.trim() || null,
      ...phone,
      instagram_handle: instagramHandleForStorage(form.instagramHandle),
      source: form.source,
      source_detail: form.sourceDetail.trim() || null,
      contact_type: form.contactType,
    };

    try {
      if (mode === 'create') {
        await onCreate({
          ...sharedContact,
          lead_type: form.leadType,
          assigned_to: form.assignedTo || null,
        });
        return;
      }
      await onUpdate({
        funnel_stage: form.funnelStage,
        assigned_to: form.assignedTo || null,
        lost_reason: form.funnelStage === 'lost' ? form.lostReason.trim() : null,
        contact: lead?.contact.id
          ? {
              id: lead.contact.id,
              ...sharedContact,
            }
          : undefined,
      });
    } catch {
      // Keep the form visible so users can correct and retry.
    }
  };

  return (
    <div className='space-y-4'>
      <AdminEditorCard
        title='Lead'
        description='Create a lead or select a row below to edit.'
        actions={
          <>
            {mode === 'edit' ? (
              <Button type='button' variant='secondary' onClick={onStartCreate} disabled={isLoading}>
                Cancel
              </Button>
            ) : null}
            <Button type='submit' form={LEAD_EDITOR_FORM_ID} disabled={saveDisabled}>
              {isLoading
                ? mode === 'create'
                  ? 'Creating...'
                  : 'Updating...'
                : mode === 'create'
                  ? 'Create lead'
                  : 'Update lead'}
            </Button>
          </>
        }
      >
        {error ? (
          <StatusBanner variant='error' title='Lead'>
            {error}
          </StatusBanner>
        ) : null}

        {mode === 'edit' && !lead ? (
          <p className='text-sm text-slate-600'>
            {isLoading ? 'Loading lead…' : 'Select a lead below to edit, or create a new lead.'}
          </p>
        ) : (
          <form
            id={LEAD_EDITOR_FORM_ID}
            className='space-y-4'
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <div>
                <Label htmlFor='lead-editor-first-name'>First name</Label>
                <Input
                  id='lead-editor-first-name'
                  value={form.firstName}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, firstName: event.target.value }))
                  }
                  autoComplete='off'
                />
              </div>
              <div>
                <Label htmlFor='lead-editor-last-name'>Last name</Label>
                <Input
                  id='lead-editor-last-name'
                  value={form.lastName}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, lastName: event.target.value }))
                  }
                  autoComplete='off'
                />
              </div>
              <div>
                <Label htmlFor='lead-editor-contact-type'>Contact type</Label>
                <Select
                  id='lead-editor-contact-type'
                  value={form.contactType}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      contactType: event.target.value as EntityContactType,
                    }))
                  }
                >
                  {CONTACT_TYPES.map((contactType) => (
                    <option key={contactType} value={contactType}>
                      {formatEnumLabel(contactType)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor='lead-editor-lead-type'>Lead type</Label>
                <Select
                  id='lead-editor-lead-type'
                  value={form.leadType}
                  disabled={mode === 'edit'}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      leadType: event.target.value as LeadType,
                    }))
                  }
                >
                  {LEAD_TYPES.map((leadType) => (
                    <option key={leadType} value={leadType}>
                      {formatEnumLabel(leadType)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <div>
                <Label htmlFor='lead-editor-email'>Email</Label>
                <Input
                  id='lead-editor-email'
                  type='email'
                  value={form.email}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, email: event.target.value }))
                  }
                  autoComplete='off'
                />
              </div>
              <div>
                <PhoneField
                  variant='compact'
                  combinedLabel='Phone number'
                  regionLabel='Phone country / region'
                  nationalLabel='Phone number (national digits)'
                  region={form.phoneRegion}
                  national={form.phoneNational}
                  onRegionChange={(value) =>
                    setForm((previous) => ({ ...previous, phoneRegion: value }))
                  }
                  onNationalChange={(value) =>
                    setForm((previous) => ({ ...previous, phoneNational: value }))
                  }
                  nationalInputId='lead-editor-phone-national'
                />
              </div>
              <div>
                <Label htmlFor='lead-editor-instagram'>Instagram</Label>
                <div className='relative'>
                  <span
                    className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-slate-500 sm:text-sm'
                    aria-hidden
                  >
                    @
                  </span>
                  <Input
                    id='lead-editor-instagram'
                    className='pl-7'
                    value={form.instagramHandle}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        instagramHandle: instagramHandleForStorage(event.target.value) ?? '',
                      }))
                    }
                    placeholder='username'
                    autoComplete='off'
                  />
                </div>
              </div>
              <div>
                <Label htmlFor='lead-editor-assigned-to'>Assigned to</Label>
                <Select
                  id='lead-editor-assigned-to'
                  value={form.assignedTo}
                  onChange={(event) => {
                    setAssigneeTouched(true);
                    setForm((previous) => ({ ...previous, assignedTo: event.target.value }));
                  }}
                >
                  <option value=''>Unassigned</option>
                  {form.assignedTo && !users.some((user) => user.sub === form.assignedTo) ? (
                    <option value={form.assignedTo}>{form.assignedTo}</option>
                  ) : null}
                  {users.map((user) => (
                    <option key={user.sub} value={user.sub}>
                      {user.name || user.email || user.sub}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <div>
                <Label htmlFor='lead-editor-source'>Source</Label>
                <Select
                  id='lead-editor-source'
                  value={form.source}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      source: event.target.value as ContactSource,
                    }))
                  }
                >
                  {CONTACT_SOURCES.map((sourceOption) => (
                    <option key={sourceOption} value={sourceOption}>
                      {formatEnumLabel(sourceOption)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className='sm:col-span-2'>
                <Label htmlFor='lead-editor-source-detail'>Source detail</Label>
                <Input
                  id='lead-editor-source-detail'
                  value={form.sourceDetail}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, sourceDetail: event.target.value }))
                  }
                  autoComplete='off'
                />
              </div>
              {mode === 'edit' ? (
                <div>
                  <Label htmlFor='lead-editor-stage'>Stage</Label>
                  <Select
                    id='lead-editor-stage'
                    value={form.funnelStage}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        funnelStage: event.target.value as FunnelStage,
                      }))
                    }
                  >
                    {FUNNEL_STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {formatEnumLabel(stage)}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
            </div>

            {needsLostReason ? (
              <div>
                <Label htmlFor='lead-editor-lost-reason'>Lost reason</Label>
                <Textarea
                  id='lead-editor-lost-reason'
                  value={form.lostReason}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, lostReason: event.target.value }))
                  }
                  rows={3}
                />
              </div>
            ) : null}

          </form>
        )}
      </AdminEditorCard>

      <ContactNotesPanel
        contact={
          lead?.contact.id
            ? {
                id: lead.contact.id,
                first_name: lead.contact.firstName ?? '',
                last_name: lead.contact.lastName,
                email: lead.contact.email,
              }
            : null
        }
        adminUsers={users}
        title='Notes'
        description='These are the same standalone contact notes used on the Contacts page.'
      />

      {mode === 'edit' && lead ? (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <ActivityTimeline events={lead.events} users={users} />
          <LeadConversationCard contactId={lead.contact.id} />
        </div>
      ) : null}
    </div>
  );
}
