'use client';

import { useState } from 'react';

import type { AdminUser, FunnelStage, LostReason } from '@/types/leads';
import { FUNNEL_STAGES, LOST_REASON_LABELS, LOST_REASONS } from '@/types/leads';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { formatEnumLabel } from '@/lib/format';

export interface LeadsBulkActionsProps {
  selectedCount: number;
  users: AdminUser[];
  onBulkAssign: (assignedTo: string | null) => Promise<void> | void;
  onBulkStageChange: (stage: FunnelStage, lostReason?: LostReason) => Promise<void> | void;
}

/**
 * Bulk toolbar shown between the filters and the table once rows are
 * checked. Assign and "lost" stage changes confirm before running; the
 * confirm buttons show the shared in-flight state while the batch runs.
 */
export function LeadsBulkActions({
  selectedCount,
  users,
  onBulkAssign,
  onBulkStageChange,
}: LeadsBulkActionsProps) {
  const [pendingAssignee, setPendingAssignee] = useState<string | null | undefined>(undefined);
  const [pendingStage, setPendingStage] = useState<FunnelStage | ''>('');
  const [lostReason, setLostReason] = useState<LostReason | ''>('');
  const [running, setRunning] = useState<'assign' | 'stage' | null>(null);

  if (selectedCount <= 0) {
    return null;
  }

  const pendingAssigneeValue =
    pendingAssignee === undefined ? '' : pendingAssignee === null ? '__none__' : pendingAssignee;
  const isRunning = running !== null;

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

  return (
    <div
      className='mb-3 flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:flex-row md:items-center md:justify-between'
      data-testid='leads-bulk-actions'
    >
      <p className='text-sm text-slate-700'>{selectedCount} lead(s) selected</p>
      <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
        <Select
          aria-label='Bulk assign assignee'
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
  );
}
