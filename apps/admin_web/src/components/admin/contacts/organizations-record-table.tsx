'use client';

import type { ReactNode } from 'react';

import { relatedRecordActions } from '@/components/admin/contacts/related-record-actions';
import { DeleteIcon } from '@/components/icons/action-icons';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DRAFT_RECORD_ID, type UseExpandedRecordReturn } from '@/hooks/use-expanded-record';
import {
  adminPartyInvoicesDeepLink,
  adminPartySalesConversationsDeepLink,
  adminPartyServiceInstancesDeepLink,
} from '@/lib/contact-related-links';
import { primaryMemberLabel } from '@/lib/contacts/contacts-panel-helpers';
import { formatEnumLabel, formatFamilyOrOrganizationPartyLabel } from '@/lib/format';
import type { EntityListFilters } from '@/types/entity-list';
import type { components } from '@/types/generated/admin-api.generated';

type AdminOrganization = components['schemas']['AdminOrganization'];

const COLUMN_COUNT = 6;

export interface OrganizationsRecordTableProps {
  rows: AdminOrganization[];
  filters: EntityListFilters;
  setFilter: (key: keyof EntityListFilters, value: EntityListFilters[keyof EntityListFilters]) => void;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string;
  loadMore: () => void;
  isSaving: boolean;
  deleteActionError: string;
  onClearDeleteError: () => void;
  expanded: UseExpandedRecordReturn;
  detail: ReactNode;
  onDeleteOrganization: (row: AdminOrganization) => void;
}

export function OrganizationsRecordTable({
  rows,
  filters,
  setFilter,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  loadMore,
  isSaving,
  deleteActionError,
  onClearDeleteError,
  expanded,
  detail,
  onDeleteOrganization,
}: OrganizationsRecordTableProps) {
  return (
    <AdminRecordTable
      aria-label='Organisations'
      columnCount={COLUMN_COUNT}
      rowCount={rows.length}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      hasMore={hasMore}
      onLoadMore={loadMore}
      error={error || deleteActionError}
      errorTitle='Organisations'
      emptyLabel='No organisations match the current filters.'
      filters={
        <AdminFilterBar
          trailing={
            <AdminCreateButton
              label='New organisation'
              active={expanded.isDraftOpen}
              onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
            />
          }
        >
          <AdminFilterField label='Search' htmlFor='crm-orgs-search' className='sm:basis-72'>
            <Input
              id='crm-orgs-search'
              value={filters.query}
              onChange={(e) => {
                onClearDeleteError();
                setFilter('query', e.target.value);
              }}
              placeholder='Organisation name'
            />
          </AdminFilterField>
          <AdminFilterField label='Status' htmlFor='crm-orgs-active'>
            <Select
              id='crm-orgs-active'
              value={filters.active}
              onChange={(e) => {
                onClearDeleteError();
                setFilter('active', e.target.value as EntityListFilters['active']);
              }}
            >
              <option value=''>All</option>
              <option value='true'>Active</option>
              <option value='false'>Archived</option>
            </Select>
          </AdminFilterField>
        </AdminFilterBar>
      }
      head={
        <tr>
          <AdminDataTableHeadCell className='w-10' />
          <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='secondary'>Type</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='secondary'>Members</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='tertiary'>Status</AdminDataTableHeadCell>
          <AdminDataTableOperationsHeadCell />
        </tr>
      }
    >
      {expanded.isDraftOpen ? (
        <AdminExpandableRow
          id={DRAFT_RECORD_ID}
          label='new organisation'
          expanded
          isDraft
          onToggle={expanded.collapse}
          columnCount={COLUMN_COUNT}
          cells={
            <>
              <AdminDataTableCell className='font-medium text-slate-900'>New organisation</AdminDataTableCell>
              <AdminDataTableCell priority='secondary' className='text-slate-400'>
                —
              </AdminDataTableCell>
              <AdminDataTableCell priority='secondary' className='text-slate-400'>
                —
              </AdminDataTableCell>
              <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                —
              </AdminDataTableCell>
            </>
          }
          actions={null}
          detail={detail}
        />
      ) : null}
      {rows.map((row) => {
        const primaryLabel = primaryMemberLabel(row.members);
        const nameCell = formatFamilyOrOrganizationPartyLabel(row.name, primaryLabel) || '—';
        const isOpen = expanded.isExpanded(row.id);
        return (
          <AdminExpandableRow
            key={row.id}
            id={row.id}
            label={nameCell}
            expanded={isOpen}
            onToggle={() => expanded.toggle(row.id)}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell>
                  {nameCell}
                  <AdminDataTableCellMeta>{formatEnumLabel(row.organization_type)}</AdminDataTableCellMeta>
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary'>{formatEnumLabel(row.organization_type)}</AdminDataTableCell>
                <AdminDataTableCell priority='secondary'>{row.members.length}</AdminDataTableCell>
                <AdminDataTableCell priority='tertiary'>{row.active ? 'Active' : 'Archived'}</AdminDataTableCell>
              </>
            }
            actions={
              <AdminRowActions
                actions={[
                  ...relatedRecordActions({
                    salesHref: adminPartySalesConversationsDeepLink(
                      'organization',
                      row.id,
                      row.sales_conversation_channel
                    ),
                    instancesHref: adminPartyServiceInstancesDeepLink('organization', row.id),
                    invoicesHref: adminPartyInvoicesDeepLink(nameCell === '—' ? '' : nameCell),
                    hasSalesConversation: row.has_sales_conversation,
                    hasServiceInstance: row.has_service_instance,
                    hasInvoice: row.has_invoice,
                  }),
                  {
                    key: 'delete',
                    label: 'Delete organisation',
                    icon: <DeleteIcon className='h-4 w-4' />,
                    tone: 'danger',
                    disabled: isSaving,
                    onClick: () => onDeleteOrganization(row),
                  },
                ]}
              />
            }
            detail={isOpen ? detail : null}
          />
        );
      })}
    </AdminRecordTable>
  );
}
