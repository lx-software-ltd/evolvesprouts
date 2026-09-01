'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  selectLeadConversationThreads,
  type LeadConversationChannel,
  type LeadConversationThread,
} from '@/lib/lead-conversation-previews';
import { listMetaConversations, listMetaMessages } from '@/lib/meta-api';
import { listWhatsAppConversations, listWhatsAppMessages } from '@/lib/whatsapp-api';
import { toErrorMessage } from './hook-errors';

export type { LeadConversationChannel };

export interface LeadConversationPreview {
  id: string;
  channel: LeadConversationChannel;
  contactId: string | null;
  lastMessageAt: string | null;
  latestDirection: 'inbound' | 'outbound' | null;
  latestBody: string | null;
}

const FETCH_LIMIT = 6;

function latestMessage(items: Array<{ direction: 'inbound' | 'outbound'; body: string | null; sentAt: string }>): {
  direction: 'inbound' | 'outbound';
  body: string | null;
  sentAt: string;
} | null {
  return items.reduce<(typeof items)[number] | null>((current, item) => {
    if (!current) {
      return item;
    }
    return Date.parse(item.sentAt) >= Date.parse(current.sentAt) ? item : current;
  }, null);
}

export function useLeadConversationHistory(contactId: string | null) {
  const [conversations, setConversations] = useState<LeadConversationPreview[]>([]);
  const [overflow, setOverflow] = useState<LeadConversationPreview | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const latestRequestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!contactId) {
      setConversations([]);
      setOverflow(null);
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
        listWhatsAppConversations({ contactId, limit: FETCH_LIMIT }),
        listMetaConversations({ contactId, channel: 'instagram', limit: FETCH_LIMIT }),
        listMetaConversations({ contactId, channel: 'facebook', limit: FETCH_LIMIT }),
      ]);
      if (latestRequestIdRef.current !== requestId) {
        return;
      }

      const threads: LeadConversationThread[] = [
        ...whatsapp.items.map((row) => ({
          id: row.id,
          channel: 'whatsapp' as const,
          lastMessageAt: row.lastMessageAt,
          contactId: row.contactId,
        })),
        ...instagram.items.map((row) => ({
          id: row.id,
          channel: 'instagram' as const,
          lastMessageAt: row.lastMessageAt,
          contactId: row.contactId,
        })),
        ...messenger.items.map((row) => ({
          id: row.id,
          channel: 'messenger' as const,
          lastMessageAt: row.lastMessageAt,
          contactId: row.contactId,
        })),
      ];
      const selected = selectLeadConversationThreads(
        threads,
        Boolean(whatsapp.nextCursor || instagram.nextCursor || messenger.nextCursor)
      );
      const previewTargets = [
        ...selected.items,
        ...(selected.overflow ? [selected.overflow] : []),
      ];

      const previews = await Promise.all(
        previewTargets.map(async (thread) => {
          const result =
            thread.channel === 'whatsapp'
              ? await listWhatsAppMessages(thread.id)
              : await listMetaMessages(thread.id);
          const latest = latestMessage(result.items);
          return {
            id: thread.id,
            channel: thread.channel,
            contactId: thread.contactId ?? contactId,
            lastMessageAt: latest?.sentAt ?? thread.lastMessageAt,
            latestDirection: latest?.direction ?? null,
            latestBody: latest?.body ?? null,
          } satisfies LeadConversationPreview;
        })
      );
      if (latestRequestIdRef.current !== requestId) {
        return;
      }

      const overflowPreview = selected.overflow
        ? (previews.find((row) => row.id === selected.overflow?.id) ?? null)
        : null;
      setConversations(previews.filter((row) => row.id !== overflowPreview?.id));
      setOverflow(overflowPreview);
      setHasMore(selected.hasMore);
    } catch (err) {
      if (latestRequestIdRef.current !== requestId) {
        return;
      }
      setError(toErrorMessage(err, 'Failed to load conversations.'));
      setConversations([]);
      setOverflow(null);
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

  return { conversations, overflow, hasMore, isLoading, error, refetch };
}
