'use client';

import { useCallback, useMemo, useState } from 'react';

import { useAuth } from '@/components/auth-provider';
import { conflictFieldUserMessage } from '@/lib/admin-api-conflict-messages';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import {
  createCognitoUser,
  deleteCognitoUser,
  getCognitoUser,
  listCognitoUsers,
  primaryStaffGroup,
  updateCognitoUser,
  type CognitoStaffGroup,
  type CognitoUserRow,
  type CognitoUsersFilters,
} from '@/lib/cognito-users-api';

import { toErrorMessage } from './hook-errors';
import { useEntityPanelEditorShell } from './use-entity-panel-editor-shell';
import { useExpandedRecordForm } from './use-expanded-record-form';
import { usePaginatedList, type PaginatedFetcherParams } from './use-paginated-list';

export const ADMIN_COGNITO_USER_QUERY_PARAM = 'user';

type StaffGroupValue = CognitoStaffGroup | '';

const DEFAULT_FILTERS: CognitoUsersFilters = { name: '', email: '' };

export function useCognitoUsersPanel() {
  const { user } = useAuth();
  const currentSub = user?.subject ?? null;
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
  } = useEntityPanelEditorShell({ paramName: ADMIN_COGNITO_USER_QUERY_PARAM });

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [group, setGroup] = useState<StaffGroupValue>('');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [rowBusy, setRowBusy] = useState<{ id: string; action: 'disable' | 'enable' | 'delete' } | null>(
    null
  );

  const fetcher = useCallback(
    async ({ cursor, limit, signal, ...filters }: PaginatedFetcherParams<CognitoUsersFilters>) => {
      const response = await listCognitoUsers(filters, cursor, limit, signal);
      return { items: response.items, nextCursor: response.next_cursor };
    },
    []
  );

  const list = usePaginatedList<CognitoUserRow, CognitoUsersFilters>({
    fetcher,
    defaultFilters: DEFAULT_FILTERS,
    errorPrefix: 'Failed to load users',
    debounceKeys: ['name', 'email'],
    queryKey: adminQueryKeys.cognitoUsers.lists(),
  });

  const selectedRow = useMemo(
    () => list.items.find((row) => row.id === selectedId) ?? null,
    [list.items, selectedId]
  );

  const resetForm = useCallback(() => {
    setEmail('');
    setName('');
    setGroup('');
    setSaveError('');
    clearDirty();
  }, [clearDirty]);

  const applyRow = useCallback(
    (row: CognitoUserRow) => {
      setEmail(row.email ?? '');
      setName(row.name ?? '');
      setGroup(primaryStaffGroup(row.groups));
      setSaveError('');
      clearDirty();
    },
    [clearDirty]
  );

  const { pinnedRow } = useExpandedRecordForm<CognitoUserRow>({
    expandedId: expanded.expandedId,
    rows: list.items,
    isLoading: list.isLoading,
    applyRow,
    reset: resetForm,
    collapse: expanded.collapse,
    fetchMissing: getCognitoUser,
  });

  const rows = useMemo(() => {
    if (pinnedRow && !list.items.some((row) => row.id === pinnedRow.id)) {
      return [pinnedRow, ...list.items];
    }
    return list.items;
  }, [list.items, pinnedRow]);

  const handleSubmit = async () => {
    setIsSaving(true);
    setSaveError('');
    try {
      const trimmedEmail = email.trim();
      const trimmedName = name.trim();
      const nextGroup = group || undefined;
      if (editorMode === 'create') {
        await createCognitoUser({
          email: trimmedEmail,
          ...(trimmedName ? { name: trimmedName } : {}),
          ...(nextGroup ? { group: nextGroup } : {}),
        });
        clearDirty();
        expanded.collapse();
      } else if (selectedRow) {
        await updateCognitoUser(selectedRow.username, {
          email: trimmedEmail,
          name: trimmedName,
          group: nextGroup ?? null,
        });
        clearDirty();
      }
      await list.refetch();
    } catch (caught) {
      setSaveError(
        conflictFieldUserMessage(caught, { email: 'A user with this email already exists.' }) ??
          toErrorMessage(caught, editorMode === 'create' ? 'Create failed.' : 'Update failed.', {
            honorBackendMessage: true,
          })
      );
    } finally {
      setIsSaving(false);
    }
  };

  const runRowAction = async (
    row: CognitoUserRow,
    action: 'disable' | 'enable' | 'delete',
    work: () => Promise<void>,
    failureLabel: string
  ) => {
    setRowBusy({ id: row.id, action });
    setDeleteActionError('');
    try {
      await work();
      if (action === 'delete' && expanded.isExpanded(row.id)) {
        expanded.collapse();
      }
      await list.refetch();
    } catch (caught) {
      setDeleteActionError(toErrorMessage(caught, failureLabel, { honorBackendMessage: true }));
    } finally {
      setRowBusy(null);
    }
  };

  const handleDisable = async (row: CognitoUserRow) => {
    const confirmed = await requestConfirm({
      title: 'Disable user?',
      description: `${row.email || row.username} will not be able to sign in until they are enabled again.`,
      confirmLabel: 'Disable',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    await runRowAction(
      row,
      'disable',
      async () => {
        await updateCognitoUser(row.username, { enabled: false });
      },
      'Disable failed.'
    );
  };

  const handleEnable = async (row: CognitoUserRow) => {
    await runRowAction(
      row,
      'enable',
      async () => {
        await updateCognitoUser(row.username, { enabled: true });
      },
      'Enable failed.'
    );
  };

  const handleDelete = async (row: CognitoUserRow) => {
    const confirmed = await requestConfirm({
      title: 'Delete user?',
      description: `${row.email || row.username} will be removed from Cognito. This cannot be undone.`,
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
        await deleteCognitoUser(row.username);
      },
      'Delete failed.'
    );
  };

  const editorIsBusy = isSaving || rowBusy !== null;
  const isSelf = Boolean(currentSub && selectedRow?.sub === currentSub);

  return {
    confirmDialogProps,
    expanded,
    editorMode,
    selectedRow,
    rows,
    filters: list.filters,
    setFilter: list.setFilter,
    isLoading: list.isLoading,
    isLoadingMore: list.isLoadingMore,
    hasMore: list.hasMore,
    loadMore: list.loadMore,
    error: list.error,
    deleteActionError,
    setDeleteActionError,
    saveError,
    email,
    setEmail: track(setEmail),
    name,
    setName: track(setName),
    group,
    setGroup: track(setGroup),
    isSaving,
    editorIsBusy,
    rowBusy,
    currentSub,
    isSelf,
    handleSubmit,
    handleDisable,
    handleEnable,
    handleDelete,
  };
}
