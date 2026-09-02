'use client';

import { useEffect, useRef, useState } from 'react';

import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';

export interface UseExpandedRecordFormOptions<TRow extends { id: string }> {
  /** Current expanded id from `useExpandedRecord` (`null`, `DRAFT_RECORD_ID`, or a record id). */
  expandedId: string | null;
  rows: TRow[];
  /** True while the first page (or a filter change) is loading; the hook waits instead of collapsing. */
  isLoading: boolean;
  /** Load the form from a record; called once per expansion, not on every list refetch. */
  applyRow: (row: TRow) => void;
  /** Clear the form; called when the draft row opens or the expansion closes. */
  reset: () => void;
  /** Close the expansion when the id cannot be resolved to a record. */
  collapse: () => void;
  /**
   * Fetch a record that is not in the loaded pages (deep links). When it
   * resolves, the record is returned as `pinnedRow` so the table can render
   * it above the list; when it rejects or returns `null`, the row collapses.
   */
  fetchMissing?: (id: string) => Promise<TRow | null>;
}

/**
 * Keeps an editor's field state in step with the expanded row. Runs
 * `applyRow`/`reset` exactly once per expanded-id change so list refetches
 * (after save, load more, or background revalidation) never clobber edits.
 */
export function useExpandedRecordForm<TRow extends { id: string }>({
  expandedId,
  rows,
  isLoading,
  applyRow,
  reset,
  collapse,
  fetchMissing,
}: UseExpandedRecordFormOptions<TRow>): { pinnedRow: TRow | null } {
  const appliedRef = useRef<string | null | undefined>(undefined);
  const [pinnedRow, setPinnedRow] = useState<TRow | null>(null);
  const callbacksRef = useRef({ applyRow, reset, collapse, fetchMissing });
  useEffect(() => {
    callbacksRef.current = { applyRow, reset, collapse, fetchMissing };
  });

  useEffect(() => {
    if (appliedRef.current === expandedId) {
      return;
    }
    const callbacks = callbacksRef.current;

    if (expandedId === null || expandedId === DRAFT_RECORD_ID) {
      appliedRef.current = expandedId;
      callbacks.reset();
      return;
    }

    const row =
      rows.find((candidate) => candidate.id === expandedId) ??
      (pinnedRow?.id === expandedId ? pinnedRow : undefined);
    if (row) {
      appliedRef.current = expandedId;
      callbacks.applyRow(row);
      return;
    }

    if (isLoading) {
      return;
    }

    if (callbacks.fetchMissing) {
      let cancelled = false;
      void callbacks
        .fetchMissing(expandedId)
        .then((fetched) => {
          if (cancelled) {
            return;
          }
          appliedRef.current = expandedId;
          if (fetched) {
            setPinnedRow(fetched);
            callbacksRef.current.applyRow(fetched);
          } else {
            callbacksRef.current.collapse();
          }
        })
        .catch(() => {
          if (!cancelled) {
            appliedRef.current = expandedId;
            callbacksRef.current.collapse();
          }
        });
      return () => {
        cancelled = true;
      };
    }

    appliedRef.current = expandedId;
    callbacks.collapse();
  }, [expandedId, rows, isLoading, pinnedRow]);

  // A stale pin from an earlier expansion is masked rather than cleared in
  // the effect, so no extra render is scheduled while syncing.
  return { pinnedRow: pinnedRow && pinnedRow.id === expandedId ? pinnedRow : null };
}
