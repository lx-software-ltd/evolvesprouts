'use client';

import { useState } from 'react';

import type { AdminUser, FunnelStage, LostReason } from '@/types/leads';
import { FUNNEL_STAGES, LOST_REASON_LABELS, LOST_REASONS } from '@/types/leads';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

export interface LeadsBulkActionsProps {
  selectedCount: number;
  users: AdminUser[];
  onBulkAssign: (assignedTo: string | null) => void;
  onBulkStageChange: (stage: FunnelStage, lostReason?: LostReason) => void;
}

export function LeadsBulkActions({
  selectedCount,
  users,
  onBulkAssign,
  onBulkStageChange,
}: LeadsBulkActionsProps) {
  const [pendingAssignee, setPendingAssignee] = useState<string | null | undefined>(undefined);
  const [pendingStage, setPendingStage] = useState<FunnelStage | ''>('');
  const [lostReason, setLostReason] = useState<LostReason | ''>('');

  if (selectedCount <= 0) {
    return null;
  }

  const pendingAssigneeValue =
    pendingAssignee === undefined ? '' : pendingAssignee === null ? '__none__' : pendingAssignee;

  return (
    <div className='flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:flex-row md:items-center md:justify-between'>
      <p className='text-sm text-slate-700'>{selectedCount} lead(s) selected</p>
      <div className='grid grid-cols-1 gap-2 md:grid-cols-3'>
        <Select
          aria-label='Bulk assign assignee'
          value={pendingAssigneeValue}
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
          value={pendingStage}
          onChange={(event) => {
            const stage = event.target.value as FunnelStage | '';
            if (!stage) {
              setPendingStage('');
              return;
            }
            setPendingStage(stage);
            if (stage !== 'lost') {
              onBulkStageChange(stage);
              setPendingStage('');
              setLostReason('');
            }
          }}
        >
          <option value=''>Set stage...</option>
          {FUNNEL_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
        </Select>
        <Button
          type='button'
          variant='outline'
          onClick={() => {
            setPendingAssignee(null);
          }}
        >
          Clear assignee
        </Button>
      </div>
      {pendingAssignee !== undefined ? (
        <div className='mt-2 flex flex-wrap gap-2'>
          <Button
            type='button'
            onClick={() => {
              onBulkAssign(pendingAssignee);
              setPendingAssignee(undefined);
            }}
          >
            Confirm assign
          </Button>
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              setPendingAssignee(undefined);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {pendingStage === 'lost' ? (
        <div className='mt-2 space-y-2'>
          <Select
            aria-label='Bulk lost reason'
            value={lostReason}
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
              onClick={() => {
                if (!lostReason) {
                  return;
                }
                onBulkStageChange('lost', lostReason);
                setLostReason('');
                setPendingStage('');
              }}
            >
              Confirm lost stage
            </Button>
            <Button
              type='button'
              variant='ghost'
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
  );
}
