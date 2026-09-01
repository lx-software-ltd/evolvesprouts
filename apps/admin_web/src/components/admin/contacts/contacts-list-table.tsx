'use client';

import type { MouseEvent } from 'react';

import { RelatedRecordOpsLinks } from '@/components/admin/contacts/related-record-ops-links';
import {
  ArchiveIcon,
  DeleteIcon,
  NoteIcon,
  RestoreIcon,
} from '@/components/icons/action-icons';
import { Button } from '@/components/ui/button';
import {
  adminContactInvoicesDeepLink,
  adminSalesConversationsDeepLink,
  adminServiceInstancesDeepLink,
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
import { CONTACT_TYPES } from '@/lib/contacts/contacts-panel-constants';
import { contactNameListSuffix } from '@/lib/contacts/contacts-panel-helpers';
import { formatEnumLabel } from '@/lib/format';
import type { EntityListFilters } from '@/types/entity-list';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export interface ContactsListTableProps {
  rows: ApiSchemas['AdminContact'][];
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
  onSelectRow: (row: ApiSchemas['AdminContact']) => void;
  onToggleNotes: (row: ApiSchemas['AdminContact']) => void;
  onToggleActive: (row: ApiSchemas['AdminContact']) => void;
  onDeleteContact: (row: ApiSchemas['AdminContact'], event: MouseEvent<HTMLButtonElement>) => void;
}

export function ContactsListTable({
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
  onToggleNotes,
  onToggleActive,
  onDeleteContact,
}: ContactsListTableProps) {
  return (
    <PaginatedTableCard
      title='Contacts'
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      hasMore={hasMore}
      error={error || deleteActionError}
      loadingLabel='Loading contacts...'
      onLoadMore={loadMore}
      toolbar={
        <AdminTableToolbar>
          <div className='min-w-[200px] flex-1'>
            <Label htmlFor='crm-contacts-search'>Search</Label>
            <Input
              id='crm-contacts-search'
              value={filters.query}
              onChange={(e) => {
                onClearDeleteError();
                setFilter('query', e.target.value);
              }}
              placeholder='Name, email, phone, Instagram'
            />
          </div>
          <div className='min-w-[140px]'>
            <Label htmlFor='crm-contacts-type'>Type</Label>
            <Select
              id='crm-contacts-type'
              value={filters.contact_type}
              onChange={(e) => {
                onClearDeleteError();
                setFilter('contact_type', e.target.value as EntityListFilters['contact_type']);
              }}
            >
              <option value=''>All</option>
              {CONTACT_TYPES.map((v) => (
                <option key={v} value={v}>
                  {formatEnumLabel(v)}
                </option>
              ))}
            </Select>
          </div>
          <div className='min-w-[140px]'>
            <Label htmlFor='crm-contacts-active'>Status</Label>
            <Select
              id='crm-contacts-active'
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
            <AdminDataTableHeadCell>Email</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Type</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        </AdminDataTableHead>
        <AdminDataTableBody>
          {rows.map((row) => {
            const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || '—';
            const nameListSuffix = contactNameListSuffix(row);
            return (
              <tr
                key={row.id}
                className={`cursor-pointer transition ${
                  selectedId === row.id ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
                onClick={() => onSelectRow(row)}
              >
                <AdminDataTableCell>
                  {name}
                  {nameListSuffix ? (
                    <>
                      <span aria-hidden>{nameListSuffix}</span>
                      {row.family_ids.length > 0 ? (
                        <span className='sr-only'>, linked to a family</span>
                      ) : null}
                      {row.organization_ids.length > 0 ? (
                        <span className='sr-only'>, linked to an organisation</span>
                      ) : null}
                      {row.relationship_type === 'client' ? (
                        <span className='sr-only'>, client relationship</span>
                      ) : null}
                    </>
                  ) : null}
                </AdminDataTableCell>
                <AdminDataTableCell>{row.email ?? '—'}</AdminDataTableCell>
                <AdminDataTableCell>{formatEnumLabel(row.contact_type)}</AdminDataTableCell>
                <AdminDataTableCell className='text-right'>
                  <div className='flex flex-wrap justify-end gap-2'>
                    <RelatedRecordOpsLinks
                      salesHref={adminSalesConversationsDeepLink(
                        row.id,
                        row.sales_conversation_channel
                      )}
                      instancesHref={adminServiceInstancesDeepLink(row.id)}
                      invoicesHref={adminContactInvoicesDeepLink(name === '—' ? '' : name)}
                      hasSalesConversation={row.has_sales_conversation}
                      hasServiceInstance={row.has_service_instance}
                      hasInvoice={row.has_invoice}
                    />
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      className='relative h-8 min-w-8 overflow-visible px-0'
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleNotes(row);
                      }}
                      disabled={isSaving}
                      aria-label='Contact notes'
                      title='Contact notes'
                    >
                      <NoteIcon className='h-4 w-4 shrink-0' aria-hidden />
                      {row.standalone_note_count > 0 ? (
                        <span className='absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-none text-white'>
                          {row.standalone_note_count > 99 ? '99+' : row.standalone_note_count}
                        </span>
                      ) : null}
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      className='h-8 min-w-8 px-0'
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleActive(row);
                      }}
                      disabled={isSaving}
                      aria-label={row.active ? 'Archive contact' : 'Restore contact'}
                      title={row.active ? 'Archive' : 'Restore'}
                    >
                      {row.active ? (
                        <ArchiveIcon className='h-4 w-4 shrink-0' aria-hidden />
                      ) : (
                        <RestoreIcon className='h-4 w-4 shrink-0' aria-hidden />
                      )}
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant='danger'
                      className='h-8 min-w-8 px-0'
                      onClick={(e) => {
                        void onDeleteContact(row, e);
                      }}
                      disabled={isSaving}
                      aria-label='Delete contact'
                      title='Delete contact'
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
