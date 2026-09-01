'use client';

import { useMemo, useState } from 'react';

import type { AdminUser, FunnelStage, LeadListFilters, LeadSummary } from '@/types/leads';

import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { Button } from '@/components/ui/button';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';

import { LeadExportButton } from './lead-export-button';
import { LeadsBulkActions } from './leads-bulk-actions';
import { LeadsFilterBar } from './leads-filter-bar';
import { LeadsTableRow } from './leads-table-row';

export interface LeadsTableProps {
  leads: LeadSummary[];
  filters: LeadListFilters;
  users: AdminUser[];
  selectedLeadId: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  onSelectLead: (leadId: string) => void;
  onFilterChange: <TKey extends keyof LeadListFilters>(
    key: TKey,
    value: LeadListFilters[TKey]
  ) => void;
  onRefresh: () => Promise<void> | void;
  onBulkAssign: (leadIds: string[], assignedTo: string | null) => Promise<void> | void;
  onBulkStageChange: (
    leadIds: string[],
    stage: FunnelStage,
    lostReason?: string
  ) => Promise<void> | void;
}

export function LeadsTable({
  leads,
  filters,
  users,
  selectedLeadId,
  isLoading,
  isLoadingMore,
  error,
  hasMore,
  onLoadMore,
  onSelectLead,
  onFilterChange,
  onRefresh,
  onBulkAssign,
  onBulkStageChange,
}: LeadsTableProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const assigneeLabelBySub = useMemo(() => {
    const labels = new Map<string, string>();
    for (const user of users) {
      labels.set(user.sub, user.name || user.email || user.sub);
    }
    return labels;
  }, [users]);

  const resolveAssigneeLabel = (assignedTo: string | null): string => {
    if (!assignedTo) {
      return 'Unassigned';
    }
    return assigneeLabelBySub.get(assignedTo) ?? assignedTo;
  };

  const handleCheck = (leadId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...current, leadId] : current.filter((entry) => entry !== leadId)
    );
  };

  return (
    <PaginatedTableCard
      title='Leads'
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      hasMore={hasMore}
      error={error}
      loadingLabel='Loading leads...'
      onLoadMore={onLoadMore}
      toolbar={
        <div className='mb-3 space-y-3'>
          <div className='flex flex-wrap justify-start gap-2'>
            <Button type='button' variant='ghost' onClick={() => void onRefresh()}>
              Refresh
            </Button>
            <LeadExportButton filters={filters} />
          </div>
          <LeadsFilterBar filters={filters} users={users} onFilterChange={onFilterChange} />
          <LeadsBulkActions
            selectedCount={selectedIds.length}
            users={users}
            onBulkAssign={(assignedTo) => {
              const normalizedAssignedTo = assignedTo === '__none__' ? null : assignedTo;
              void onBulkAssign(selectedIds, normalizedAssignedTo);
              setSelectedIds([]);
            }}
            onBulkStageChange={(stage, lostReason) => {
              void onBulkStageChange(selectedIds, stage, lostReason);
              setSelectedIds([]);
            }}
          />
        </div>
      }
    >
      <AdminDataTable tableClassName='min-w-[1080px]'>
        <AdminDataTableHead sticky>
          <tr>
            <AdminDataTableHeadCell>
              <input
                type='checkbox'
                checked={leads.length > 0 && selectedIds.length === leads.length}
                onChange={(event) =>
                  setSelectedIds(event.target.checked ? leads.map((lead) => lead.id) : [])
                }
              />
            </AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Email</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Source</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Stage</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Assigned</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Created</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Days in stage</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        </AdminDataTableHead>
        <AdminDataTableBody>
          {isLoading ? (
            <tr>
              <AdminDataTableCell colSpan={9} className='py-8 text-sm text-slate-600'>
                Loading leads...
              </AdminDataTableCell>
            </tr>
          ) : leads.length === 0 ? (
            <tr>
              <AdminDataTableCell colSpan={9} className='py-8 text-sm text-slate-600'>
                No leads found for these filters.
              </AdminDataTableCell>
            </tr>
          ) : (
            leads.map((lead) => (
              <LeadsTableRow
                key={lead.id}
                lead={lead}
                assigneeLabel={resolveAssigneeLabel(lead.assignedTo)}
                isSelected={selectedLeadId === lead.id}
                isChecked={selectedSet.has(lead.id)}
                onSelect={onSelectLead}
                onCheck={handleCheck}
              />
            ))
          )}
        </AdminDataTableBody>
      </AdminDataTable>
    </PaginatedTableCard>
  );
}
