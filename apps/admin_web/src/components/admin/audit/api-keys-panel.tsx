'use client';

import { DeleteIcon } from '@/components/icons/action-icons';
import { StatusBanner } from '@/components/status-banner';
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
import { useApiKeysPanel } from '@/hooks/use-api-keys-panel';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import type { AdminApiKeySummary } from '@/lib/api-keys-api';
import { formatDate } from '@/lib/format';

const EDITOR_FORM_ID = 'api-keys-editor-form';
const COLUMN_COUNT = 7;

function formatWhen(value: string | null | undefined): string {
  return value ? formatDate(value) : '—';
}

function scopeLabel(scope: AdminApiKeySummary['scope']): string {
  return scope === 'admin' ? 'Admin' : 'User';
}

function ApiKeyDraftEditor({ page }: { page: ReturnType<typeof useApiKeysPanel> }) {
  return (
    <AdminEditorPanel
      status={page.saveError ? <AdminInlineError>{page.saveError}</AdminInlineError> : null}
      actions={
        <AdminEditorActions
          mode='create'
          formId={EDITOR_FORM_ID}
          isSaving={page.isSaving}
          savingLabel='Creating…'
          submitDisabled={!page.name.trim()}
          submitLabel='Create API key'
        />
      }
    >
      <form
        id={EDITOR_FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          void page.handleCreate();
        }}
      >
        <AdminFieldGrid columns={4}>
          <AdminField label='Name' htmlFor='api-key-name' span={2}>
            <Input id='api-key-name' value={page.name} onChange={(event) => page.setName(event.target.value)} />
          </AdminField>
          <AdminField
            label='Scope'
            htmlFor='api-key-scope'
            hint='Admin tokens have full access to /v1/public routes; User tokens are read-only.'
          >
            <Select
              id='api-key-scope'
              value={page.scope}
              onChange={(event) => page.setScope(event.target.value === 'admin' ? 'admin' : 'user')}
            >
              <option value='user'>User (read-only)</option>
              <option value='admin'>Admin (full access)</option>
            </Select>
          </AdminField>
          <AdminField label='Expires at (optional)' htmlFor='api-key-expires'>
            <Input
              id='api-key-expires'
              type='datetime-local'
              value={page.expiresAt}
              onChange={(event) => page.setExpiresAt(event.target.value)}
            />
          </AdminField>
        </AdminFieldGrid>
      </form>
    </AdminEditorPanel>
  );
}

/** Keys cannot be edited after creation, so an open row is a read-only view. */
function ApiKeyDetails({ row }: { row: AdminApiKeySummary }) {
  const field = (label: string, id: string, value: string, span?: 2) => (
    <AdminField label={label} htmlFor={id} span={span}>
      <Input id={id} value={value} readOnly aria-readonly='true' />
    </AdminField>
  );
  return (
    <AdminEditorPanel>
      <AdminFieldGrid columns={4}>
        {field('Name', `api-key-${row.id}-name`, row.name, 2)}
        {field('Scope', `api-key-${row.id}-scope`, scopeLabel(row.scope))}
        {field('Expires at', `api-key-${row.id}-expires`, formatWhen(row.expires_at))}
        {field('Prefix', `api-key-${row.id}-prefix`, row.key_prefix)}
        {field('Status', `api-key-${row.id}-status`, row.status)}
        {field('Created', `api-key-${row.id}-created`, formatWhen(row.created_at))}
        {field('Last used', `api-key-${row.id}-last-used`, formatWhen(row.last_used_at))}
      </AdminFieldGrid>
    </AdminEditorPanel>
  );
}

export function ApiKeysPanel() {
  const page = useApiKeysPanel();
  const { expanded } = page;

  return (
    <div className='space-y-6'>
      <ConfirmDialog {...page.confirmDialogProps} />
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      {page.createdToken ? (
        <StatusBanner variant='success' title='Copy this token now'>
          {page.createdToken} This value is shown once and cannot be retrieved again.
        </StatusBanner>
      ) : null}
      <AdminRecordTable
        aria-label='API keys'
        columnCount={COLUMN_COUNT}
        rowCount={page.filteredKeys.length}
        isLoading={page.isLoading}
        error={page.error || page.deleteActionError}
        errorTitle='API keys'
        emptyLabel='No API keys match the current filters.'
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='New API key'
                active={expanded.isDraftOpen}
                onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
              />
            }
          >
            <AdminFilterField label='Search' htmlFor='api-key-search' className='sm:basis-72'>
              <Input
                id='api-key-search'
                value={page.listSearchQuery}
                onChange={(event) => {
                  page.setDeleteActionError('');
                  page.setListSearchQuery(event.target.value);
                }}
                placeholder='Name, prefix, or scope'
                autoComplete='off'
              />
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Prefix</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Scope</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Status</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Created</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new API key'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New API key</AdminDataTableCell>
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
            detail={<ApiKeyDraftEditor page={page} />}
          />
        ) : null}
        {page.filteredKeys.map((row) => {
          const isOpen = expanded.isExpanded(row.id);
          return (
            <AdminExpandableRow
              key={row.id}
              id={row.id}
              label={row.name}
              expanded={isOpen}
              onToggle={() => expanded.toggle(row.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell className='font-medium text-slate-900'>
                    {row.name}
                    <AdminDataTableCellMeta>
                      {row.key_prefix} · {scopeLabel(row.scope)} · {row.status}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='font-mono text-sm'>
                    {row.key_prefix}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary'>{scopeLabel(row.scope)}</AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary'>{row.status}</AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary'>{formatWhen(row.created_at)}</AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'revoke',
                      label: page.revokeBusyId === row.id ? 'Revoking API key' : 'Revoke API key',
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: row.status === 'revoked' || page.revokeBusyId === row.id,
                      onClick: () => void page.handleRevoke(row),
                    },
                  ]}
                />
              }
              detail={isOpen ? <ApiKeyDetails row={row} /> : null}
            />
          );
        })}
      </AdminRecordTable>
    </div>
  );
}
