'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { listMetaConversations, listMetaMessages } from '@/lib/meta-api';
import { listWhatsAppConversations, listWhatsAppMessages } from '@/lib/whatsapp-api';
import { toErrorMessage } from './hook-errors';

export type LeadConversationChannel = 'whatsapp' | 'instagram' | 'messenger';

export interface LeadConversationMessage {
  id: string;
  channel: LeadConversationChannel;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  body: string | null;
  sentAt: string;
}

function compareSentAt(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  const safeLeft = Number.isFinite(leftMs) ? leftMs : 0;
  const safeRight = Number.isFinite(rightMs) ? rightMs : 0;
  return safeLeft - safeRight;
}

export function useLeadConversationHistory(contactId: string | null) {
  const [messages, setMessages] = useState<LeadConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const latestRequestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!contactId) {
      setMessages([]);
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
        listWhatsAppConversations({ contactId, limit: 50 }),
        listMetaConversations({ contactId, channel: 'instagram', limit: 50 }),
        listMetaConversations({ contactId, channel: 'facebook', limit: 50 }),
      ]);
      if (latestRequestIdRef.current !== requestId) {
        return;
      }

      const threads: Array<{ id: string; channel: LeadConversationChannel }> = [
        ...whatsapp.items.map((row) => ({ id: row.id, channel: 'whatsapp' as const })),
        ...instagram.items.map((row) => ({ id: row.id, channel: 'instagram' as const })),
        ...messenger.items.map((row) => ({ id: row.id, channel: 'messenger' as const })),
      ];

      const threadMessages = await Promise.all(
        threads.map(async (thread) => {
          const result =
            thread.channel === 'whatsapp'
              ? await listWhatsAppMessages(thread.id)
              : await listMetaMessages(thread.id);
          return result.items.map((item) => ({
            id: `${thread.channel}:${item.id}`,
            channel: thread.channel,
            conversationId: thread.id,
            direction: item.direction,
            messageType: item.messageType,
            body: item.body,
            sentAt: item.sentAt,
          }));
        })
      );
      if (latestRequestIdRef.current !== requestId) {
        return;
      }

      setMessages(threadMessages.flat().sort((left, right) => compareSentAt(left.sentAt, right.sentAt)));
    } catch (err) {
      if (latestRequestIdRef.current !== requestId) {
        return;
      }
      setError(toErrorMessage(err, 'Failed to load conversations.'));
      setMessages([]);
    } finally {
      if (latestRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [contactId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { messages, isLoading, error, refetch };
}
