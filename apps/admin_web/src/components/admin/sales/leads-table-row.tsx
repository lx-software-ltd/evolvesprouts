'use client';

import { memo } from 'react';

import type { LeadSummary } from '@/types/leads';

import { ArrowRightIcon } from '@/components/icons/action-icons';
import { AdminDataTableCell } from '@/components/ui/admin-data-table';
import { Button } from '@/components/ui/button';
import { formatDate, formatEnumLabel } from '@/lib/format';

import { getStageBadgeClass } from './stage-utils';

export interface LeadsTableRowProps {
  lead: LeadSummary;
  isSelected: boolean;
  isChecked: boolean;
  onSelect: (leadId: string) => void;
  onCheck: (leadId: string, checked: boolean) => void;
}

export const LeadsTableRow = memo(function LeadsTableRow({
  lead,
  isSelected,
  isChecked,
  onSelect,
  onCheck,
}: LeadsTableRowProps) {
  return (
    <tr
      className={`cursor-pointer ${isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
      onClick={() => onSelect(lead.id)}
    >
      <AdminDataTableCell onClick={(event) => event.stopPropagation()}>
        <input
          type='checkbox'
          checked={isChecked}
          onChange={(event) => onCheck(lead.id, event.target.checked)}
        />
      </AdminDataTableCell>
      <AdminDataTableCell className='text-sm font-medium text-slate-900'>
        {[lead.contact.firstName, lead.contact.lastName].filter(Boolean).join(' ') || 'Unnamed lead'}
      </AdminDataTableCell>
      <AdminDataTableCell className='text-sm text-slate-700'>{lead.contact.email ?? '—'}</AdminDataTableCell>
      <AdminDataTableCell className='text-sm text-slate-700'>
        {lead.contact.source ? formatEnumLabel(lead.contact.source) : '—'}
      </AdminDataTableCell>
      <AdminDataTableCell className='text-sm'>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getStageBadgeClass(lead.funnelStage)}`}
        >
          {formatEnumLabel(lead.funnelStage)}
        </span>
      </AdminDataTableCell>
      <AdminDataTableCell className='text-sm text-slate-700'>{formatDate(lead.createdAt)}</AdminDataTableCell>
      <AdminDataTableCell className='text-sm text-slate-700'>
        <span className={lead.daysInStage > 7 ? 'font-semibold text-amber-700' : ''}>
          {lead.daysInStage}
        </span>
      </AdminDataTableCell>
      <AdminDataTableCell className='text-right' onClick={(event) => event.stopPropagation()}>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          onClick={() => onSelect(lead.id)}
          aria-label='Open lead'
          title='Open lead'
        >
          <ArrowRightIcon className='h-4 w-4' />
        </Button>
      </AdminDataTableCell>
    </tr>
  );
});
