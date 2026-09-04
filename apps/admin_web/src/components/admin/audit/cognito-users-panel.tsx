'use client';

import { DeleteIcon, RestoreIcon, VendorInactiveIcon } from '@/components/icons/action-icons';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminDiscardChangesDialog } from '@/components/ui/admin-discard-changes-dialog';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { useCognitoUsersPanel } from '@/hooks/use-cognito-users-panel';
import type { CognitoStaffGroup, CognitoUserRow } from '@/lib/cognito-users-api';
import { formatDate } from '@/lib/format';

const EDITOR_FORM_ID = 'cognito-users-editor-form';
const COLUMN_COUNT = 7;

const GROUP_LABELS: Record<CognitoStaffGroup, string> = {
  admin: 'Admin',
  manager: 'Manager',
  instructor: 'Instructor',
};

function formatWhen(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const epoch = Number(trimmed);
    const ms = trimmed.length <= 10 ? epoch * 1000 : epoch;
    return formatDate(new Date(ms).toISOString());
  }
  return formatDate(trimmed);
}

function groupLabel(groups: readonly string[]): string {
  if (groups.length === 0) {
    return 'None';
  }
  return groups.map((group) => GROUP_LABELS[group as CognitoStaffGroup] ?? group).join(', ');
}

function statusLabel(status: string): string {
  switch (status) {
    case 'CONFIRMED':
      return 'Confirmed';
    case 'UNCONFIRMED':
      return 'Unconfirmed';
    case 'FORCE_CHANGE_PASSWORD':
      return 'Force change password';
    case 'RESET_REQUIRED':
      return 'Reset required';
    case 'ARCHIVED':
      return 'Archived';
    default:
      return status || 'Unknown';
  }
}

function enabledLabel(enabled: boolean): string {
  return enabled ? 'Enabled' : 'Disabled';
}

function CognitoUserEditor({ page }: { page: ReturnType<typeof useCognitoUsersPanel> }) {
  const isCreate = page.editorMode === 'create';
  const row = page.selectedRow;
  return (
    <AdminEditorPanel
      status={page.saveError ? <AdminInlineError>{page.saveError}</AdminInlineError> : null}
      actions={
        <AdminEditorActions
          mode={page.editorMode}
          formId={EDITOR_FORM_ID}
          isSaving={page.isSaving}
          submitDisabled={page.editorIsBusy || !page.email.trim()}
          submitLabel={isCreate ? 'Create user' : 'Update user'}
        />
      }
    >
      <form
        id={EDITOR_FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          void page.handleSubmit();
        }}
      >
        <AdminFieldGrid columns={4}>
          <AdminField label='Email' htmlFor='cognito-user-email' span={2}>
            <Input
              id='cognito-user-email'
              type='email'
              value={page.email}
              onChange={(event) => page.setEmail(event.target.value)}
              autoComplete='off'
            />
          </AdminField>
          <AdminField label='Name' htmlFor='cognito-user-name'>
            <Input
              id='cognito-user-name'
              value={page.name}
              onChange={(event) => page.setName(event.target.value)}
              autoComplete='off'
            />
          </AdminField>
          <AdminField label='Group' htmlFor='cognito-user-group'>
            <Select
              id='cognito-user-group'
              value={page.group}
              onChange={(event) => page.setGroup(event.target.value as CognitoStaffGroup | '')}
            >
              <option value=''>None</option>
              <option value='admin'>Admin</option>
              <option value='manager'>Manager</option>
              <option value='instructor'>Instructor</option>
            </Select>
          </AdminField>
          {row ? (
            <>
              <AdminField label='Username' htmlFor={`cognito-user-${row.id}-username`}>
                <Input id={`cognito-user-${row.id}-username`} value={row.username} readOnly aria-readonly='true' />
              </AdminField>
              <AdminField label='Subject' htmlFor={`cognito-user-${row.id}-sub`}>
                <Input id={`cognito-user-${row.id}-sub`} value={row.sub} readOnly aria-readonly='true' />
              </AdminField>
              <AdminField label='Status' htmlFor={`cognito-user-${row.id}-status`}>
                <Input
                  id={`cognito-user-${row.id}-status`}
                  value={statusLabel(row.status)}
                  readOnly
                  aria-readonly='true'
                />
              </AdminField>
              <AdminField label='Enabled' htmlFor={`cognito-user-${row.id}-enabled`}>
                <Input
                  id={`cognito-user-${row.id}-enabled`}
                  value={enabledLabel(row.enabled)}
                  readOnly
                  aria-readonly='true'
                />
              </AdminField>
              <AdminField label='Created' htmlFor={`cognito-user-${row.id}-created`}>
                <Input
                  id={`cognito-user-${row.id}-created`}
                  value={formatWhen(row.created_at)}
                  readOnly
                  aria-readonly='true'
                />
              </AdminField>
              <AdminField label='Updated' htmlFor={`cognito-user-${row.id}-updated`}>
                <Input
                  id={`cognito-user-${row.id}-updated`}
                  value={formatWhen(row.updated_at)}
                  readOnly
                  aria-readonly='true'
                />
              </AdminField>
              <AdminField label='Last sign-in' htmlFor={`cognito-user-${row.id}-last-auth`} span={2}>
                <Input
                  id={`cognito-user-${row.id}-last-auth`}
                  value={formatWhen(row.last_auth_time)}
                  readOnly
                  aria-readonly='true'
                />
              </AdminField>
            </>
          ) : null}
        </AdminFieldGrid>
      </form>
    </AdminEditorPanel>
  );
}

