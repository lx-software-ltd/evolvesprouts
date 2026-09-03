'use client';

import { useCallback, useRef, useState } from 'react';

import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { DRAFT_RECORD_ID, useExpandedRecord } from '@/hooks/use-expanded-record';

export interface UseEntityPanelEditorShellOptions {
  /** Query parameter that mirrors the expanded record (`contact`, `family`, ...). */
  paramName: string;
  /** Called after the expanded row changes (including to `null`); see `useExpandedRecord`. */
  onExpandedChange?: (expandedId: string | null) => void;
}

/**
 * Shared state for a table-first entity editor: the single expanded row
 * (draft or record), a dirty flag that guards row switches, the confirm
 * dialog, and the row-scoped delete error. `editorMode` and `selectedId`
 * derive from the expanded row so there is one source of truth.
 */
export function useEntityPanelEditorShell({ paramName, onExpandedChange }: UseEntityPanelEditorShellOptions) {
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [deleteActionError, setDeleteActionError] = useState('');
  const dirtyRef = useRef(false);
  /** Extra dirty signal owned by the editor (for example an in-progress location draft). */
  const externalDirtyRef = useRef<() => boolean>(() => false);

  const expanded = useExpandedRecord({
    paramName,
    isDirty: () => dirtyRef.current || externalDirtyRef.current(),
    onChange: onExpandedChange,
  });

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);
  const clearDirty = useCallback(() => {
    dirtyRef.current = false;
  }, []);
  /** Wrap a field setter so any change flags the editor as dirty. */
  const track = useCallback(
    <TValue,>(setter: (value: TValue) => void) =>
      (value: TValue) => {
        dirtyRef.current = true;
        setter(value);
      },
    []
  );

  const selectedId =
    expanded.expandedId && expanded.expandedId !== DRAFT_RECORD_ID ? expanded.expandedId : null;
  const editorMode: 'create' | 'edit' = selectedId ? 'edit' : 'create';

  return {
    confirmDialogProps,
    requestConfirm,
    deleteActionError,
    setDeleteActionError,
    editorMode,
    selectedId,
    expanded,
    externalDirtyRef,
    markDirty,
    clearDirty,
    track,
  };
}
