'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
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

export function useTagsPage() {
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [tags, setTags] = useState<AdminTagRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [listFilter, setListFilter] = useState<AdminTagListFilter>('active');
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);
  const [listSearchQuery, setListSearchQuery] = useState('');

  const selectedRow = useMemo(
    () => tags.find((row) => row.id === selectedTagId) ?? null,
    [tags, selectedTagId]
  );

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
      const message = toErrorMessage(caught, 'Failed to load tags.', { honorBackendMessage: true });
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [listFilter]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  const resetCreateForm = () => {
    setEditorMode('create');
    setSelectedTagId(null);
    setName('');
    setColor('');
    setDescription('');
    setSaveError('');
  };

  const applyRowSelection = (row: AdminTagRow) => {
    setEditorMode('edit');
    setSelectedTagId(row.id);
    setName(row.name);
    setColor(row.color?.trim() ?? '');
    setDescription(row.description?.trim() ?? '');
    setSaveError('');
  };

  const parseColorPayload = (): string | null => {
    const trimmed = color.trim();
    return trimmed === '' ? null : trimmed;
  };

  const handleRestore = async (row: AdminTagRow) => {
    setRestoreBusyId(row.id);
    setError('');
    try {
      const updated = await updateAdminTag(row.id, { archived: false });
      await loadTags();
      if (updated && selectedTagId === row.id) {
        applyRowSelection(updated);
      }
    } catch (caught) {
      const message = toErrorMessage(caught, 'Restore failed.', { honorBackendMessage: true });
      setError(message);
    } finally {
      setRestoreBusyId(null);
    }
  };

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
    setArchiveBusyId(row.id);
    setError('');
    try {
      const updated = await updateAdminTag(row.id, { archived: true });
      await loadTags();
      if (updated && selectedTagId === row.id) {
        applyRowSelection(updated);
      }
    } catch (caught) {
      const message = toErrorMessage(caught, 'Archive failed.', { honorBackendMessage: true });
      setError(message);
    } finally {
      setArchiveBusyId(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError('');
    setIsSaving(true);
    try {
      const colorPayload = parseColorPayload();
      const descTrimmed = description.trim();
      if (editorMode === 'create') {
        const body: ApiSchemas['CreateAdminTagRequest'] = {
          name: name.trim(),
          color: colorPayload,
          description: descTrimmed === '' ? null : descTrimmed,
        };
        await createAdminTag(body);
        resetCreateForm();
        await loadTags();
        return;
      }
      if (!selectedTagId) {
        return;
      }
      const body: ApiSchemas['UpdateAdminTagRequest'] = {
        name: name.trim(),
        color: colorPayload,
        description: descTrimmed === '' ? null : descTrimmed,
      };
      await updateAdminTag(selectedTagId, body);
      await loadTags();
    } catch (caught) {
      const conflict = conflictFieldUserMessage(caught, { name: 'A tag with this name already exists.' });
      if (conflict) {
        setSaveError(conflict);
        return;
      }
      const message = toErrorMessage(caught, 'Save failed.', { honorBackendMessage: true });
      setSaveError(message);
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
    setDeleteBusyId(row.id);
    setError('');
    try {
      const outcome = await deleteOrArchiveAdminTag(row.id);
      if (outcome.deleted && selectedTagId === row.id) {
        resetCreateForm();
      }
      if (!outcome.deleted && outcome.tag && selectedTagId === row.id) {
        applyRowSelection(outcome.tag);
      }
      await loadTags();
    } catch (caught) {
      const message = toErrorMessage(caught, 'Delete failed.', { honorBackendMessage: true });
      setError(message);
    } finally {
      setDeleteBusyId(null);
    }
  };

  const editorIsBusy =
    isSaving || Boolean(deleteBusyId) || Boolean(archiveBusyId) || Boolean(restoreBusyId);
  const isEditingSystemTag = editorMode === 'edit' && selectedRow?.is_system;
  const showRestoreInEditor =
    editorMode === 'edit' && selectedRow && Boolean(selectedRow.archived_at) && !selectedRow.is_system;

  return {
    confirmDialogProps,
    tags,
    isLoading,
    error,
    saveError,
    listFilter,
    setListFilter,
    editorMode,
    selectedTagId,
    name,
    setName,
    color,
    setColor,
    description,
    setDescription,
    isSaving,
    deleteBusyId,
    archiveBusyId,
    restoreBusyId,
    listSearchQuery,
    setListSearchQuery,
    selectedRow,
    filteredTags,
    resetCreateForm,
    applyRowSelection,
    handleRestore,
    handleArchiveRow,
    handleSubmit,
    handleDeleteRow,
    editorIsBusy,
    isEditingSystemTag,
    showRestoreInEditor,
  };
}
