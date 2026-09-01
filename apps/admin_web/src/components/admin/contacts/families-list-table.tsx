'use client';

import { useCallback } from 'react';

import { RelatedRecordOpsLinks } from '@/components/admin/contacts/related-record-ops-links';
import { DeleteIcon } from '@/components/icons/action-icons';
import { Button } from '@/components/ui/button';
import {
  adminPartyInvoicesDeepLink,
  adminPartySalesConversationsDeepLink,
  adminPartyServiceInstancesDeepLink,
} from '@/lib/contact-related-links';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { Select } from '@/components/ui/select';
import { formatFamilyOrOrganizationPartyLabel } from '@/lib/format';
import type { EntityListFilters } from '@/types/entity-list';
import type { components } from '@/types/generated/admin-api.generated';
import type { MouseEvent } from 'react';

type ApiSchemas = components['schemas'];

export interface FamiliesListTableProps {
  rows: ApiSchemas['AdminFamily'][];
  filters: EntityListFilters;
  setFilter: (key: keyof EntityListFilters, value: EntityListFilters[keyof EntityListFilters]) => void;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string;
  loadMore: () => void;
  isSaving: boolean;
  selectedId: string | null;
  deleteActionError: string;
  onClearDeleteError: () => void;
  onSelectRow: (id: string) => void;
  onDeleteFamily: (row: ApiSchemas['AdminFamily'], event: MouseEvent<HTMLButtonElement>) => void;
}

export function FamiliesListTable({
  rows,
  filters,
  setFilter,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  loadMore,
  isSaving,
  selectedId,
  deleteActionError,
  onClearDeleteError,
  onSelectRow,
  onDeleteFamily,
}: FamiliesListTableProps) {
  const primaryMemberLabel = useCallback((members: ApiSchemas['AdminFamilyMember'][]) => {
    const primary = members.find((m) => m.is_primary_contact);
    return primary?.contact_label?.trim() || null;
  }, []);

  return (
    <PaginatedTableCard
      title='Families'
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      hasMore={hasMore}
      error={error || deleteActionError}
      loadingLabel='Loading families...'
      onLoadMore={loadMore}
      toolbar={
        <AdminTableToolbar>
          <div className='min-w-[200px] flex-1'>
            <Label htmlFor='crm-families-search'>Search</Label>
            <Input
              id='crm-families-search'
              value={filters.query}
              onChange={(e) => {
                onClearDeleteError();
                setFilter('query', e.target.value);
              }}
              placeholder='Family name or member name / email'
            />
          </div>
          <div className='min-w-[140px]'>
            <Label htmlFor='crm-families-active'>Status</Label>
            <Select
              id='crm-families-active'
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
          </div>
        </AdminTableToolbar>
      }
    >
      <AdminDataTable tableClassName='min-w-[720px]'>
        <AdminDataTableHead>
          <tr>
            <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Members</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Status</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        </AdminDataTableHead>
        <AdminDataTableBody>
          {rows.map((row) => {
            const primaryLabel = primaryMemberLabel(row.members);
            return (
              <tr
                key={row.id}
                className={`cursor-pointer transition ${
                  selectedId === row.id ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
                onClick={() => onSelectRow(row.id)}
              >
                <AdminDataTableCell>
                  {formatFamilyOrOrganizationPartyLabel(row.family_name, primaryLabel) || '—'}
                </AdminDataTableCell>
                <AdminDataTableCell>{row.members.length}</AdminDataTableCell>
                <AdminDataTableCell>{row.active ? 'Active' : 'Archived'}</AdminDataTableCell>
                <AdminDataTableCell className='text-right'>
                  <div className='flex flex-wrap justify-end gap-2'>
                    <RelatedRecordOpsLinks
                      salesHref={adminPartySalesConversationsDeepLink(
                        'family',
                        row.id,
                        row.sales_conversation_channel
                      )}
                      instancesHref={adminPartyServiceInstancesDeepLink('family', row.id)}
                      invoicesHref={adminPartyInvoicesDeepLink('family', row.id)}
                      hasSalesConversation={row.has_sales_conversation}
                      hasServiceInstance={row.has_service_instance}
                      hasInvoice={row.has_invoice}
                    />
                    <Button
                      type='button'
                      size='sm'
                      variant='danger'
                      className='h-8 min-w-8 px-0'
                      onClick={(e) => {
                        void onDeleteFamily(row, e);
                      }}
                      disabled={isSaving}
                      aria-label='Delete family'
                      title='Delete family'
                    >
                      <DeleteIcon className='h-4 w-4 shrink-0' aria-hidden />
                    </Button>
                  </div>
                </AdminDataTableCell>
              </tr>
            );
          })}
        </AdminDataTableBody>
      </AdminDataTable>
    </PaginatedTableCard>
  );
}
