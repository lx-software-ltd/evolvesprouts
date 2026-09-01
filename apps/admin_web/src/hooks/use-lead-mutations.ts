'use client';

import { useCallback } from 'react';

import { updateAdminContact } from '@/lib/entity-api';
import { createLead, createLeadNote, updateLead } from '@/lib/leads-api';
import type { ContactSource, FunnelStage, LeadDetail, LeadType } from '@/types/leads';
import type { components } from '@/types/generated/admin-api.generated';

import { useMutationRunner } from './use-mutation-runner';

type EntityContactType = components['schemas']['EntityContactType'];

interface MutationOptions {
  onSuccess?: (leadId?: string) => Promise<void> | void;
}

export interface CreateLeadEntryInput {
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
}

export interface UpdateLeadEntryInput {
  funnel_stage: FunnelStage;
  assigned_to?: string | null;
  lost_reason?: string | null;
  contact?: {
    id: string;
    first_name: string;
    last_name?: string | null;
    email?: string | null;
    phone_region?: string | null;
    phone_number?: string | null;
    instagram_handle?: string | null;
    source: ContactSource;
    source_detail?: string | null;
    contact_type?: EntityContactType;
  };
}

export function useLeadMutations({ onSuccess }: MutationOptions = {}) {
  const { isLoading, error, runWithState } = useMutationRunner('Failed to save lead changes.');

  const createLeadEntry = useCallback(
    async (body: CreateLeadEntryInput): Promise<LeadDetail | null> =>
      runWithState(async () => {
        const created = await createLead(body);
        await onSuccess?.(created?.id);
        return created;
      }),
    [onSuccess, runWithState]
  );

  const updateLeadEntry = useCallback(
    async (id: string, body: UpdateLeadEntryInput): Promise<LeadDetail | null> =>
      runWithState(async () => {
        if (body.contact) {
          const { id: contactId, source, ...contactFields } = body.contact;
          await updateAdminContact(contactId, {
            ...contactFields,
            ...(source !== 'referral' ? { source } : {}),
          });
        }
        const updated = await updateLead(id, {
          funnel_stage: body.funnel_stage,
          assigned_to: body.assigned_to ?? null,
          lost_reason: body.lost_reason ?? null,
        });
        await onSuccess?.(id);
        return updated;
      }),
    [onSuccess, runWithState]
  );

  const updateStage = useCallback(
    async (id: string, stage: FunnelStage, lostReason?: string): Promise<LeadDetail | null> =>
      runWithState(async () => {
        const updated = await updateLead(id, {
          funnel_stage: stage,
          lost_reason: lostReason ?? null,
        });
        await onSuccess?.(id);
        return updated;
      }),
    [onSuccess, runWithState]
  );

  const assignLead = useCallback(
    async (id: string, assignedTo: string | null): Promise<LeadDetail | null> =>
      runWithState(async () => {
        const updated = await updateLead(id, { assigned_to: assignedTo });
        await onSuccess?.(id);
        return updated;
      }),
    [onSuccess, runWithState]
  );

  const addNote = useCallback(
    async (leadId: string, content: string) =>
      runWithState(async () => {
        await createLeadNote(leadId, { content });
        await onSuccess?.(leadId);
      }),
    [onSuccess, runWithState]
  );

  return {
    isLoading,
    error,
    createLeadEntry,
    updateLeadEntry,
    updateStage,
    assignLead,
    addNote,
  };
}
