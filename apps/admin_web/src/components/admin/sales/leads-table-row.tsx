'use client';

import type { ReactNode } from 'react';

import type { LeadSummary } from '@/types/leads';

import { ContactIcon } from '@/components/icons/action-icons';
import { AdminDataTableCell, AdminDataTableCellMeta } from '@/components/ui/admin-data-table';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { formatDate, formatEnumLabel } from '@/lib/format';
import { adminContactDeepLink } from '@/lib/inbox-conversation-name';

import { getStageBadgeClass } from './stage-utils';

/** `<td>` count per leads row: expand, checkbox, six data columns, Operations. */
export const LEADS_TABLE_COLUMN_COUNT = 9;

export function leadDisplayName(lead: LeadSummary): string {
  return [lead.contact.firstName, lead.contact.lastName].filter(Boolean).join(' ') || 'Unnamed lead';
}

export interface LeadsTableRowProps {
  lead: LeadSummary;
  expanded: boolean;
  isChecked: boolean;
  onToggle: () => void;
  onCheck: (leadId: string, checked: boolean) => void;
  /** Editor rendered beneath the row while it is expanded. */
  detail: ReactNode;
}

export function LeadsTableRow({ lead, expanded, isChecked, onToggle, onCheck, detail }: LeadsTableRowProps) {
  const contactId = lead.contact.id?.trim() ?? '';
  const name = leadDisplayName(lead);
  const stageLabel = formatEnumLabel(lead.funnelStage);

  return (
    <AdminExpandableRow
      id={lead.id}
      label={name}
      expanded={expanded}
      onToggle={onToggle}
      columnCount={LEADS_TABLE_COLUMN_COUNT}
      cells={
        <>
          <AdminDataTableCell
            className='w-10 pr-0'
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <input
              type='checkbox'
              aria-label={`Select ${name}`}
              className='h-4 w-4 rounded border-slate-300 text-slate-900'
              checked={isChecked}
              onChange={(event) => onCheck(lead.id, event.target.checked)}
            />
          </AdminDataTableCell>
          <AdminDataTableCell className='font-medium text-slate-900'>
            {name}
            <AdminDataTableCellMeta>
              {[lead.contact.email, stageLabel].filter(Boolean).join(' · ')}
            </AdminDataTableCellMeta>
          </AdminDataTableCell>
          <AdminDataTableCell priority='secondary' className='text-slate-700'>
            {lead.contact.email ?? '—'}
          </AdminDataTableCell>
          <AdminDataTableCell priority='tertiary' className='text-slate-700'>
            {lead.contact.source ? formatEnumLabel(lead.contact.source) : '—'}
          </AdminDataTableCell>
          <AdminDataTableCell priority='secondary'>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getStageBadgeClass(lead.funnelStage)}`}
            >
              {stageLabel}
            </span>
          </AdminDataTableCell>
          <AdminDataTableCell priority='tertiary' className='text-slate-700'>
            {formatDate(lead.createdAt)}
          </AdminDataTableCell>
          <AdminDataTableCell priority='tertiary' className='text-slate-700'>
            <span className={lead.daysInStage > 7 ? 'font-semibold text-amber-700' : ''}>{lead.daysInStage}</span>
          </AdminDataTableCell>
        </>
      }
      actions={
        <AdminRowActions
          actions={[
            {
              key: 'contact',
              label: 'Open contact',
              icon: <ContactIcon className='h-4 w-4 shrink-0' aria-hidden />,
              href: contactId ? adminContactDeepLink(contactId) : undefined,
              hidden: !contactId,
            },
          ]}
        />
      }
      detail={detail}
    />
  );
}
