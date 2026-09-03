'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useEntityPanelEditorShell } from '@/hooks/use-entity-panel-editor-shell';
import { useExpandedRecordForm } from '@/hooks/use-expanded-record-form';
import { toErrorMessage } from '@/hooks/hook-errors';
import {
  createAdminApiKey,
  listAdminApiKeys,
  revokeAdminApiKey,
  type AdminApiKeySummary,
} from '@/lib/api-keys-api';

export const ADMIN_API_KEY_QUERY_PARAM = 'key';

export type ApiKeyScope = AdminApiKeySummary['scope'];

function toIsoExpiry(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
}

/**
 * API keys are created (token shown once) and revoked, never edited: an
 * expanded existing row is a read-only view, the draft row is the only form.
 */
export function useApiKeysPanel() {
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
  } = useEntityPanelEditorShell({ paramName: ADMIN_API_KEY_QUERY_PARAM });
  const [keys, setKeys] = useState<AdminApiKeySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ApiKeyScope>('user');
  const [expiresAt, setExpiresAt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [revokeBusyId, setRevokeBusyId] = useState<string | null>(null);
  const [listSearchQuery, setListSearchQuery] = useState('');
  const [createdToken, setCreatedToken] = useState('');

  const selectedRow = useMemo(() => keys.find((row) => row.id === selectedId) ?? null, [keys, selectedId]);

  const filteredKeys = useMemo(() => {
    const q = listSearchQuery.trim().toLowerCase();
    if (!q) {
      return keys;
    }
    return keys.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        row.key_prefix.toLowerCase().includes(q) ||
        row.scope.toLowerCase().includes(q)
    );
  }, [keys, listSearchQuery]);

  const loadKeys = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      setKeys(await listAdminApiKeys());
    } catch (caught) {
      setError(toErrorMessage(caught, 'Failed to load API keys.', { honorBackendMessage: true }));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const resetForm = useCallback(() => {
    setName('');
    setScope('user');
    setExpiresAt('');
    setSaveError('');
    clearDirty();
  }, [clearDirty]);

  // Existing keys are read-only; the view reads from `selectedRow` directly.
  const applyRow = useCallback(() => {
    setSaveError('');
    clearDirty();
  }, [clearDirty]);

  useExpandedRecordForm<AdminApiKeySummary>({
    expandedId: expanded.expandedId,
    rows: keys,
    isLoading,
    applyRow,
    reset: resetForm,
    collapse: expanded.collapse,
  });

  const handleCreate = async () => {
    if (editorMode !== 'create') {
      return;
    }
    setIsSaving(true);
    setSaveError('');
    try {
      const created = await createAdminApiKey({
        name: name.trim(),
        scope,
        expires_at: toIsoExpiry(expiresAt),
      });
      setCreatedToken(created.api_token);
      clearDirty();
      expanded.collapse();
      await loadKeys();
    } catch (caught) {
      setSaveError(toErrorMessage(caught, 'Create failed.', { honorBackendMessage: true }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevoke = async (row: AdminApiKeySummary) => {
    if (row.status === 'revoked') {
      return;
    }
    const confirmed = await requestConfirm({
      title: 'Revoke API key?',
      description: `“${row.name}” (${row.key_prefix}…) will stop working within five minutes.`,
      confirmLabel: 'Revoke',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    setRevokeBusyId(row.id);
    setDeleteActionError('');
    try {
      await revokeAdminApiKey(row.id);
      await loadKeys();
    } catch (caught) {
      setDeleteActionError(toErrorMessage(caught, 'Revoke failed.', { honorBackendMessage: true }));
    } finally {
      setRevokeBusyId(null);
    }
  };

  return {
    confirmDialogProps,
    expanded,
    editorMode,
    selectedRow,
    keys,
    filteredKeys,
    isLoading,
    error,
    deleteActionError,
    setDeleteActionError,
    saveError,
    name,
    setName: track(setName),
    scope,
    setScope: track(setScope),
    expiresAt,
    setExpiresAt: track(setExpiresAt),
    isSaving,
    revokeBusyId,
    listSearchQuery,
    setListSearchQuery,
    createdToken,
    dismissCreatedToken: () => setCreatedToken(''),
    handleCreate,
    handleRevoke,
  };
}
