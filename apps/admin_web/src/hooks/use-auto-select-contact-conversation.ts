'use client';

import { useState } from 'react';

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
  const [openedForContactId, setOpenedForContactId] = useState('');

  if (!contactId && openedForContactId !== '') {
    setOpenedForContactId('');
  } else if (
    contactId &&
    !isLoading &&
    firstConversationId &&
    openedForContactId !== contactId
  ) {
    setOpenedForContactId(contactId);
    setSelectedId(firstConversationId);
  }

  return [selectedId, setSelectedId];
}