function rowActions(page: ReturnType<typeof useCognitoUsersPanel>, row: CognitoUserRow) {
  const isSelf = Boolean(page.currentSub && row.sub === page.currentSub);
  const busy = page.rowBusy?.id === row.id ? page.rowBusy.action : null;
  return (
    <AdminRowActions
      actions={[
        {
          key: 'disable',
          label: isSelf ? 'Cannot disable your own user' : busy === 'disable' ? 'Disabling user' : 'Disable user',
          icon: <VendorInactiveIcon className='h-4 w-4' />,
          hidden: !row.enabled,
          disabled: page.editorIsBusy || isSelf,
          onClick: () => void page.handleDisable(row),
        },
        {
          key: 'enable',
          label: busy === 'enable' ? 'Enabling user' : 'Enable user',
          icon: <RestoreIcon className='h-4 w-4' />,
          hidden: row.enabled,
          disabled: page.editorIsBusy,
          onClick: () => void page.handleEnable(row),
        },
        {
          key: 'delete',
          label: isSelf ? 'Cannot delete your own user' : busy === 'delete' ? 'Deleting user' : 'Delete user',
          icon: <DeleteIcon className='h-4 w-4' />,
          tone: 'danger',
          disabled: page.editorIsBusy || isSelf,
          onClick: () => void page.handleDelete(row),
        },
      ]}
    />
  );
}

export function CognitoUsersPanel() {
  const page = useCognitoUsersPanel();
  const { expanded } = page;

  return (
    <div className='space-y-6'>
      <ConfirmDialog {...page.confirmDialogProps} />
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AdminRecordTable
        aria-label='Cognito users'
        columnCount={COLUMN_COUNT}
        rowCount={page.rows.length}
        isLoading={page.isLoading && page.rows.length === 0}
        isLoadingMore={page.isLoadingMore}
        hasMore={page.hasMore}
        onLoadMore={() => void page.loadMore()}
        error={page.error || page.deleteActionError}
        errorTitle='Users'
        emptyLabel='No users match the current filters.'
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='New user'
                active={expanded.isDraftOpen}
                onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
              />
            }
          >
            <AdminFilterField label='Name' htmlFor='cognito-user-name-filter' className='sm:basis-56'>
              <Input
                id='cognito-user-name-filter'
                value={page.filters.name ?? ''}
                onChange={(event) => {
                  page.setDeleteActionError('');
                  page.setFilter('name', event.target.value);
                }}
                autoComplete='off'
              />
            </AdminFilterField>
            <AdminFilterField label='Email' htmlFor='cognito-user-email-filter' className='sm:basis-56'>
              <Input
                id='cognito-user-email-filter'
                value={page.filters.email ?? ''}
                onChange={(event) => {
                  page.setDeleteActionError('');
                  page.setFilter('email', event.target.value);
                }}
                autoComplete='off'
              />
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Email</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Group</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Last sign-in</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Created</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new user'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New user</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
              </>
            }
            actions={null}
            detail={<CognitoUserEditor page={page} />}
          />
        ) : null}
        {page.rows.map((row) => {
          const isOpen = expanded.isExpanded(row.id);
          const displayName = row.name?.trim() || row.email || row.username;
          return (
            <AdminExpandableRow
              key={row.id}
              id={row.id}
              label={displayName}
              expanded={isOpen}
              onToggle={() => expanded.toggle(row.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell className='font-medium text-slate-900'>
                    {displayName}
                    <AdminDataTableCellMeta>
                      {row.email || row.username} · {groupLabel(row.groups)} · {formatWhen(row.last_auth_time)}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary'>{row.email || '—'}</AdminDataTableCell>
                  <AdminDataTableCell priority='secondary'>{groupLabel(row.groups)}</AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary'>{formatWhen(row.last_auth_time)}</AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary'>{formatWhen(row.created_at)}</AdminDataTableCell>
                </>
              }
              actions={rowActions(page, row)}
              detail={isOpen ? <CognitoUserEditor page={page} /> : null}
            />
          );
        })}
      </AdminRecordTable>
    </div>
  );
}
