'use client';

import { useMemo } from 'react';

import { InboxConversationThread } from './inbox-conversation-thread';
import { InboxConversationsTable, type InboxConversationRow } from './inbox-conversations-table';
import { WhatsAppExportImportPanel } from './whatsapp-export-import-panel';

import { useAutoExpandPartyConversation } from '@/hooks/use-auto-expand-party-conversation';
import { useExpandedRecord } from '@/hooks/use-expanded-record';
import { useRelatedPartySearchParams } from '@/hooks/use-related-party-search-params';
import { useWhatsAppConversations } from '@/hooks/use-whatsapp-conversations';
import { useWhatsAppMessages } from '@/hooks/use-whatsapp-messages';
import { ADMIN_CONVERSATION_QUERY_PARAM } from '@/lib/contact-related-links';
import type { WhatsAppConversationSummary } from '@/lib/whatsapp-api';

function toInboxRow(conversation: WhatsAppConversationSummary): InboxConversationRow {
  return {
    id: conversation.id,
    contactId: conversation.contactId,
    contactName: conversation.contactName,
    profileName: conversation.profileName,
    platformId: conversation.waId,
    lastMessageAt: conversation.lastMessageAt,
    inboundCount: conversation.inboundCount,
    outboundCount: conversation.outboundCount,
    leadId: conversation.leadId,
  };
}

/** Thread for one expanded row; mounted only while that row is open. */
function WhatsAppConversationThread({ row }: { row: InboxConversationRow }) {
  const detail = useWhatsAppMessages(row.id);
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
 * WhatsApp inbox: search on top, the chat-export import as a collapsed
 * accordion, then one expandable row per conversation whose message thread
 * opens beneath it (`?conversation=<id>` keeps the open row in the URL).
 */
export function WhatsAppConversationsView() {
  const party = useRelatedPartySearchParams();
  const list = useWhatsAppConversations(party);
  const expanded = useExpandedRecord({ paramName: ADMIN_CONVERSATION_QUERY_PARAM });
  useAutoExpandPartyConversation({
    partyFilterKey: party.partyFilterKey,
    firstConversationId: list.conversations[0]?.id ?? null,
    isLoading: list.isLoading,
    expanded,
  });

  const rows = useMemo(() => list.conversations.map(toInboxRow), [list.conversations]);

  return (
    <InboxConversationsTable
      aria-label='WhatsApp conversations'
      idLabel='WhatsApp id'
      rows={rows}
      expanded={expanded}
      isLoading={list.isLoading}
      isLoadingMore={list.isLoadingMore}
      hasMore={list.hasMore}
      onLoadMore={list.loadMore}
      error={list.error}
      search={list.filters.q}
      searchPlaceholder='Name or WhatsApp id'
      onSearchChange={(value) => list.setFilter('q', value)}
      beforeTable={<WhatsAppExportImportPanel className='mb-3' onImported={list.refetch} />}
      renderThread={(row) => <WhatsAppConversationThread row={row} />}
    />
  );
}
