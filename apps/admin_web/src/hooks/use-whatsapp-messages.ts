'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { listWhatsAppMessages, type WhatsAppMessageSummary } from '@/lib/whatsapp-api';

export function useWhatsAppMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<WhatsAppMessageSummary[]>([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const latestRequestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!conversationId) {
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
      const result = await listWhatsAppMessages(conversationId);
      if (latestRequestIdRef.current !== requestId) {
        return;
      }
      setMessages([...result.items].reverse());
    } catch (err) {
      if (latestRequestIdRef.current !== requestId) {
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      if (latestRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [conversationId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { messages, error, isLoading, refetch };
}
