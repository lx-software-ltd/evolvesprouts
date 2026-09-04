'use client';

import { useMemo, type ReactNode } from 'react';

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

import { DeleteIcon } from '@/components/icons/action-icons';
import OpenInNewTabIcon from '@/components/icons/svg/open-in-new-tab-icon.svg';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { useOpenAdminAssetInNewTab } from '@/hooks/use-open-admin-asset-in-new-tab';
import {
  formatAssetContentLanguageLabel,
  formatAssetTagDisplayName,
  formatDate,
  formatEnumLabel,
} from '@/lib/format';

const COLUMN_COUNT = 7;

export interface AssetListPanelProps {
  assets: AdminAsset[];
  /** Deep-linked asset outside the loaded pages; rendered above the list. */
  pinnedAsset?: AdminAsset | null;
  /** Tag names returned by the admin asset list API for the current asset type scope. */
  linkedTagNames: string[];
  /** `DRAFT_RECORD_ID`, an asset id, or `null` when no row is open. */
  expandedId: string | null;
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
  /** Toggle a row (`DRAFT_RECORD_ID` for the create button). */
  onToggle: (id: string) => void;
  onDeleteAsset: (assetId: string) => Promise<void>;
  /** Editor for the open row; `null` asset renders the draft (create) editor. */
  renderDetail: (asset: AdminAsset | null) => ReactNode;
}

function tagPillClass(name: string): string {
  const nameLower = name.toLowerCase();
  if (nameLower === EXPENSE_ATTACHMENT_ASSET_TAG) {
    return 'rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900';
  }
  if (nameLower === CLIENT_DOCUMENT_ASSET_TAG) {
    return 'rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900';
  }
  if (nameLower === CUSTOMER_INVOICE_ASSET_TAG) {
    return 'rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900';
  }
  return 'rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800';
}

function deleteLabel(asset: AdminAsset, isDeleting: boolean): string {
  if (asset.tags.some((tag) => isCustomerInvoiceAssetTag(tag.name))) {
    return 'Cannot delete: asset is linked to customer invoices';
  }
  if (asset.tags.some((tag) => isExpenseAttachmentAssetTag(tag.name))) {
    return 'Cannot delete: asset is linked to expenses';
  }
  return isDeleting ? 'Deleting asset' : 'Delete asset';
}

/**
 * Assets as a table-first list: filters and the create button above, one
 * expandable row per asset with the editor inside the expansion.
 */
export function AssetListPanel({
  assets,
  pinnedAsset = null,
  linkedTagNames,
  expandedId,
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
  onToggle,
  onDeleteAsset,
  renderDetail,
}: AssetListPanelProps) {
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const { openingAssetId, openError: viewAssetError, openAssetInNewTab } = useOpenAdminAssetInNewTab();
  const isDraftOpen = expandedId === DRAFT_RECORD_ID;

  const tagFilterOptions = useMemo(() => {
    const names = [...linkedTagNames];
    const current = filters.tagName?.trim() ?? '';
    if (current && !names.includes(current)) {
      names.push(current);
    }
    return names.sort((a, b) => a.localeCompare(b));
  }, [linkedTagNames, filters.tagName]);

  const rows = useMemo(
    () => (pinnedAsset && !assets.some((asset) => asset.id === pinnedAsset.id) ? [pinnedAsset, ...assets] : assets),
    [assets, pinnedAsset]
  );

  const handleDeleteAsset = async (asset: AdminAsset) => {
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
      <AdminRecordTable
        aria-label='Assets'
        columnCount={COLUMN_COUNT}
        rowCount={rows.length}
        isLoading={isLoadingAssets}
        isLoadingMore={isLoadingMoreAssets}
        hasMore={Boolean(nextCursor)}
        onLoadMore={onLoadMore}
        error={assetsError || viewAssetError}
        errorTitle='Assets'
        emptyLabel='No assets found for the current filters.'
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='New asset'
                active={isDraftOpen}
                onClick={() => onToggle(DRAFT_RECORD_ID)}
              />
            }
          >
            <AdminFilterField label='Search' htmlFor='assets-search' className='sm:basis-72'>
              <Input
                id='assets-search'
                value={filters.query ?? ''}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder='Title, file name, or client'
                autoComplete='off'
              />
            </AdminFilterField>
            <AdminFilterField label='Visibility' htmlFor='assets-visibility'>
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
            </AdminFilterField>
            <AdminFilterField label='Tags' htmlFor='assets-tag-filter'>
              <Select
                id='assets-tag-filter'
                value={filters.tagName ?? ''}
                onChange={(event) => onTagNameChange(event.target.value === '' ? '' : event.target.value)}
              >
                <option value=''>All tags</option>
                {tagFilterOptions.map((name) => (
                  <option key={name} value={name}>
                    {formatAssetTagDisplayName(name)}
                  </option>
                ))}
              </Select>
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Title</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Tags</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Language</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Visibility</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Updated</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new asset'
            expanded
            isDraft
            onToggle={() => onToggle(DRAFT_RECORD_ID)}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New asset</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
              </>
            }
            actions={null}
            detail={renderDetail(null)}
          />
        ) : null}
        {rows.map((asset) => {
          const isOpen = expandedId === asset.id;
          const isDeleting = isDeletingAssetId === asset.id;
          const isRestrictedSystemLinked = asset.tags.some((tag) => isRestrictedSystemAssetTag(tag.name));
          const sortedTags = [...asset.tags].sort((a, b) => a.name.localeCompare(b.name));
          const visibilityLabel = formatEnumLabel(asset.visibility);
          return (
            <AdminExpandableRow
              key={asset.id}
              id={asset.id}
              label={asset.title}
              expanded={isOpen}
              onToggle={() => onToggle(asset.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell>
                    <p className='font-medium text-slate-900'>{asset.title}</p>
                    <AdminDataTableCellMeta>
                      {visibilityLabel}
                      {sortedTags.length > 0
                        ? ` · ${sortedTags.map((tag) => formatAssetTagDisplayName(tag.name)).join(', ')}`
                        : ''}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {sortedTags.length === 0 ? (
                      '—'
                    ) : (
                      <div className='flex flex-wrap gap-1'>
                        {sortedTags.map((tag) => (
                          <span key={tag.id} className={tagPillClass(tag.name)}>
                            {formatAssetTagDisplayName(tag.name)}
                          </span>
                        ))}
                      </div>
                    )}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                    {formatAssetContentLanguageLabel(asset.contentLanguage)}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {visibilityLabel}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='whitespace-nowrap text-slate-700'>
                    {formatDate(asset.updatedAt)}
                  </AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'open',
                      label: openingAssetId === asset.id ? 'Opening asset' : 'Open asset in new tab',
                      icon: <OpenInNewTabIcon className='h-4 w-4' />,
                      disabled: openingAssetId === asset.id,
                      onClick: () => void openAssetInNewTab(asset.id),
                    },
                    {
                      key: 'delete',
                      label: deleteLabel(asset, isDeleting),
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: isDeleting || isRestrictedSystemLinked,
                      onClick: () => void handleDeleteAsset(asset),
                    },
                  ]}
                />
              }
              detail={isOpen ? renderDetail(asset) : null}
            />
          );
        })}
      </AdminRecordTable>
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
