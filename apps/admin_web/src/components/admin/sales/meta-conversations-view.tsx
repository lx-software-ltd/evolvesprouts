'use client';

import { useEffect, useMemo, useState } from 'react';

import { InboxConversationThread } from './inbox-conversation-thread';
import { InboxConversationsTable, type InboxConversationRow } from './inbox-conversations-table';
import { InboxImportStatus } from './inbox-import-status';

import { StatusBanner } from '@/components/status-banner';
import { Button } from '@/components/ui/button';
import { toErrorMessage } from '@/hooks/hook-errors';
import { useAutoExpandPartyConversation } from '@/hooks/use-auto-expand-party-conversation';
import { useExpandedRecord } from '@/hooks/use-expanded-record';
import { useMetaConversations } from '@/hooks/use-meta-conversations';
import { useMetaMessages } from '@/hooks/use-meta-messages';
import { useRelatedPartySearchParams } from '@/hooks/use-related-party-search-params';
import { ADMIN_CONVERSATION_QUERY_PARAM } from '@/lib/contact-related-links';
import {
  createMetaImportJob,
  listInboxImportJobs,
  type InboxImportJobSummary,
} from '@/lib/inbox-import-api';
import type { MetaChannel, MetaConversationSummary } from '@/lib/meta-api';

const CHANNEL_COPY: Record<MetaChannel, { label: string; searchPlaceholder: string; idLabel: string }> = {
  instagram: {
    label: 'Instagram conversations',
    searchPlaceholder: 'Name or Instagram user id',
    idLabel: 'Instagram user id',
  },
  facebook: {
    label: 'Messenger conversations',
    searchPlaceholder: 'Name or Messenger user id',
    idLabel: 'Messenger user id',
  },
};

function toInboxRow(conversation: MetaConversationSummary): InboxConversationRow {
  return {
    id: conversation.id,
    contactId: conversation.contactId,
    contactName: conversation.contactName,
    profileName: conversation.profileName,
    platformId: conversation.platformUserId,
    lastMessageAt: conversation.lastMessageAt,
    inboundCount: conversation.inboundCount,
    outboundCount: conversation.outboundCount,
    leadId: conversation.leadId,
  };
}

/** Thread for one expanded row; mounted only while that row is open. */
function MetaConversationThread({ row }: { row: InboxConversationRow }) {
  const detail = useMetaMessages(row.id);
  return (
    <InboxConversationThread
      messages={detail.messages}
      isLoading={detail.isLoading}
      error={detail.error}
      summary={`Inbound ${row.inboundCount} · outbound ${row.outboundCount}`}
    />
  );
}

/**
 * Instagram / Messenger inbox: search plus the `Import recent history`
 * button on top (the import pulls the last 20 Graph message bodies per
 * thread), then one expandable row per conversation whose message thread
 * opens beneath it (`?conversation=<id>` keeps the open row in the URL).
 */
export function MetaConversationsView({ channel }: { channel: MetaChannel }) {
  const copy = CHANNEL_COPY[channel];
  const party = useRelatedPartySearchParams();
  const list = useMetaConversations(channel, party);
  const expanded = useExpandedRecord({ paramName: ADMIN_CONVERSATION_QUERY_PARAM });
  useAutoExpandPartyConversation({
    partyFilterKey: party.partyFilterKey,
    firstConversationId: list.conversations[0]?.id ?? null,
    isLoading: list.isLoading,
    expanded,
  });
  const [importJob, setImportJob] = useState<InboxImportJobSummary | null>(null);
  const [importError, setImportError] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listInboxImportJobs('/v1/admin/meta/import-jobs')
      .then((jobs) => {
        if (!cancelled) {
          setImportJob(jobs.find((job) => job.channel === channel) ?? jobs[0] ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImportJob(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [channel]);

  async function handleImportRecentHistory() {
    setIsImporting(true);
    setImportError('');
    try {
      const job = await createMetaImportJob(channel);
      setImportJob(job);
      await list.refetch();
    } catch (error) {
      setImportError(toErrorMessage(error, 'Could not start inbox import.'));
    } finally {
      setIsImporting(false);
    }
  }

  const rows = useMemo(() => list.conversations.map(toInboxRow), [list.conversations]);
  const importFeedback =
    importError || importJob ? (
      <div className='mb-3 space-y-2'>
        {importError ? (
          <StatusBanner variant='error' title='Inbox import'>
            {importError}
          </StatusBanner>
        ) : null}
        <InboxImportStatus job={importJob} />
      </div>
    ) : null;

  return (
    <InboxConversationsTable
      aria-label={copy.label}
      idLabel={copy.idLabel}
      rows={rows}
      expanded={expanded}
      isLoading={list.isLoading}
      isLoadingMore={list.isLoadingMore}
      hasMore={list.hasMore}
      onLoadMore={list.loadMore}
      error={list.error}
      search={list.filters.q}
      searchPlaceholder={copy.searchPlaceholder}
      onSearchChange={(value) => list.setFilter('q', value)}
      trailing={
        <Button
          type='button'
          variant='outline'
          className='h-10 w-full sm:h-9 sm:w-auto'
          onClick={() => {
            void handleImportRecentHistory();
          }}
          loading={isImporting}
          loadingLabel='Importing…'
        >
          Import recent history
        </Button>
      }
      beforeTable={importFeedback}
      renderThread={(row) => <MetaConversationThread row={row} />}
    />
  );
}
