'use client';

import { useState } from 'react';

/**
 * When an Operations deep link includes `?contact=`, `?family=`, or
 * `?organization=`, open the first (most recently active) conversation once
 * the filtered list loads. Closing the chat does not re-open it for the same
 * party filter.
 */
export function useAutoSelectContactConversation(
  partyFilterId: string,
  firstConversationId: string | null,
  isLoading: boolean,
  preferredConversationId = ''
): [string | null, (next: string | null) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openedForContactId, setOpenedForContactId] = useState('');

  const openKey = preferredConversationId
    ? `conversation:${preferredConversationId}`
    : partyFilterId
      ? `party:${partyFilterId}`
      : '';
  const targetId = preferredConversationId || firstConversationId;

  if (!openKey && openedForContactId !== '') {
    setOpenedForContactId('');
  } else if (openKey && !isLoading && targetId && openedForContactId !== openKey) {
    setOpenedForContactId(openKey);
    setSelectedId(targetId);
  }

  return [selectedId, setSelectedId];
}
