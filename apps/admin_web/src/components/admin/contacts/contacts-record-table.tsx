'use client';

import type { ReactNode } from 'react';

import { relatedRecordActions } from '@/components/admin/contacts/related-record-actions';
import { ArchiveIcon, DeleteIcon, NoteIcon, RestoreIcon } from '@/components/icons/action-icons';
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
  adminContactInvoicesDeepLink,
  adminSalesConversationsDeepLink,
  adminServiceInstancesDeepLink,
} from '@/lib/contact-related-links';
import { CONTACT_TYPES } from '@/lib/contacts/contacts-panel-constants';
import { contactNameListSuffix } from '@/lib/contacts/contacts-panel-helpers';
import { formatEnumLabel } from '@/lib/format';
import type { EntityListFilters } from '@/types/entity-list';
import type { components } from '@/types/generated/admin-api.generated';

type AdminContact = components['schemas']['AdminContact'];

const COLUMN_COUNT = 5;

export interface ContactsRecordTableProps {
  rows: AdminContact[];
  /** Deep-linked contact outside the loaded pages; rendered first when not already listed. */
  pinnedRow: AdminContact | null;
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
  /** Editor for the open row (draft or record); rendered inside the expansion. */
  detail: ReactNode;
  onOpenNotes: (row: AdminContact) => void;
  onToggleActive: (row: AdminContact) => void;
  onDeleteContact: (row: AdminContact) => void;
}

function contactDisplayName(row: AdminContact): string {
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || '—';
}

export function ContactsRecordTable({
  rows,
  pinnedRow,
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
  onOpenNotes,
  onToggleActive,
  onDeleteContact,
}: ContactsRecordTableProps) {
  const displayRows =
    pinnedRow && !rows.some((row) => row.id === pinnedRow.id) ? [pinnedRow, ...rows] : rows;

  return (
    <AdminRecordTable
      aria-label='Contacts'
      columnCount={COLUMN_COUNT}
      rowCount={displayRows.length}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      hasMore={hasMore}
      onLoadMore={loadMore}
      error={error || deleteActionError}
      errorTitle='Contacts'
      emptyLabel='No contacts match the current filters.'
      filters={
        <AdminFilterBar
          trailing={
            <AdminCreateButton
              label='New contact'
              active={expanded.isDraftOpen}
              onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
            />
          }
        >
          <AdminFilterField label='Search' htmlFor='crm-contacts-search' className='sm:basis-72'>
            <Input
              id='crm-contacts-search'
              value={filters.query}
              onChange={(e) => {
                onClearDeleteError();
                setFilter('query', e.target.value);
              }}
              placeholder='Name, email, phone, Instagram'
            />
          </AdminFilterField>
          <AdminFilterField label='Type' htmlFor='crm-contacts-type'>
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
          </AdminFilterField>
          <AdminFilterField label='Status' htmlFor='crm-contacts-active'>
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
          </AdminFilterField>
        </AdminFilterBar>
      }
      head={
        <tr>
          <AdminDataTableHeadCell className='w-10' />
          <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='secondary'>Email</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='tertiary'>Type</AdminDataTableHeadCell>
          <AdminDataTableOperationsHeadCell />
        </tr>
      }
    >
      {expanded.isDraftOpen ? (
        <AdminExpandableRow
          id={DRAFT_RECORD_ID}
          label='new contact'
          expanded
          isDraft
          onToggle={expanded.collapse}
          columnCount={COLUMN_COUNT}
          cells={
            <>
              <AdminDataTableCell className='font-medium text-slate-900'>New contact</AdminDataTableCell>
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
      {displayRows.map((row) => {
        const name = contactDisplayName(row);
        const nameListSuffix = contactNameListSuffix(row);
        const isOpen = expanded.isExpanded(row.id);
        return (
          <AdminExpandableRow
            key={row.id}
            id={row.id}
            label={name}
            expanded={isOpen}
            onToggle={() => expanded.toggle(row.id)}
            columnCount={COLUMN_COUNT}
            cells={
              <>
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
                  {row.email ? <AdminDataTableCellMeta>{row.email}</AdminDataTableCellMeta> : null}
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary'>{row.email ?? '—'}</AdminDataTableCell>
                <AdminDataTableCell priority='tertiary'>{formatEnumLabel(row.contact_type)}</AdminDataTableCell>
              </>
            }
            actions={
              <AdminRowActions
                actions={[
                  {
                    key: 'notes',
                    label: 'Contact notes',
                    icon: <NoteIcon className='h-4 w-4' />,
                    badge: row.standalone_note_count,
                    disabled: isSaving,
                    onClick: () => onOpenNotes(row),
                  },
                  ...relatedRecordActions({
                    salesHref: adminSalesConversationsDeepLink(row.id, row.sales_conversation_channel),
                    instancesHref: adminServiceInstancesDeepLink(row.id),
                    invoicesHref: adminContactInvoicesDeepLink(name === '—' ? '' : name),
                    hasSalesConversation: row.has_sales_conversation,
                    hasServiceInstance: row.has_service_instance,
                    hasInvoice: row.has_invoice,
                  }),
                  {
                    key: 'archive',
                    label: row.active ? 'Archive contact' : 'Restore contact',
                    icon: row.active ? (
                      <ArchiveIcon className='h-4 w-4' />
                    ) : (
                      <RestoreIcon className='h-4 w-4' />
                    ),
                    disabled: isSaving,
                    onClick: () => onToggleActive(row),
                  },
                  {
                    key: 'delete',
                    label: 'Delete contact',
                    icon: <DeleteIcon className='h-4 w-4' />,
                    tone: 'danger',
                    disabled: isSaving,
                    onClick: () => onDeleteContact(row),
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
