'use client';

import { useMemo, type KeyboardEvent, type MouseEvent } from 'react';

import type { AdminAsset, AssetVisibility, ListAdminAssetsInput } from '@/types/assets';

import {
  ASSET_VISIBILITIES,
  CLIENT_DOCUMENT_ASSET_TAG,
  CUSTOMER_INVOICE_ASSET_TAG,
  EXPENSE_ATTACHMENT_ASSET_TAG,
  isCustomerInvoiceAssetTag,
  isExpenseAttachmentAssetTag,
  isRestrictedSystemAssetTag,
} from '@/types/assets';

import { OpenAdminAssetInNewTabButton } from '@/components/admin/shared/open-admin-asset-in-new-tab-button';
import { DeleteIcon } from '@/components/icons/action-icons';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useOpenAdminAssetInNewTab } from '@/hooks/use-open-admin-asset-in-new-tab';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Label } from '@/components/ui/label';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { Select } from '@/components/ui/select';
import {
  formatAssetContentLanguageLabel,
  formatAssetTagDisplayName,
  formatDate,
  formatEnumLabel,
} from '@/lib/format';

export interface AssetListPanelProps {
  assets: AdminAsset[];
  /** Tag names returned by the admin asset list API for the current asset type scope. */
  linkedTagNames: string[];
  selectedAssetId: string | null;
  filters: {
    query?: string;
    visibility?: AssetVisibility | '';
    tagName?: ListAdminAssetsInput['tagName'];
  };
  isLoadingAssets: boolean;
  isLoadingMoreAssets: boolean;
  isDeletingAssetId: string | null;
  assetsError: string;
  nextCursor: string | null;
  onQueryChange: (value: string) => void;
  onVisibilityChange: (value: AssetVisibility | '') => void;
  onTagNameChange: (value: ListAdminAssetsInput['tagName']) => void;
  onLoadMore: () => Promise<void>;
  onSelectAsset: (assetId: string) => void;
  onDeleteAsset: (assetId: string) => Promise<void>;
}

