'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * When a Contacts Operations deep link includes `?contact=`, open the first
 * (most recently active) conversation once the filtered list loads.
 * Closing the chat does not re-open it for the same contact.
 */
export function useAutoSelectContactConversation(
  contactId: string,
  firstConversationId: string | null,
  isLoading: boolean
): [string | null, (next: string | null) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openedForContactRef = useRef('');

  useEffect(() => {
    if (!contactId) {
      openedForContactRef.current = '';
      return;
    }
    if (isLoading || !firstConversationId) {
      return;
    }
    if (openedForContactRef.current === contactId) {
      return;
    }
    openedForContactRef.current = contactId;
    setSelectedId(firstConversationId);
  }, [contactId, firstConversationId, isLoading]);

  return [selectedId, setSelectedId];
}
