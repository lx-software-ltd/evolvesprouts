'use client';

import { useEffect, useState } from 'react';

import type { AdminUser, FunnelStage, LeadSummary, LostReason } from '@/types/leads';
import { FUNNEL_STAGES, LOST_REASON_LABELS, LOST_REASONS } from '@/types/leads';

import { leadDisplayName } from './leads-table-row';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import { formatEnumLabel } from '@/lib/format';

export interface LeadsBulkActionsProps {
  selectedCount: number;
  selectedLeads: LeadSummary[];
  users: AdminUser[];
  onBulkAssign: (assignedTo: string | null) => Promise<void> | void;
  onBulkStageChange: (stage: FunnelStage, lostReason?: LostReason) => Promise<void> | void;
  onBulkMerge: (leadIds: string[], keeperLeadId: string) => Promise<void> | void;
}

/**
 * Bulk toolbar shown between the filters and the table once rows are
 * checked. Assign and "lost" stage changes confirm before running; the
 * confirm buttons show the shared in-flight state while the batch runs.
 */
export function LeadsBulkActions({
  selectedCount,
  selectedLeads,
  users,
  onBulkAssign,
  onBulkStageChange,
  onBulkMerge,
}: LeadsBulkActionsProps) {
  const [pendingAssignee, setPendingAssignee] = useState<string | null | undefined>(undefined);
  const [pendingStage, setPendingStage] = useState<FunnelStage | ''>('');
  const [lostReason, setLostReason] = useState<LostReason | ''>('');
  const [running, setRunning] = useState<'assign' | 'stage' | 'merge' | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [keeperLeadId, setKeeperLeadId] = useState('');

  useEffect(() => {
    if (!mergeOpen) {
      return;
    }
    setKeeperLeadId((current) => current || selectedLeads[0]?.id || '');
  }, [mergeOpen, selectedLeads]);

  if (selectedCount <= 0) {
    return null;
  }

  const pendingAssigneeValue =
    pendingAssignee === undefined ? '' : pendingAssignee === null ? '__none__' : pendingAssignee;
  const isRunning = running !== null;
  const canMerge = selectedCount >= 2;

  async function runAssign() {
    if (pendingAssignee === undefined) {
      return;
    }
    setRunning('assign');
    try {
      await onBulkAssign(pendingAssignee);
      setPendingAssignee(undefined);
    } finally {
      setRunning(null);
    }
  }

  async function runStage(stage: FunnelStage, reason?: LostReason) {
    setRunning('stage');
    try {
      await onBulkStageChange(stage, reason);
      setPendingStage('');
      setLostReason('');
    } finally {
      setRunning(null);
    }
  }

  async function runMerge() {
    if (!keeperLeadId) {
      return;
    }
    setRunning('merge');
    try {
      await onBulkMerge(
        selectedLeads.map((lead) => lead.id),
        keeperLeadId
      );
      setMergeOpen(false);
    } finally {
      setRunning(null);
    }
  }

  return (
    <>
      <div
        className='mb-3 flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:flex-row md:items-center md:justify-between'
        data-testid='leads-bulk-actions'
      >
        <p className='text-sm text-slate-700'>{selectedCount} lead(s) selected</p>
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          {canMerge ? (
            <Button
              type='button'
              variant='outline'
              className='w-full shrink-0 self-start whitespace-nowrap sm:w-auto sm:self-auto'
              disabled={isRunning}
              onClick={() => setMergeOpen(true)}
            >
              Merge leads
            </Button>
          ) : null}
          <div className='grid w-full shrink-0 grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2'>
            <Select
              aria-label='Bulk assign assignee'
              className='sm:w-40'
              value={pendingAssigneeValue}
              disabled={isRunning}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) {
                  setPendingAssignee(undefined);
                  return;
                }
                setPendingAssignee(value === '__none__' ? null : value);
              }}
            >
              <option value=''>Assign to...</option>
              <option value='__none__'>Unassign</option>
              {users.map((user) => (
                <option key={user.sub} value={user.sub}>
                  {user.name || user.email || user.sub}
                </option>
              ))}
            </Select>
            <Select
              aria-label='Bulk set stage'
              className='sm:w-40'
              value={pendingStage}
              disabled={isRunning}
              onChange={(event) => {
                const stage = event.target.value as FunnelStage | '';
                if (!stage) {
                  setPendingStage('');
                  return;
                }
                setPendingStage(stage);
                if (stage !== 'lost') {
                  void runStage(stage);
                }
              }}
            >
              <option value=''>Set stage...</option>
              {FUNNEL_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {formatEnumLabel(stage)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {pendingAssignee !== undefined ? (
          <div className='flex flex-wrap gap-2'>
            <Button type='button' loading={running === 'assign'} onClick={() => void runAssign()}>
              Confirm assign
            </Button>
            <Button
              type='button'
              variant='ghost'
              disabled={isRunning}
              onClick={() => {
                setPendingAssignee(undefined);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null}
        {pendingStage === 'lost' ? (
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
            <Select
              aria-label='Bulk lost reason'
              value={lostReason}
              disabled={isRunning}
              onChange={(event) => setLostReason(event.target.value as LostReason | '')}
            >
              <option value=''>Select a lost reason</option>
              {LOST_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {LOST_REASON_LABELS[reason]}
                </option>
              ))}
            </Select>
            <div className='flex gap-2'>
              <Button
                type='button'
                disabled={lostReason === ''}
                loading={running === 'stage'}
                onClick={() => {
                  if (lostReason) {
                    void runStage('lost', lostReason);
                  }
                }}
              >
                Confirm lost stage
              </Button>
              <Button
                type='button'
                variant='ghost'
                disabled={isRunning}
                onClick={() => {
                  setLostReason('');
                  setPendingStage('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={mergeOpen}
        title='Merge selected leads'
        description='Notes, activity, conversations, enrollments, invoices, and tags from the other selected leads and their contacts will move onto the keeper lead and contact. Orphaned contacts are deleted.'
        confirmLabel='Merge leads'
        variant='danger'
        confirmDisabled={!keeperLeadId}
        confirmLoading={running === 'merge'}
        confirmLoadingLabel='Merging…'
        onCancel={() => {
          if (running !== 'merge') {
            setMergeOpen(false);
          }
        }}
        onConfirm={() => void runMerge()}
      >
        <fieldset className='space-y-2'>
          <legend className='text-sm font-medium text-slate-900'>Keeper lead</legend>
          {selectedLeads.map((lead) => {
            const email = lead.contact.email?.trim();
            const meta = [formatEnumLabel(lead.funnelStage), formatEnumLabel(lead.leadType)]
              .filter(Boolean)
              .join(' · ');
            return (
              <label
                key={lead.id}
                className='flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700'
              >
                <input
                  type='radio'
                  name='keeper-lead'
                  className='mt-0.5 h-4 w-4 border-slate-300 text-slate-900'
                  checked={keeperLeadId === lead.id}
                  disabled={running === 'merge'}
                  onChange={() => setKeeperLeadId(lead.id)}
                />
                <span className='min-w-0'>
                  <span className='block font-medium text-slate-900'>{leadDisplayName(lead)}</span>
                  {email ? <span className='block wrap-anywhere text-slate-600'>{email}</span> : null}
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
