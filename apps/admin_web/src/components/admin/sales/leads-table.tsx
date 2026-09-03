'use client';

import { useMemo, useState, type ReactNode } from 'react';

import type { AdminUser, FunnelStage, LeadListFilters, LeadSummary, LostReason } from '@/types/leads';

import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminDiscardChangesDialog } from '@/components/ui/admin-discard-changes-dialog';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { DRAFT_RECORD_ID, type UseExpandedRecordReturn } from '@/hooks/use-expanded-record';

import { LeadsBulkActions } from './leads-bulk-actions';
import { LeadsFilterBar } from './leads-filter-bar';
import { LEADS_TABLE_COLUMN_COUNT, LeadsTableRow } from './leads-table-row';

export interface LeadsTableProps {
  leads: LeadSummary[];
  /** Deep-linked lead outside the loaded pages; rendered above the list. */
  pinnedLead?: LeadSummary | null;
  filters: LeadListFilters;
  users: AdminUser[];
  expanded: UseExpandedRecordReturn;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  onFilterChange: <TKey extends keyof LeadListFilters>(
    key: TKey,
    value: LeadListFilters[TKey]
  ) => void;
  onBulkAssign: (leadIds: string[], assignedTo: string | null) => Promise<void> | void;
  onBulkStageChange: (
    leadIds: string[],
    stage: FunnelStage,
    lostReason?: LostReason
  ) => Promise<void> | void;
  onBulkMerge: (leadIds: string[], keeperLeadId: string) => Promise<void> | void;
  /** Editor for the open row (draft or lead); mounted only while that row is expanded. */
  renderDetail: (lead: LeadSummary | null) => ReactNode;
}

/**
 * Table-first leads pipeline: filters and `New lead` on top, an optional bulk
 * toolbar once rows are checked, then one expandable row per lead with the
 * lead editor (fields, notes, AI suggestion, activity, conversation) beneath.
 */
export function LeadsTable({
  leads,
  pinnedLead = null,
  filters,
  users,
  expanded,
  isLoading,
  isLoadingMore,
  error,
  hasMore,
  onLoadMore,
  onFilterChange,
  onBulkAssign,
  onBulkStageChange,
  onBulkMerge,
  renderDetail,
}: LeadsTableProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const rows = useMemo(
    () => (pinnedLead && !leads.some((lead) => lead.id === pinnedLead.id) ? [pinnedLead, ...leads] : leads),
    [leads, pinnedLead]
  );
  const selectedLeads = useMemo(
    () => rows.filter((lead) => selectedSet.has(lead.id)),
    [rows, selectedSet]
  );
  const allChecked = rows.length > 0 && rows.every((lead) => selectedSet.has(lead.id));

  const handleCheck = (leadId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...current, leadId] : current.filter((entry) => entry !== leadId)
    );
  };

  return (
    <>
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AdminRecordTable
        aria-label='Leads'
        columnCount={LEADS_TABLE_COLUMN_COUNT}
        rowCount={rows.length}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        error={error}
        errorTitle='Leads'
        emptyLabel='No leads found for these filters.'
        filters={
          <>
            <LeadsFilterBar
              filters={filters}
              users={users}
              onFilterChange={onFilterChange}
              trailing={
                <AdminCreateButton
                  label='New lead'
                  active={expanded.isDraftOpen}
                  onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
                />
              }
            />
            <LeadsBulkActions
              selectedCount={selectedIds.length}
              selectedLeads={selectedLeads}
              users={users}
              onBulkAssign={async (assignedTo) => {
                await onBulkAssign(selectedIds, assignedTo);
                setSelectedIds([]);
              }}
              onBulkStageChange={async (stage, lostReason) => {
                await onBulkStageChange(selectedIds, stage, lostReason);
                setSelectedIds([]);
              }}
              onBulkMerge={async (leadIds, keeperLeadId) => {
                await onBulkMerge(leadIds, keeperLeadId);
                setSelectedIds([]);
              }}
            />
          </>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell className='w-10 pr-0'>
              <input
                type='checkbox'
                aria-label='Select all leads'
                className='h-4 w-4 rounded border-slate-300 text-slate-900'
                checked={allChecked}
                onChange={(event) => setSelectedIds(event.target.checked ? rows.map((lead) => lead.id) : [])}
              />
            </AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Source</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Stage</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Created</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Days in stage</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new lead'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={LEADS_TABLE_COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='w-10 pr-0' />
                <AdminDataTableCell className='font-medium text-slate-900'>New lead</AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
              </>
            }
            actions={null}
            detail={renderDetail(null)}
          />
        ) : null}
        {rows.map((lead) => {
          const isOpen = expanded.isExpanded(lead.id);
          return (
            <LeadsTableRow
              key={lead.id}
              lead={lead}
              expanded={isOpen}
              isChecked={selectedSet.has(lead.id)}
              onToggle={() => expanded.toggle(lead.id)}
              onCheck={handleCheck}
              detail={isOpen ? renderDetail(lead) : null}
            />
          );
        })}
      </AdminRecordTable>
    </>
  );
}
