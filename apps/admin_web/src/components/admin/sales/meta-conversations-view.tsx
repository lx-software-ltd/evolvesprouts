'use client';

import { useState } from 'react';

import { useMetaConversations } from '@/hooks/use-meta-conversations';
import { useMetaMessages } from '@/hooks/use-meta-messages';
import { formatDate } from '@/lib/format';
import type { MetaChannel } from '@/lib/meta-api';

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

const CHANNEL_COPY: Record<
  MetaChannel,
  { title: string; description: string; searchPlaceholder: string; idLabel: string }
> = {
  instagram: {
    title: 'Instagram conversations',
    description: 'Inbound Instagram Direct messages and echoes captured from Meta webhooks.',
    searchPlaceholder: 'Name or Instagram user id',
    idLabel: 'Instagram user id',
  },
  facebook: {
    title: 'Messenger conversations',
    description: 'Inbound Messenger messages and echoes captured from Meta webhooks.',
    searchPlaceholder: 'Name or Messenger user id',
    idLabel: 'Messenger user id',
  },
};

export function MetaConversationsView({ channel }: { channel: MetaChannel }) {
  const copy = CHANNEL_COPY[channel];
  const list = useMetaConversations(channel);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useMetaMessages(selectedId);

  const selected = list.conversations.find((row) => row.id === selectedId) ?? null;

  return (
    <div className='space-y-4'>
      {selected ? (
        <AdminEditorCard
          title={selected.profileName || selected.contactName || selected.platformUserId}
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
        title={copy.title}
        description={copy.description}
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
                placeholder={copy.searchPlaceholder}
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
              <AdminDataTableHeadCell>{copy.idLabel}</AdminDataTableHeadCell>
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
                <AdminDataTableCell>{row.profileName || row.contactName || '—'}</AdminDataTableCell>
                <AdminDataTableCell>{row.platformUserId}</AdminDataTableCell>
                <AdminDataTableCell>{formatWhen(row.lastMessageAt)}</AdminDataTableCell>
                <AdminDataTableCell>{row.inboundCount}</AdminDataTableCell>
                <AdminDataTableCell>{row.outboundCount}</AdminDataTableCell>
                <AdminDataTableCell>{row.leadId ? 'Linked' : '—'}</AdminDataTableCell>
                <AdminDataTableCell className='text-right'>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    aria-label={`View conversation ${row.profileName || row.contactName || row.platformUserId}`}
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
