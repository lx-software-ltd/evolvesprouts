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
  isLoading: boolean
): [string | null, (next: string | null) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openedForContactId, setOpenedForContactId] = useState('');

  if (!partyFilterId && openedForContactId !== '') {
    setOpenedForContactId('');
  } else if (
    partyFilterId &&
    !isLoading &&
    firstConversationId &&
    openedForContactId !== partyFilterId
  ) {
    setOpenedForContactId(partyFilterId);
    setSelectedId(firstConversationId);
  }

  return [selectedId, setSelectedId];
}
