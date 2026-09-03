'use client';

import { useEffect, useRef } from 'react';

import type { UseExpandedRecordReturn } from './use-expanded-record';

export interface UseAutoExpandPartyConversationOptions {
  /** Contact, family, or organisation id from the deep link (`''` when none). */
  partyFilterKey: string;
  /** Most recently active conversation in the filtered list. */
  firstConversationId: string | null;
  isLoading: boolean;
  expanded: Pick<UseExpandedRecordReturn, 'expandedId' | 'expand'>;
}

/**
 * When an Operations deep link includes `?contact=`, `?family=`, or
 * `?organization=`, expand the first (most recently active) conversation
 * once the filtered list loads, unless `?conversation=` already names one.
 * Collapsing the thread does not re-open it for the same party filter.
 */
export function useAutoExpandPartyConversation({
  partyFilterKey,
  firstConversationId,
  isLoading,
  expanded,
}: UseAutoExpandPartyConversationOptions): void {
  // Which party filter has already had its conversation opened; a ref because
  // it only gates the side effect and never needs to trigger a render.
  const openedForKeyRef = useRef('');
  const { expandedId, expand } = expanded;

  useEffect(() => {
    if (!partyFilterKey) {
      openedForKeyRef.current = '';
      return;
    }
    if (isLoading || openedForKeyRef.current === partyFilterKey) {
      return;
    }
    if (expandedId) {
      // A conversation deep link (or the operator) already picked a row.
      openedForKeyRef.current = partyFilterKey;
      return;
    }
    if (!firstConversationId) {
      return;
    }
    openedForKeyRef.current = partyFilterKey;
    expand(firstConversationId);
  }, [expand, expandedId, firstConversationId, isLoading, partyFilterKey]);
}
