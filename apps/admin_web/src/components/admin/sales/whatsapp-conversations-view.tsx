'use client';

import { useState } from 'react';

import { ConversationNameCell } from './conversation-name-cell';

import { useWhatsAppConversations } from '@/hooks/use-whatsapp-conversations';
import { useWhatsAppMessages } from '@/hooks/use-whatsapp-messages';
import { formatDate } from '@/lib/format';
import { formatInboxConversationName } from '@/lib/inbox-conversation-name';
import { ViewIcon } from '@/components/icons/action-icons';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { StatusBanner } from '@/components/status-banner';

function formatWhen(value: string | null): string {
  if (!value) {
    return '—';
  }
  return formatDate(value);
}

export function WhatsAppConversationsView() {
  const list = useWhatsAppConversations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useWhatsAppMessages(selectedId);

  const selected = list.conversations.find((row) => row.id === selectedId) ?? null;

  return (
    <div className='space-y-4'>
      {selected ? (
        <AdminEditorCard
          title={
            formatInboxConversationName({
              contactName: selected.contactName,
              profileName: selected.profileName,
            }) || selected.waId
          }
          description={`Inbound ${selected.inboundCount} · outbound ${selected.outboundCount}`}
          actions={
            <Button type='button' variant='secondary' onClick={() => setSelectedId(null)}>
              Close
            </Button>
          }
        >
          {detail.error ? (
            <StatusBanner variant='error' title='Messages'>
              {detail.error}
            </StatusBanner>
          ) : null}
          {detail.isLoading ? <p className='text-sm text-slate-600'>Loading messages…</p> : null}
          {!detail.isLoading && detail.messages.length === 0 && !detail.error ? (
            <p className='text-sm text-slate-600'>No messages captured yet.</p>
          ) : null}
          <ol className='space-y-2'>
            {detail.messages.map((message) => (
              <li
                key={message.id}
                className={
                  message.direction === 'inbound'
                    ? 'rounded-md border border-slate-200 bg-slate-50 p-3'
                    : 'rounded-md border border-emerald-100 bg-emerald-50 p-3'
                }
              >
                <p className='text-xs font-medium uppercase tracking-wide text-slate-500'>
                  {message.direction} · {message.messageType} · {formatWhen(message.sentAt)}
                </p>
                <p className='mt-1 text-sm text-slate-800'>{message.body || '(no text body)'}</p>
              </li>
            ))}
          </ol>
        </AdminEditorCard>
      ) : null}

      <PaginatedTableCard
        title='WhatsApp conversations'
        description='Inbound Cloud API messages and coexistence echoes captured from Meta webhooks.'
        isLoading={list.isLoading}
        isLoadingMore={list.isLoadingMore}
        hasMore={list.hasMore}
        error={list.error}
        onLoadMore={list.loadMore}
        toolbar={
          <div className='mb-3 flex flex-wrap items-end gap-3'>
            <label className='flex min-w-48 flex-1 flex-col gap-1 text-sm text-slate-700'>
              Search
              <Input
                type='search'
                value={list.filters.q}
                onChange={(event) => list.setFilter('q', event.target.value)}
                placeholder='Name or WhatsApp id'
              />
            </label>
            <p className='text-sm text-slate-500'>
              {list.totalCount == null ? '' : `${list.totalCount} conversations`}
            </p>
          </div>
        }
      >
        <AdminDataTable>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>WhatsApp id</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Last message</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Inbound</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Outbound</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Lead</AdminDataTableHeadCell>
              <AdminDataTableOperationsHeadCell />
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {list.conversations.map((row) => (
              <tr
                key={row.id}
                className={
                  selectedId === row.id
                    ? 'cursor-pointer bg-emerald-50'
                    : 'cursor-pointer hover:bg-slate-50'
                }
                onClick={() => setSelectedId(row.id)}
              >
                <AdminDataTableCell>
                  <ConversationNameCell
                    contactId={row.contactId}
                    contactName={row.contactName}
                    profileName={row.profileName}
                  />
                </AdminDataTableCell>
                <AdminDataTableCell>{row.waId}</AdminDataTableCell>
                <AdminDataTableCell>{formatWhen(row.lastMessageAt)}</AdminDataTableCell>
                <AdminDataTableCell>{row.inboundCount}</AdminDataTableCell>
                <AdminDataTableCell>{row.outboundCount}</AdminDataTableCell>
                <AdminDataTableCell>{row.leadId ? 'Linked' : '—'}</AdminDataTableCell>
                <AdminDataTableCell className='text-right'>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    aria-label={`View conversation ${
                      formatInboxConversationName({
                        contactName: row.contactName,
                        profileName: row.profileName,
                      }) || row.waId
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(row.id);
                    }}
                  >
                    <ViewIcon className='h-4 w-4' />
                  </Button>
                </AdminDataTableCell>
              </tr>
            ))}
          </AdminDataTableBody>
        </AdminDataTable>
      </PaginatedTableCard>
    </div>
  );
}
