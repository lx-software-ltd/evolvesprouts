'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  LEAD_CONVERSATION_MESSAGE_LIMIT,
  selectLatestLeadConversationThread,
  selectLeadConversationMessages,
  type LeadConversationChannel,
  type LeadConversationMessage,
  type LeadConversationThread,
} from '@/lib/lead-conversation-previews';
import { listMetaConversations, listMetaMessages } from '@/lib/meta-api';
import { listWhatsAppConversations, listWhatsAppMessages } from '@/lib/whatsapp-api';
import { toErrorMessage } from './hook-errors';

export type { LeadConversationChannel };

export type LeadConversationPreviewMessage = LeadConversationMessage;

const CHANNEL_FETCH_LIMIT = 1;

export function useLeadConversationHistory(contactId: string | null) {
  const [conversation, setConversation] = useState<LeadConversationThread | null>(null);
  const [messages, setMessages] = useState<LeadConversationPreviewMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const latestRequestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!contactId) {
      setConversation(null);
      setMessages([]);
      setHasMore(false);
      setError('');
      setIsLoading(false);
      return;
    }

    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    setIsLoading(true);
    setError('');
    try {
      const [whatsapp, instagram, messenger] = await Promise.all([
        listWhatsAppConversations({ contactId, limit: CHANNEL_FETCH_LIMIT }),
        listMetaConversations({ contactId, channel: 'instagram', limit: CHANNEL_FETCH_LIMIT }),
        listMetaConversations({ contactId, channel: 'facebook', limit: CHANNEL_FETCH_LIMIT }),
      ]);
      if (latestRequestIdRef.current !== requestId) {
        return;
      }

      const thread = selectLatestLeadConversationThread([
        ...whatsapp.items.map((row) => ({
          id: row.id,
          channel: 'whatsapp' as const,
          lastMessageAt: row.lastMessageAt,
          contactId: row.contactId,
          inboundCount: row.inboundCount,
          outboundCount: row.outboundCount,
        })),
        ...instagram.items.map((row) => ({
          id: row.id,
          channel: 'instagram' as const,
          lastMessageAt: row.lastMessageAt,
          contactId: row.contactId,
          inboundCount: row.inboundCount,
          outboundCount: row.outboundCount,
        })),
        ...messenger.items.map((row) => ({
          id: row.id,
          channel: 'messenger' as const,
          lastMessageAt: row.lastMessageAt,
          contactId: row.contactId,
          inboundCount: row.inboundCount,
          outboundCount: row.outboundCount,
        })),
      ]);
      if (!thread) {
        setConversation(null);
        setMessages([]);
        setHasMore(false);
        return;
      }

      const result =
        thread.channel === 'whatsapp'
          ? await listWhatsAppMessages(thread.id)
          : await listMetaMessages(thread.id);
      if (latestRequestIdRef.current !== requestId) {
        return;
      }

      const messageTotal = thread.inboundCount + thread.outboundCount;
      const selected = selectLeadConversationMessages(
        result.items,
        messageTotal > LEAD_CONVERSATION_MESSAGE_LIMIT
      );
      setConversation({
        ...thread,
        contactId: thread.contactId ?? contactId,
      });
      setMessages(selected.items);
      setHasMore(selected.hasMore);
    } catch (err) {
      if (latestRequestIdRef.current !== requestId) {
        return;
      }
      setError(toErrorMessage(err, 'Failed to load conversations.'));
      setConversation(null);
      setMessages([]);
      setHasMore(false);
    } finally {
      if (latestRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [contactId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { conversation, messages, hasMore, isLoading, error, refetch };
}
