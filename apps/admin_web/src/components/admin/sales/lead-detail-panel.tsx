'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ActivityTimeline } from './activity-timeline';
import { LeadAiSuggestionPanel } from './lead-ai-suggestion-panel';
import { LeadConversationCard } from './lead-conversation-card';

import { ContactNotesPanel } from '@/components/admin/contacts/contact-notes-panel';
import { CONTACT_TYPES } from '@/lib/contacts/contacts-panel-constants';
import { instagramHandleForStorage } from '@/lib/contacts/contacts-panel-helpers';
import { formatEnumLabel } from '@/lib/format';
import { contactPhoneRequestFields } from '@/lib/phone-request';
import { CONTACT_SOURCES, FUNNEL_STAGES, LEAD_TYPES, LOST_REASON_LABELS, LOST_REASONS } from '@/types/leads';
import type {
  AdminUser,
  ContactSource,
  FunnelStage,
  LeadDetail,
  LeadSummary,
  LeadType,
  LostReason,
} from '@/types/leads';
import type { components } from '@/types/generated/admin-api.generated';
import type { CreateLeadEntryInput, UpdateLeadEntryInput } from '@/hooks/use-lead-mutations';

import { StatusBanner } from '@/components/status-banner';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Input } from '@/components/ui/input';
import { PhoneField } from '@/components/ui/phone-field';
import { Select } from '@/components/ui/select';

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
  lostReason: LostReason | '';
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

