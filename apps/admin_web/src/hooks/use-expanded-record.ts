'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { setLocationSearchParam, useLocationSearchParam } from './use-query-tab-state';

export const DRAFT_RECORD_ID = 'new';

export interface UseExpandedRecordOptions {
  /** Query parameter that mirrors the open record so deep links and refreshes restore it. */
  paramName?: string;
  /** Return true when the open editor has unsaved changes; switching rows then asks first. */
  isDirty?: () => boolean;
  /** Called after the open record changes (including to `null`). */
  onChange?: (expandedId: string | null) => void;
}

export interface UseExpandedRecordReturn {
  /** Open record id, `DRAFT_RECORD_ID` for the draft row, or `null`. */
  expandedId: string | null;
  isDraftOpen: boolean;
  isExpanded: (id: string) => boolean;
  /** Toggle a row: closes it when already open, otherwise opens it (guarding dirty state). */
  toggle: (id: string) => void;
  expand: (id: string) => void;
  openDraft: () => void;
  collapse: () => void;
  /** Pending switch blocked by unsaved changes; drive a `ConfirmDialog` from it. */
  discardPrompt: {
    open: boolean;
    confirm: () => void;
    cancel: () => void;
  };
}

/**
 * Single-open expansion state for a record table, stored in `?<param>=<id>`
 * so refreshes, deep links, and back/forward restore the open row. Only one
 * row (or the draft row) is expanded at a time; a dirty editor must be
 * confirmed before another row replaces it.
 */
export function useExpandedRecord({
  paramName = 'record',
  isDirty,
  onChange,
}: UseExpandedRecordOptions = {}): UseExpandedRecordReturn {
  const fromUrl = useLocationSearchParam(paramName);
  const expandedId = fromUrl || null;
  const [pendingTarget, setPendingTarget] = useState<string | null | undefined>(undefined);
  const isDirtyRef = useRef(isDirty);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    isDirtyRef.current = isDirty;
    onChangeRef.current = onChange;
  });

  const apply = useCallback(
    (next: string | null) => {
      setLocationSearchParam(paramName, next);
      onChangeRef.current?.(next);
    },
    [paramName]
  );

  const request = useCallback(
    (next: string | null) => {
      if (next === expandedId) {
        return;
      }
      if (expandedId !== null && isDirtyRef.current?.()) {
        setPendingTarget(next);
        return;
      }
      apply(next);
    },
    [apply, expandedId]
  );

  const toggle = useCallback(
    (id: string) => {
      request(expandedId === id ? null : id);
    },
    [expandedId, request]
  );

  const discardPrompt = useMemo(
    () => ({
      open: pendingTarget !== undefined,
      confirm: () => {
        if (pendingTarget !== undefined) {
          apply(pendingTarget);
        }
        setPendingTarget(undefined);
      },
      cancel: () => {
        setPendingTarget(undefined);
      },
    }),
    [apply, pendingTarget]
  );

  return {
    expandedId,
    isDraftOpen: expandedId === DRAFT_RECORD_ID,
    isExpanded: useCallback((id: string) => expandedId === id, [expandedId]),
    toggle,
    expand: useCallback((id: string) => request(id), [request]),
    openDraft: useCallback(() => request(DRAFT_RECORD_ID), [request]),
    collapse: useCallback(() => request(null), [request]),
    discardPrompt,
  };
}
