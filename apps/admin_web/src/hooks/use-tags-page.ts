'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { invalidateSharedEntityTags } from '@/hooks/use-admin-catalog';
import { useEntityPanelEditorShell } from '@/hooks/use-entity-panel-editor-shell';
import { useExpandedRecordForm } from '@/hooks/use-expanded-record-form';
import { toErrorMessage } from '@/hooks/hook-errors';
import { conflictFieldUserMessage } from '@/lib/admin-api-conflict-messages';
import {
  createAdminTag,
  deleteOrArchiveAdminTag,
  listAdminTags,
  updateAdminTag,
  type AdminTagListFilter,
  type AdminTagRow,
} from '@/lib/tags-api';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export const ADMIN_TAG_QUERY_PARAM = 'tag';

export function useTagsPage() {
  const {
    confirmDialogProps,
    requestConfirm,
    deleteActionError,
    setDeleteActionError,
    editorMode,
    selectedId,
    expanded,
    clearDirty,
    track,
  } = useEntityPanelEditorShell({ paramName: ADMIN_TAG_QUERY_PARAM });
  const [tags, setTags] = useState<AdminTagRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [listFilter, setListFilter] = useState<AdminTagListFilter>('active');
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [rowBusy, setRowBusy] = useState<{ id: string; action: 'delete' | 'archive' | 'restore' } | null>(
    null
  );
  const [listSearchQuery, setListSearchQuery] = useState('');

  const selectedRow = useMemo(() => tags.find((row) => row.id === selectedId) ?? null, [tags, selectedId]);

  const filteredTags = useMemo(() => {
    const q = listSearchQuery.trim().toLowerCase();
    if (!q) {
      return tags;
    }
    return tags.filter((row) => row.name.toLowerCase().includes(q));
  }, [tags, listSearchQuery]);

  const loadTags = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const rows = await listAdminTags({ filter: listFilter });
      setTags(rows);
    } catch (caught) {
      setError(toErrorMessage(caught, 'Failed to load tags.', { honorBackendMessage: true }));
    } finally {
      setIsLoading(false);
    }
  }, [listFilter]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  const resetForm = useCallback(() => {
    setName('');
    setColor('');
    setDescription('');
    setSaveError('');
    clearDirty();
  }, [clearDirty]);

  const applyRow = useCallback(
    (row: AdminTagRow) => {
      setName(row.name);
      setColor(row.color?.trim() ?? '');
      setDescription(row.description?.trim() ?? '');
      setSaveError('');
      clearDirty();
    },
    [clearDirty]
  );

  useExpandedRecordForm<AdminTagRow>({
    expandedId: expanded.expandedId,
    rows: tags,
    isLoading,
    applyRow,
    reset: resetForm,
    collapse: expanded.collapse,
  });

  const runRowAction = async (
    row: AdminTagRow,
    action: 'delete' | 'archive' | 'restore',
    work: () => Promise<void>,
    failureLabel: string
  ) => {
    setRowBusy({ id: row.id, action });
    setDeleteActionError('');
    try {
      await work();
      invalidateSharedEntityTags();
      await loadTags();
    } catch (caught) {
      setDeleteActionError(toErrorMessage(caught, failureLabel, { honorBackendMessage: true }));
    } finally {
      setRowBusy(null);
    }
  };

  const handleRestore = (row: AdminTagRow) =>
    runRowAction(
      row,
      'restore',
      async () => {
        await updateAdminTag(row.id, { archived: false });
      },
      'Restore failed.'
    );

  const handleArchiveRow = async (row: AdminTagRow) => {
    if (row.is_system || row.archived_at) {
      return;
    }
    const confirmed = await requestConfirm({
      title: 'Archive tag?',
      description: `“${row.name}” will be hidden from pickers but stay on existing records.`,
      confirmLabel: 'Archive',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    await runRowAction(
      row,
      'archive',
      async () => {
        await updateAdminTag(row.id, { archived: true });
      },
      'Archive failed.'
    );
  };

  const handleSubmit = async () => {
    setSaveError('');
    setIsSaving(true);
    try {
      const trimmedColor = color.trim();
      const descTrimmed = description.trim();
      const body: ApiSchemas['CreateAdminTagRequest'] = {
        name: name.trim(),
        color: trimmedColor === '' ? null : trimmedColor,
        description: descTrimmed === '' ? null : descTrimmed,
      };
      if (editorMode === 'create') {
        await createAdminTag(body);
        clearDirty();
        expanded.collapse();
      } else {
        if (!selectedId) {
          return;
        }
        await updateAdminTag(selectedId, body);
        clearDirty();
      }
      invalidateSharedEntityTags();
      await loadTags();
    } catch (caught) {
      const conflict = conflictFieldUserMessage(caught, { name: 'A tag with this name already exists.' });
      setSaveError(conflict ?? toErrorMessage(caught, 'Save failed.', { honorBackendMessage: true }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRow = async (row: AdminTagRow) => {
    if (row.is_system || row.usage_count > 0) {
      return;
    }
    const confirmed = await requestConfirm({
      title: 'Remove tag?',
      description: `Permanently delete “${row.name}”? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    await runRowAction(
      row,
      'delete',
      async () => {
        const outcome = await deleteOrArchiveAdminTag(row.id);
        if (outcome.deleted && selectedId === row.id) {
          clearDirty();
          expanded.collapse();
        }
      },
      'Delete failed.'
    );
  };

  const editorIsBusy = isSaving || rowBusy !== null;
  const isEditingSystemTag = editorMode === 'edit' && Boolean(selectedRow?.is_system);

  return {
    confirmDialogProps,
    expanded,
    tags,
    isLoading,
    error,
    deleteActionError,
    setDeleteActionError,
    saveError,
    listFilter,
    setListFilter,
    editorMode,
    selectedRow,
    name,
    setName: track(setName),
    color,
    setColor: track(setColor),
    description,
    setDescription: track(setDescription),
    isSaving,
    rowBusy,
    listSearchQuery,
    setListSearchQuery,
    filteredTags,
    handleRestore,
    handleArchiveRow,
    handleSubmit,
    handleDeleteRow,
    editorIsBusy,
    isEditingSystemTag,
  };
}