function formFromLead(lead: LeadSummary): LeadEditorFormState {
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
  /** Summary row the editor opened from (edit mode); seeds the fields immediately. */
  lead: LeadSummary | null;
  /** Full detail (events, notes) once loaded; drives the Activity disclosure. */
  detail?: LeadDetail | null;
  isDetailLoading?: boolean;
  users: AdminUser[];
  defaultAssignedTo?: string | null;
  isSaving: boolean;
  error: string;
  onCreate: (payload: CreateLeadEntryInput) => Promise<void> | void;
  onUpdate: (payload: UpdateLeadEntryInput) => Promise<void> | void;
  /** Reports unsaved edits so the row hook can guard switching rows. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Editor rendered inside the expanded lead row (or the draft row). No title:
 * the row above names the lead. Contact and lead fields first, then
 * disclosures for Notes, AI suggestion, Activity, and Conversation, then one
 * action row.
 */
export function LeadDetailPanel({
  mode,
  lead,
  detail = null,
  isDetailLoading = false,
  users,
  defaultAssignedTo = null,
  isSaving,
  error,
  onCreate,
  onUpdate,
  onDirtyChange,
}: LeadDetailPanelProps) {
  const [form, setForm] = useState<LeadEditorFormState>(() =>
    mode === 'edit' && lead
      ? formFromLead(lead)
      : { ...EMPTY_EDITOR_FORM, assignedTo: defaultAssignedTo ?? '' }
  );
  const [assigneeTouched, setAssigneeTouched] = useState(false);
  const [appliedDefault, setAppliedDefault] = useState(Boolean(mode === 'create' && defaultAssignedTo));
  const [notesOpen, setNotesOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);

  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });
  // Collapsing the row unmounts the editor; its edits are gone with it.
  useEffect(() => () => onDirtyChangeRef.current?.(false), []);

  const update = useCallback((patch: Partial<LeadEditorFormState>) => {
    onDirtyChangeRef.current?.(true);
    setForm((previous) => ({ ...previous, ...patch }));
  }, []);

  if (mode === 'create' && !assigneeTouched && !appliedDefault && defaultAssignedTo) {
    setForm((previous) => ({ ...previous, assignedTo: defaultAssignedTo }));
    setAppliedDefault(true);
  }

  const needsLostReason = mode === 'edit' && form.funnelStage === 'lost';
  const saveDisabled =
    isSaving || form.firstName.trim().length === 0 || (needsLostReason && form.lostReason === '');

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
          ...(assigneeTouched || form.assignedTo ? { assigned_to: form.assignedTo || null } : {}),
        });
        onDirtyChangeRef.current?.(false);
        return;
      }
      await onUpdate({
        funnel_stage: form.funnelStage,
        assigned_to: form.assignedTo || null,
        lost_reason: form.funnelStage === 'lost' ? form.lostReason || null : null,
        contact: lead?.contact.id
          ? {
              id: lead.contact.id,
              ...sharedContact,
            }
          : undefined,
      });
      onDirtyChangeRef.current?.(false);
    } catch {
      // Keep the form visible so users can correct and retry.
    }
  };

  const contactId = lead?.contact.id ?? null;
  const events = detail?.events ?? [];

  return (
    <AdminEditorPanel
      status={
        error ? (
          <StatusBanner variant='error' title='Lead'>
            {error}
          </StatusBanner>
        ) : null
      }
      actions={
        <AdminEditorActions
          mode={mode}
          formId={LEAD_EDITOR_FORM_ID}
          isSaving={isSaving}
          submitDisabled={saveDisabled}
          submitLabel={mode === 'create' ? 'Create lead' : 'Update lead'}
        />
      }
    >
      <form
        id={LEAD_EDITOR_FORM_ID}
        className='space-y-4'
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <AdminFieldGrid columns={4}>
          <AdminField label='First name' htmlFor='lead-editor-first-name' required>
            <Input
              id='lead-editor-first-name'
              value={form.firstName}
              onChange={(event) => update({ firstName: event.target.value })}
              autoComplete='off'
            />
          </AdminField>
          <AdminField label='Last name' htmlFor='lead-editor-last-name'>
            <Input
              id='lead-editor-last-name'
              value={form.lastName}
              onChange={(event) => update({ lastName: event.target.value })}
              autoComplete='off'
            />
          </AdminField>
          <AdminField label='Contact type' htmlFor='lead-editor-contact-type'>
            <Select
              id='lead-editor-contact-type'
              value={form.contactType}
              onChange={(event) => update({ contactType: event.target.value as EntityContactType })}
            >
              {CONTACT_TYPES.map((contactType) => (
                <option key={contactType} value={contactType}>
                  {formatEnumLabel(contactType)}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Lead type' htmlFor='lead-editor-lead-type'>
            <Select
              id='lead-editor-lead-type'
              value={form.leadType}
              disabled={mode === 'edit'}
              onChange={(event) => update({ leadType: event.target.value as LeadType })}
            >
              {LEAD_TYPES.map((leadType) => (
                <option key={leadType} value={leadType}>
                  {formatEnumLabel(leadType)}
                </option>
              ))}
            </Select>
          </AdminField>
        </AdminFieldGrid>

        <AdminFieldGrid columns={4}>
          <AdminField label='Email' htmlFor='lead-editor-email'>
            <Input
              id='lead-editor-email'
              type='email'
              value={form.email}
              onChange={(event) => update({ email: event.target.value })}
              autoComplete='off'
            />
          </AdminField>
          {/* Exception: the phone number is a region + national number pair rendered as two controls in one field. */}
          <AdminField>
            <PhoneField
              variant='compact'
              combinedLabel='Phone number'
              regionLabel='Phone country / region'
              nationalLabel='Phone number (national digits)'
              region={form.phoneRegion}
              national={form.phoneNational}
              onRegionChange={(value) => update({ phoneRegion: value })}
              onNationalChange={(value) => update({ phoneNational: value })}
              nationalInputId='lead-editor-phone-national'
            />
          </AdminField>
          <AdminField label='Instagram' htmlFor='lead-editor-instagram'>
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
                  update({ instagramHandle: instagramHandleForStorage(event.target.value) ?? '' })
                }
                placeholder='username'
                autoComplete='off'
              />
            </div>
          </AdminField>
          <AdminField label='Assigned to' htmlFor='lead-editor-assigned-to'>
            <Select
              id='lead-editor-assigned-to'
              value={form.assignedTo}
              onChange={(event) => {
                setAssigneeTouched(true);
                update({ assignedTo: event.target.value });
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
          </AdminField>
        </AdminFieldGrid>

        <AdminFieldGrid columns={4}>
          <AdminField label='Source' htmlFor='lead-editor-source'>
            <Select
              id='lead-editor-source'
              value={form.source}
              onChange={(event) => update({ source: event.target.value as ContactSource })}
            >
              {CONTACT_SOURCES.map((sourceOption) => (
                <option key={sourceOption} value={sourceOption}>
                  {formatEnumLabel(sourceOption)}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Source detail' htmlFor='lead-editor-source-detail' span={2}>
            <Input
              id='lead-editor-source-detail'
              value={form.sourceDetail}
              onChange={(event) => update({ sourceDetail: event.target.value })}
              autoComplete='off'
            />
          </AdminField>
          {mode === 'edit' ? (
            <AdminField label='Stage' htmlFor='lead-editor-stage'>
              <Select
                id='lead-editor-stage'
                value={form.funnelStage}
                onChange={(event) => update({ funnelStage: event.target.value as FunnelStage })}
              >
                {FUNNEL_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {formatEnumLabel(stage)}
                  </option>
                ))}
              </Select>
            </AdminField>
          ) : null}
        </AdminFieldGrid>

        {needsLostReason ? (
          <AdminFieldGrid columns={4}>
            <AdminField label='Lost reason' htmlFor='lead-editor-lost-reason' required>
              <Select
                id='lead-editor-lost-reason'
                value={form.lostReason}
                onChange={(event) => update({ lostReason: event.target.value as LostReason | '' })}
              >
                <option value=''>Select a lost reason</option>
                {LOST_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {LOST_REASON_LABELS[reason]}
                  </option>
                ))}
              </Select>
            </AdminField>
          </AdminFieldGrid>
        ) : null}
      </form>

      {mode === 'edit' && lead ? (
        <>
          <AdminDisclosure id='lead-notes' title='Notes' open={notesOpen} onOpenChange={setNotesOpen}>
            {notesOpen ? (
              <ContactNotesPanel
                layout='embedded'
                contact={
                  contactId
                    ? {
                        id: contactId,
                        first_name: lead.contact.firstName ?? '',
                        last_name: lead.contact.lastName,
                        email: lead.contact.email,
                      }
                    : null
                }
                adminUsers={users}
              />
            ) : null}
          </AdminDisclosure>
          <AdminDisclosure id='lead-ai-suggestion' title='AI suggestion' open={aiOpen} onOpenChange={setAiOpen}>
            {aiOpen ? <LeadAiSuggestionPanel leadId={lead.id} /> : null}
          </AdminDisclosure>
          <AdminDisclosure
            id='lead-activity'
            title='Activity'
            summary={isDetailLoading && !detail ? 'Loading…' : events.length > 0 ? events.length : undefined}
          >
            <ActivityTimeline events={events} users={users} isLoading={isDetailLoading && !detail} />
          </AdminDisclosure>
          <AdminDisclosure
            id='lead-conversation'
            title='Conversation'
            open={conversationOpen}
            onOpenChange={setConversationOpen}
          >
            {conversationOpen ? <LeadConversationCard contactId={contactId} /> : null}
          </AdminDisclosure>
        </>
      ) : null}
    </AdminEditorPanel>
  );
}