export function AssetListPanel({
  assets,
  linkedTagNames,
  selectedAssetId,
  filters,
  isLoadingAssets,
  isLoadingMoreAssets,
  isDeletingAssetId,
  assetsError,
  nextCursor,
  onQueryChange,
  onVisibilityChange,
  onTagNameChange,
  onLoadMore,
  onSelectAsset,
  onDeleteAsset,
}: AssetListPanelProps) {
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const { openingAssetId, openError: viewAssetError, openAssetInNewTab } = useOpenAdminAssetInNewTab();

  const tagFilterOptions = useMemo(() => {
    const names = [...linkedTagNames];
    const current = filters.tagName?.trim() ?? '';
    if (current && !names.includes(current)) {
      names.push(current);
    }
    return names.sort((a, b) => a.localeCompare(b));
  }, [linkedTagNames, filters.tagName]);

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, assetId: string) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectAsset(assetId);
    }
  };

  const handleDeleteAsset = async (asset: AdminAsset, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const confirmed = await requestConfirm({
      title: 'Delete asset',
      description: `Delete "${asset.title}"? This removes the asset record and S3 object.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    await onDeleteAsset(asset.id);
  };

  return (
    <>
      <PaginatedTableCard
        title='Assets'
        description='Manage document (PDF) assets delivered through presigned URLs.'
        isLoading={isLoadingAssets}
        isLoadingMore={isLoadingMoreAssets}
        hasMore={Boolean(nextCursor)}
        error={assetsError}
        loadingLabel='Loading assets...'
        onLoadMore={onLoadMore}
        toolbar={
          <div className='mb-3 space-y-2'>
            <AdminTableToolbar marginBottom='none'>
              <div className='min-w-[200px] flex-1'>
                <Label htmlFor='assets-search'>Search</Label>
                <Input
                  id='assets-search'
                  value={filters.query ?? ''}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder='Title, file name, or client'
                />
              </div>
              <div className='min-w-[180px]'>
                <Label htmlFor='assets-visibility'>Visibility</Label>
                <Select
                  id='assets-visibility'
                  value={filters.visibility ?? ''}
                  onChange={(event) => onVisibilityChange(event.target.value as AssetVisibility | '')}
                >
                  <option value=''>All</option>
                  {ASSET_VISIBILITIES.map((visibility) => (
                    <option key={visibility} value={visibility}>
                      {formatEnumLabel(visibility)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className='min-w-[200px]'>
                <Label htmlFor='assets-tag-filter'>Tags</Label>
                <Select
                  id='assets-tag-filter'
                  value={filters.tagName ?? ''}
                  onChange={(event) =>
                    onTagNameChange(event.target.value === '' ? '' : event.target.value)
                  }
                >
                  <option value=''>All tags</option>
                  {tagFilterOptions.map((name) => (
                    <option key={name} value={name}>
                      {formatAssetTagDisplayName(name)}
                    </option>
                  ))}
                </Select>
              </div>
            </AdminTableToolbar>
            {viewAssetError ? <AdminInlineError>{viewAssetError}</AdminInlineError> : null}
          </div>
        }
      >
        <AdminDataTable tableClassName='min-w-[920px]'>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Title</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Tags</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Language</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Visibility</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>File</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Updated</AdminDataTableHeadCell>
              <AdminDataTableOperationsHeadCell />
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {isLoadingAssets ? null : assets.length === 0 ? (
              <tr>
                <AdminDataTableCell colSpan={7} className='py-8 text-slate-600'>
                  No assets found for the current filters.
                </AdminDataTableCell>
              </tr>
            ) : (
              assets.map((asset) => {
                const isSelected = asset.id === selectedAssetId;
                const isExpenseLinked = asset.tags.some((tag) =>
                  isExpenseAttachmentAssetTag(tag.name)
                );
                const isInvoiceLinked = asset.tags.some((tag) =>
                  isCustomerInvoiceAssetTag(tag.name)
                );
                const isRestrictedSystemLinked = asset.tags.some((tag) =>
                  isRestrictedSystemAssetTag(tag.name)
                );
                const sortedTags = [...asset.tags].sort((a, b) =>
                  a.name.localeCompare(b.name)
                );
                return (
                  <tr
                    key={asset.id}
                    className={`cursor-pointer transition hover:bg-slate-50 ${
                      isSelected ? 'bg-slate-100' : ''
                    }`}
                    onClick={() => onSelectAsset(asset.id)}
                    onKeyDown={(event) => handleRowKeyDown(event, asset.id)}
                    tabIndex={0}
                    role='row'
                    aria-selected={isSelected}
                  >
                    <AdminDataTableCell>
                      <p className='font-medium text-slate-900'>{asset.title}</p>
                      <p className='mt-0.5 text-xs text-slate-500'>{asset.id}</p>
                    </AdminDataTableCell>
                    <AdminDataTableCell className='text-slate-700'>
                      {sortedTags.length === 0 ? (
                        '—'
                      ) : (
                        <div className='flex flex-wrap gap-1'>
                          {sortedTags.map((tag) => {
                            const nameLower = tag.name.toLowerCase();
                            const isExpense = nameLower === EXPENSE_ATTACHMENT_ASSET_TAG;
                            const isClient = nameLower === CLIENT_DOCUMENT_ASSET_TAG;
                            const isInvoice = nameLower === CUSTOMER_INVOICE_ASSET_TAG;
                            const pillClass = isExpense
                              ? 'rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900'
                              : isClient
                                ? 'rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900'
                                : isInvoice
                                  ? 'rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900'
                                  : 'rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800';
                            return (
                              <span key={tag.id} className={pillClass}>
                                {formatAssetTagDisplayName(tag.name)}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </AdminDataTableCell>
                    <AdminDataTableCell className='text-slate-700'>
                      {formatAssetContentLanguageLabel(asset.contentLanguage)}
                    </AdminDataTableCell>
                    <AdminDataTableCell className='text-slate-700'>
                      {formatEnumLabel(asset.visibility)}
                    </AdminDataTableCell>
                    <AdminDataTableCell className='text-slate-700'>{asset.fileName || '—'}</AdminDataTableCell>
                    <AdminDataTableCell className='text-slate-700'>{formatDate(asset.updatedAt)}</AdminDataTableCell>
                    <AdminDataTableCell className='text-right'>
                      <div className='flex justify-end gap-1'>
                        <OpenAdminAssetInNewTabButton
                          assetId={asset.id}
                          isOpening={openingAssetId === asset.id}
                          onOpen={(assetId, event) => {
                            event.stopPropagation();
                            void openAssetInNewTab(assetId);
                          }}
                        />
                        <Button
                          type='button'
                          size='sm'
                          variant='danger'
                          onClick={(event) => void handleDeleteAsset(asset, event)}
                          disabled={isDeletingAssetId === asset.id || isRestrictedSystemLinked}
                          title={
                            isInvoiceLinked
                              ? 'Cannot delete assets linked to customer invoices'
                              : isExpenseLinked
                                ? 'Cannot delete assets linked to expenses'
                                : 'Delete asset'
                          }
                          aria-label={
                            isInvoiceLinked
                              ? 'Cannot delete: asset is linked to customer invoices'
                              : isExpenseLinked
                                ? 'Cannot delete: asset is linked to expenses'
                                : 'Delete asset'
                          }
                        >
                          <DeleteIcon className='h-4 w-4' />
                        </Button>
                      </div>
                    </AdminDataTableCell>
                  </tr>
                );
              })
            )}
          </AdminDataTableBody>
        </AdminDataTable>
      </PaginatedTableCard>
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
