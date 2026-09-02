'use client';

import { useState } from 'react';

import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

export function useEntityPanelEditorShell() {
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [deleteActionError, setDeleteActionError] = useState('');
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return {
    confirmDialogProps,
    requestConfirm,
    deleteActionError,
    setDeleteActionError,
    editorMode,
    setEditorMode,
    selectedId,
    setSelectedId,
  };
}
