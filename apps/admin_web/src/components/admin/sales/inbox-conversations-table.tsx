'use client';

import type { ReactNode } from 'react';

import { ConversationNameCell } from './conversation-name-cell';

import { AdminDataTableCell, AdminDataTableCellMeta, AdminDataTableHeadCell } from '@/components/ui/admin-data-table';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { Input } from '@/components/ui/input';
import type { UseExpandedRecordReturn } from '@/hooks/use-expanded-record';
import { formatDate } from '@/lib/format';
import { formatInboxConversationName } from '@/lib/inbox-conversation-name';

/** `<td>` count per conversation row: expand + six data columns (no Operations). */
const COLUMN_COUNT = 7;

export interface InboxConversationRow {
  id: string;
  contactId: string | null;
  contactName: string | null;
  profileName: string | null;
  /** Channel identifier (WhatsApp id, Instagram / Messenger user id). */
  platformId: string;
  lastMessageAt: string | null;
  inboundCount: number;
  outboundCount: number;
  leadId: string | null;
}

export function inboxConversationLabel(row: Pick<InboxConversationRow, 'contactName' | 'profileName' | 'platformId'>) {
  return (
    formatInboxConversationName({ contactName: row.contactName, profileName: row.profileName }) || row.platformId
  );
}

export interface InboxConversationsTableProps {
  'aria-label': string;
  /** Header for the channel identifier column. */
  idLabel: string;
  rows: InboxConversationRow[];
  expanded: UseExpandedRecordReturn;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void | Promise<void>;
  error: string;
  search: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  /** Right-aligned controls in the filter bar (import button). */
  trailing?: ReactNode;
  /** Rendered between the filter bar and the table (import status, disclosures). */
  beforeTable?: ReactNode;
  /** Thread for the open row; mounted only while that row is expanded. */
  renderThread: (row: InboxConversationRow) => ReactNode;
}

/**
 * Table-first inbox: search (and import controls) on top, one expandable
 * row per conversation whose thread opens beneath it. Rows have no
 * row-scoped actions (the contact link lives in the Name cell), so there is
 * no Operations column.
 */
export function InboxConversationsTable({
  'aria-label': ariaLabel,
  idLabel,
  rows,
  expanded,
  isLoading,
  isLoadingMore,
  hasMore,
  onLoadMore,
  error,
  search,
  searchPlaceholder,
  onSearchChange,
  trailing,
  beforeTable,
  renderThread,
}: InboxConversationsTableProps) {
  const searchId = `${ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-search`;
  return (
    <AdminRecordTable
      aria-label={ariaLabel}
      columnCount={COLUMN_COUNT}
      rowCount={rows.length}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      hasMore={hasMore}
      onLoadMore={onLoadMore}
      error={error}
      errorTitle={ariaLabel}
      emptyLabel='No conversations match the current filters.'
      filters={
        <>
          <AdminFilterBar trailing={trailing}>
            <AdminFilterField label='Search' htmlFor={searchId} className='sm:basis-72'>
              <Input
                id={searchId}
                type='search'
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
              />
            </AdminFilterField>
          </AdminFilterBar>
          {beforeTable}
        </>
      }
      head={
        <tr>
          <AdminDataTableHeadCell className='w-10' />
          <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='secondary'>{idLabel}</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='secondary'>Last message</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='tertiary' className='text-right'>
            Inbound
          </AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='tertiary' className='text-right'>
            Outbound
          </AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='tertiary'>Lead</AdminDataTableHeadCell>
        </tr>
      }
    >
      {rows.map((row) => {
        const isOpen = expanded.isExpanded(row.id);
        const lastMessage = row.lastMessageAt ? formatDate(row.lastMessageAt) : '—';
        return (
          <AdminExpandableRow
            key={row.id}
            id={row.id}
            label={inboxConversationLabel(row)}
            expanded={isOpen}
            onToggle={() => expanded.toggle(row.id)}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='text-slate-900'>
                  <ConversationNameCell
                    contactId={row.contactId}
                    contactName={row.contactName}
                    profileName={row.profileName}
                  />
                  <AdminDataTableCellMeta>
                    {row.platformId} · {lastMessage}
                  </AdminDataTableCellMeta>
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-700'>
                  {row.platformId}
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-700'>
                  {lastMessage}
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-right tabular-nums text-slate-700'>
                  {row.inboundCount}
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-right tabular-nums text-slate-700'>
                  {row.outboundCount}
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                  {row.leadId ? 'Linked' : '—'}
                </AdminDataTableCell>
              </>
            }
            detail={isOpen ? renderThread(row) : null}
          />
        );
      })}
    </AdminRecordTable>
  );
}
