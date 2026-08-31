'use client';

import { useState } from 'react';

import type { AdminUser, LeadDetail } from '@/types/leads';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export interface LeadQuickActionsProps {
  lead: LeadDetail;
  users: AdminUser[];
  isLoading: boolean;
  onMarkConverted: () => Promise<void> | void;
  onMarkLost: (lostReason: string) => Promise<void> | void;
  onAssign: (assignedTo: string | null) => Promise<void> | void;
}

export function LeadQuickActions({
  lead,
  users,
  isLoading,
  onMarkConverted,
  onMarkLost,
  onAssign,
}: LeadQuickActionsProps) {
  const [isMarkLostOpen, setIsMarkLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState('');

  return (
    <Card title='Quick Actions' className='h-full space-y-3'>
      <div className='flex flex-wrap gap-2'>
        {lead.contact.email ? (
          <a
            href={`mailto:${lead.contact.email}`}
            className='inline-flex h-9 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50'
          >
            Send email
          </a>
        ) : null}
        <Button type='button' variant='outline' disabled={isLoading} onClick={() => void onMarkConverted()}>
          Mark converted
        </Button>
        <Button
          type='button'
          variant='danger'
          disabled={isLoading}
          onClick={() => setIsMarkLostOpen((current) => !current)}
        >
          Mark lost
        </Button>
      </div>
      {isMarkLostOpen ? (
        <div className='space-y-2 rounded-md border border-slate-200 bg-white p-3'>
          <Textarea
            value={lostReason}
            onChange={(event) => setLostReason(event.target.value)}
            placeholder='Lost reason (required)'
          />
          <div className='flex gap-2'>
            <Button
              type='button'
              disabled={isLoading || lostReason.trim().length === 0}
              onClick={async () => {
                await onMarkLost(lostReason.trim());
                setLostReason('');
                setIsMarkLostOpen(false);
              }}
            >
              Confirm lost
            </Button>
            <Button
              type='button'
              variant='ghost'
              onClick={() => {
                setLostReason('');
                setIsMarkLostOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <Select
        value={lead.assignedTo ?? ''}
        onChange={(event) => void onAssign(event.target.value || null)}
        disabled={isLoading}
      >
        <option value=''>Unassigned</option>
        {users.map((user) => (
          <option key={user.sub} value={user.sub}>
            {user.name || user.email || user.sub}
          </option>
        ))}
      </Select>
    </Card>
  );
}
