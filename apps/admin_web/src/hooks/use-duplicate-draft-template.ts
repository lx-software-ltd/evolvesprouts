'use client';

import { useCallback, useRef, useState } from 'react';

import { DRAFT_RECORD_ID, type UseExpandedRecordReturn } from '@/hooks/use-expanded-record';

/**
 * "Duplicate as new draft" state for a table-first editor. The template is
 * only meaningful while the draft row is open: it is staged before the draft
 * opens (so a dirty-row prompt can still cancel it), applied when the row hook
 * reports the draft as expanded, and dropped as soon as any other row (or no
 * row) is expanded so a later `New …` click always starts blank.
 */
export function useDuplicateDraftTemplate<TTemplate>() {
  const [template, setTemplate] = useState<TTemplate | null>(null);
  const pendingRef = useRef<TTemplate | null>(null);

  /** Pass as `onExpandedChange` to `useEntityPanelEditorShell`. */
  const onExpandedChange = useCallback((expandedId: string | null) => {
    setTemplate(expandedId === DRAFT_RECORD_ID ? pendingRef.current : null);
    pendingRef.current = null;
  }, []);

  /** Open the draft row seeded from `next` (replaces the current draft when it is already open). */
  const stage = useCallback((next: TTemplate, expanded: UseExpandedRecordReturn) => {
    if (expanded.isDraftOpen) {
      pendingRef.current = null;
      setTemplate(next);
      return;
    }
    pendingRef.current = next;
    expanded.openDraft();
  }, []);

  /** Wrap the row hook's discard prompt so cancelling also forgets a staged template. */
  const guardDiscardPrompt = useCallback(
    (prompt: UseExpandedRecordReturn['discardPrompt']): UseExpandedRecordReturn['discardPrompt'] => ({
      ...prompt,
      cancel: () => {
        pendingRef.current = null;
        prompt.cancel();
      },
    }),
    []
  );

  const clear = useCallback(() => {
    pendingRef.current = null;
    setTemplate(null);
  }, []);

  return { template, stage, clear, onExpandedChange, guardDiscardPrompt };
}
