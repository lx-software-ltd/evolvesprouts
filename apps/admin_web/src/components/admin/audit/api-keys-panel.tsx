'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DeleteIcon } from '@/components/icons/action-icons';
import { Button } from '@/components/ui/button';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { Select } from '@/components/ui/select';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { toErrorMessage } from '@/hooks/hook-errors';
import { formatDate } from '@/lib/format';
import {
  createAdminApiKey,
  listAdminApiKeys,
  revokeAdminApiKey,
  type AdminApiKeySummary,
} from '@/lib/api-keys-api';
import { StatusBanner } from '@/components/status-banner';

const EDITOR_FORM_ID = 'api-keys-editor-form';

function formatWhen(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  return formatDate(value);
}

function toIsoExpiry(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toISOString();
}

export function ApiKeysPanel() {
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [keys, setKeys] = useState<AdminApiKeySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [editorMode, setEditorMode] = useState<'create' | 'view'>('create');
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'admin' | 'user'>('user');
  const [expiresAt, setExpiresAt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [revokeBusyId, setRevokeBusyId] = useState<string | null>(null);
  const [listSearchQuery, setListSearchQuery] = useState('');
  const [createdToken, setCreatedToken] = useState('');

  const selectedRow = useMemo(
    () => keys.find((row) => row.id === selectedKeyId) ?? null,
    [keys, selectedKeyId]
  );

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

  const resetCreateForm = () => {
    setEditorMode('create');
    setSelectedKeyId(null);
    setName('');
    setScope('user');
    setExpiresAt('');
    setSaveError('');
  };

  const applyRowSelection = (row: AdminApiKeySummary) => {
    setEditorMode('view');
    setSelectedKeyId(row.id);
    setName(row.name);
    setScope(row.scope);
    setExpiresAt(row.expires_at ?? '');
    setSaveError('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      await loadKeys();
      resetCreateForm();
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
    setError('');
    try {
      const updated = await revokeAdminApiKey(row.id);
      await loadKeys();
      if (selectedKeyId === row.id) {
        applyRowSelection(updated);
      }
    } catch (caught) {
      setError(toErrorMessage(caught, 'Revoke failed.', { honorBackendMessage: true }));
    } finally {
      setRevokeBusyId(null);
    }
  };

  return (
    <div className='space-y-6'>
      <ConfirmDialog {...confirmDialogProps} />
      {createdToken ? (
        <StatusBanner variant='success' title='Copy this token now'>
          {createdToken} This value is shown once and cannot be retrieved again.
        </StatusBanner>
      ) : null}
      {error ? (
        <StatusBanner variant='error' title='API keys'>
          {error}
        </StatusBanner>
      ) : null}

      <AdminEditorCard
        title={editorMode === 'create' ? 'New API key' : 'API key'}
        description='Tokens authenticate /v1/public routes via the x-api-token header. Admin tokens have full access; User tokens are read-only.'
        actions={
          editorMode === 'view' ? (
            <Button type='button' variant='secondary' onClick={resetCreateForm}>
              Cancel
            </Button>
          ) : (
            <Button type='submit' form={EDITOR_FORM_ID} disabled={isSaving || !name.trim()}>
              {isSaving ? 'Creating…' : 'Create API key'}
            </Button>
          )
        }
      >
        {saveError ? (
          <StatusBanner variant='error' title='Save'>
            {saveError}
          </StatusBanner>
        ) : null}
        <form id={EDITOR_FORM_ID} className='space-y-4' onSubmit={(event) => void handleSubmit(event)}>
          <div>
            <Label htmlFor='api-key-name'>Name</Label>
            <Input
              id='api-key-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={editorMode === 'view'}
              required
            />
          </div>
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
            <div>
              <Label htmlFor='api-key-scope'>Scope</Label>
              <Select
                id='api-key-scope'
                value={scope}
                onChange={(event) => setScope(event.target.value === 'admin' ? 'admin' : 'user')}
                disabled={editorMode === 'view'}
              >
                <option value='user'>User (read-only)</option>
                <option value='admin'>Admin (full access)</option>
              </Select>
            </div>
            <div>
              <Label htmlFor='api-key-expires'>
                {editorMode === 'create' ? 'Expires at (optional)' : 'Expires at'}
              </Label>
              {editorMode === 'create' ? (
                <Input
                  id='api-key-expires'
                  type='datetime-local'
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              ) : (
                <Input id='api-key-expires' value={formatWhen(selectedRow?.expires_at)} disabled readOnly />
              )}
            </div>
          </div>
          {editorMode === 'view' ? (
            <div className='space-y-1 text-sm text-slate-600'>
              <p>Prefix: {selectedRow?.key_prefix ?? '—'}</p>
              <p>Status: {selectedRow?.status ?? '—'}</p>
              <p>Created: {formatWhen(selectedRow?.created_at)}</p>
              <p>Last used: {formatWhen(selectedRow?.last_used_at)}</p>
            </div>
          ) : null}
        </form>
      </AdminEditorCard>

      <PaginatedTableCard
        title='API keys'
        description='Hashed tokens for public integrations. Revoke from Operations.'
        isLoading={isLoading}
        isLoadingMore={false}
        hasMore={false}
        error=''
        loadingLabel='Loading API keys...'
        onLoadMore={() => {}}
        toolbar={
          <AdminTableToolbar>
            <Label htmlFor='api-key-search'>Search</Label>
            <Input
              id='api-key-search'
              value={listSearchQuery}
              onChange={(event) => setListSearchQuery(event.target.value)}
            />
          </AdminTableToolbar>
        }
      >
        <AdminDataTable>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Prefix</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Scope</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Status</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Created</AdminDataTableHeadCell>
              <AdminDataTableOperationsHeadCell />
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {filteredKeys.map((row) => (
              <tr key={row.id}>
                <AdminDataTableCell>
                  <button
                    type='button'
                    className='text-left font-medium text-slate-900 underline-offset-2 hover:underline'
                    onClick={() => applyRowSelection(row)}
                  >
                    {row.name}
                  </button>
                </AdminDataTableCell>
                <AdminDataTableCell>{row.key_prefix}</AdminDataTableCell>
                <AdminDataTableCell>{row.scope === 'admin' ? 'Admin' : 'User'}</AdminDataTableCell>
                <AdminDataTableCell>{row.status}</AdminDataTableCell>
                <AdminDataTableCell>{formatWhen(row.created_at)}</AdminDataTableCell>
                <AdminDataTableCell>
                  <div className='flex justify-end'>
                    <Button
                      type='button'
                      size='sm'
                      variant='danger'
                      className='h-8 min-w-8 px-0'
                      disabled={row.status === 'revoked' || revokeBusyId === row.id}
                      onClick={() => void handleRevoke(row)}
                      aria-label='Revoke API key'
                      title='Revoke API key'
                      aria-busy={revokeBusyId === row.id}
                    >
                      {revokeBusyId === row.id ? (
                        <span
                          className='inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent'
                          aria-hidden
                        />
                      ) : (
                        <DeleteIcon className='h-4 w-4 shrink-0' aria-hidden />
                      )}
                    </Button>
                  </div>
                </AdminDataTableCell>
              </tr>
            ))}
          </AdminDataTableBody>
        </AdminDataTable>
        {!isLoading && filteredKeys.length === 0 ? (
          <p className='text-sm text-slate-600'>No API keys match the current filters.</p>
        ) : null}
      </PaginatedTableCard>
    </div>
  );
}
