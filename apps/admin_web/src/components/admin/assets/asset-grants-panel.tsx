'use client';

import { useState, type FormEvent } from 'react';

import type { AdminAsset, AssetGrant, CreateAssetGrantInput } from '@/types/assets';

import { ACCESS_GRANT_TYPES } from '@/types/assets';

import { DeleteIcon } from '@/components/icons/action-icons';
import { StatusBanner } from '@/components/status-banner';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminFilterBar } from '@/components/ui/admin-filter-bar';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { formatDate, formatEnumLabel } from '@/lib/format';

const ASSET_GRANT_FORM_ID = 'admin-asset-grant-form';

/** Row id of the unsaved grant; distinct from the asset table's draft id so test ids never collide. */
export const GRANT_DRAFT_ID = 'grant-draft';

const COLUMN_COUNT = 6;

interface AssetGrantsPanelProps {
  selectedAsset: AdminAsset;
  grants: AssetGrant[];
  isLoadingGrants: boolean;
  grantsError: string;
  grantMutationError: string;
  isSavingGrant: boolean;
  isDeletingGrantId: string | null;
  /** Resolves `true` when the grant was created so the draft row can close. */
  onCreateGrant: (assetId: string, input: CreateAssetGrantInput) => Promise<boolean>;
  onDeleteGrant: (assetId: string, grantId: string) => Promise<void>;
}

function granteePlaceholder(grantType: CreateAssetGrantInput['grantType']): string {
  switch (grantType) {
    case 'organization':
      return 'Organization UUID';
    case 'user':
      return 'User sub';
    default:
      return 'Not needed for all authenticated users';
  }
}

/**
 * Access grants as a sub-accordion of the expanded asset row: a nested
 * table-first list with a draft row for new grants and Revoke in the
 * Operations column.
 */
export function AssetGrantsPanel({
  selectedAsset,
  grants,
  isLoadingGrants,
  grantsError,
  grantMutationError,
  isSavingGrant,
  isDeletingGrantId,
  onCreateGrant,
  onDeleteGrant,
}: AssetGrantsPanelProps) {
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [isDraftOpen, setIsDraftOpen] = useState(false);
  const [grantType, setGrantType] = useState<CreateAssetGrantInput['grantType']>('all_authenticated');
  const [granteeId, setGranteeId] = useState('');
  const [formError, setFormError] = useState('');

  const isGranteeRequired = grantType !== 'all_authenticated';

  const toggleDraft = () => {
    setFormError('');
    setIsDraftOpen((previous) => !previous);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');

    const normalizedGrantee = granteeId.trim();
    if (isGranteeRequired && !normalizedGrantee) {
      setFormError('Grantee ID is required for organization and user grants.');
      return;
    }

    const created = await onCreateGrant(selectedAsset.id, {
      grantType,
      granteeId: isGranteeRequired ? normalizedGrantee : null,
    });
    if (created) {
      setGranteeId('');
      setGrantType('all_authenticated');
      setIsDraftOpen(false);
    }
  };

  const handleDelete = async (grantId: string) => {
    const confirmed = await requestConfirm({
      title: 'Revoke grant',
      description: 'Delete this grant? Access revocation is immediate for new URLs.',
      confirmLabel: 'Revoke',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    await onDeleteGrant(selectedAsset.id, grantId);
  };

  const draftEditor = (
    <AdminEditorPanel
      status={
        formError ? (
          <StatusBanner variant='error' title='Validation'>
            {formError}
          </StatusBanner>
        ) : null
      }
      actions={
        <AdminEditorActions
          mode='create'
          formId={ASSET_GRANT_FORM_ID}
          isSaving={isSavingGrant}
          savingLabel='Adding…'
          submitLabel='Add grant'
        />
      }
    >
      <form id={ASSET_GRANT_FORM_ID} onSubmit={handleSubmit}>
        <AdminFieldGrid columns={4}>
          <AdminField label='Grant type' htmlFor='grant-type' span={2}>
            <Select
              id='grant-type'
              value={grantType}
              disabled={isSavingGrant}
              onChange={(event) => setGrantType(event.target.value as CreateAssetGrantInput['grantType'])}
            >
              {ACCESS_GRANT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {formatEnumLabel(type)}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Grantee ID' htmlFor='grantee-id' span={2}>
            <Input
              id='grantee-id'
              value={granteeId}
              disabled={isSavingGrant || !isGranteeRequired}
              onChange={(event) => setGranteeId(event.target.value)}
              placeholder={granteePlaceholder(grantType)}
              autoComplete='off'
            />
          </AdminField>
        </AdminFieldGrid>
      </form>
    </AdminEditorPanel>
  );

  return (
    <AdminDisclosure
      id={`asset-grants-${selectedAsset.id}`}
      title='Access grants'
      summary={isLoadingGrants ? 'Loading…' : `${grants.length} grant${grants.length === 1 ? '' : 's'}`}
    >
      <AdminRecordTable
        embedded
        aria-label='Access grants'
        columnCount={COLUMN_COUNT}
        rowCount={grants.length}
        isLoading={isLoadingGrants}
        error={grantsError || grantMutationError}
        errorTitle='Access grants'
        emptyLabel='No grants configured for this asset.'
        filters={
          <AdminFilterBar
            trailing={<AdminCreateButton label='New grant' active={isDraftOpen} onClick={toggleDraft} />}
          />
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Type</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Grantee</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Granted by</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Created</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {isDraftOpen ? (
          <AdminExpandableRow
            id={GRANT_DRAFT_ID}
            label='new grant'
            expanded
            isDraft
            onToggle={toggleDraft}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New grant</AdminDataTableCell>
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
            detail={draftEditor}
          />
        ) : null}
        {grants.map((grant) => {
          const isRevoking = isDeletingGrantId === grant.id;
          return (
            <tr key={grant.id} data-testid={`asset-grant-row-${grant.id}`}>
              <AdminDataTableCell className='w-10 pr-0' />
              <AdminDataTableCell className='font-medium text-slate-900'>
                {formatEnumLabel(grant.grantType)}
                <AdminDataTableCellMeta>
                  {grant.granteeId ? `${grant.granteeId} · ` : ''}
                  {formatDate(grant.createdAt)}
                </AdminDataTableCellMeta>
              </AdminDataTableCell>
              <AdminDataTableCell priority='secondary' className='font-mono text-xs text-slate-700'>
                <span className='wrap-anywhere'>{grant.granteeId || '—'}</span>
              </AdminDataTableCell>
              <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                {grant.grantedBy || '—'}
              </AdminDataTableCell>
              <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                {formatDate(grant.createdAt)}
              </AdminDataTableCell>
              <AdminDataTableCell className='text-right'>
                <AdminRowActions
                  actions={[
                    {
                      key: 'revoke',
                      label: isRevoking ? 'Revoking grant' : 'Revoke grant',
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: isDeletingGrantId !== null,
                      onClick: () => void handleDelete(grant.id),
                    },
                  ]}
                />
              </AdminDataTableCell>
            </tr>
          );
        })}
      </AdminRecordTable>
      <ConfirmDialog {...confirmDialogProps} />
    </AdminDisclosure>
  );
}
