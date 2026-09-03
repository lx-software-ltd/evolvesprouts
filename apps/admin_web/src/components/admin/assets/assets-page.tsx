'use client';

import type { AdminAsset } from '@/types/assets';

import { AssetEditorPanel } from './asset-editor-panel';
import { AssetGrantsPanel } from './asset-grants-panel';
import { AssetListPanel } from './asset-list-panel';

import { StatusBanner } from '@/components/status-banner';
import { AdminDiscardChangesDialog } from '@/components/ui/admin-discard-changes-dialog';
import { useAdminAssets } from '@/hooks/use-admin-assets';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { getApiConfigError } from '@/lib/config';

const DEFAULT_ASSET_TYPE = 'document' as const;
const DEFAULT_CONTENT_TYPE = 'application/pdf' as const;

export function AssetsPage() {
  const apiConfigError = getApiConfigError();
  const {
    filters,
    assets,
    pinnedAsset,
    linkedTagNames,
    nextCursor,
    isLoadingAssets,
    isLoadingMoreAssets,
    assetsError,
    assetMutationError,
    isSavingAsset,
    isDeletingAssetId,
    uploadState,
    uploadPhase,
    uploadError,
    hasPendingUpload,
    selectedAssetId,
    expanded,
    setEditorDirty,
    grants,
    isLoadingGrants,
    grantsError,
    grantMutationError,
    isSavingGrant,
    isDeletingGrantId,
    setQueryFilter,
    setVisibilityFilter,
    setTagNameFilter,
    loadMoreAssets,
    selectAsset,
    clearSelectedAsset,
    openDraft,
    createAssetEntry,
    replaceAssetFileEntry,
    updateAssetEntry,
    deleteAssetEntry,
    createGrantEntry,
    deleteGrantEntry,
    retryPendingUpload,
    replaceSuccessNonce,
  } = useAdminAssets();

  const handleToggle = (id: string) => {
    if (expanded.expandedId === id) {
      clearSelectedAsset();
      return;
    }
    if (id === DRAFT_RECORD_ID) {
      openDraft();
      return;
    }
    selectAsset(id);
  };

  const renderDetail = (asset: AdminAsset | null) => {
    const isSelected = asset !== null && asset.id === selectedAssetId;
    return (
      <AssetEditorPanel
        key={`${asset?.id ?? DRAFT_RECORD_ID}-${replaceSuccessNonce}`}
        selectedAsset={asset}
        isSavingAsset={isSavingAsset}
        isDeletingCurrentAsset={asset !== null && isDeletingAssetId === asset.id}
        assetMutationError={assetMutationError}
        uploadState={uploadState}
        uploadPhase={uploadPhase}
        uploadError={uploadError}
        hasPendingUpload={hasPendingUpload}
        onRetryUpload={retryPendingUpload}
        onDirtyChange={setEditorDirty}
        onReplaceFile={
          asset ? (file) => replaceAssetFileEntry(asset.id, file, DEFAULT_CONTENT_TYPE) : undefined
        }
        onCreate={async (payload, file) => {
          try {
            await createAssetEntry(
              {
                ...payload,
                assetType: DEFAULT_ASSET_TYPE,
                contentType: DEFAULT_CONTENT_TYPE,
              },
              file
            );
          } catch {
            // The hook stores the actionable error state for UI display.
          }
        }}
        onUpdate={async (assetId, payload) => updateAssetEntry(assetId, payload)}
      >
        {isSelected ? (
          <AssetGrantsPanel
            selectedAsset={asset}
            grants={grants}
            isLoadingGrants={isLoadingGrants}
            grantsError={grantsError}
            grantMutationError={grantMutationError}
            isSavingGrant={isSavingGrant}
            isDeletingGrantId={isDeletingGrantId}
            onCreateGrant={async (assetId, input) => {
              try {
                await createGrantEntry(assetId, input);
                return true;
              } catch {
                // The hook stores the actionable error state for UI display.
                return false;
              }
            }}
            onDeleteGrant={async (assetId, grantId) => {
              try {
                await deleteGrantEntry(assetId, grantId);
              } catch {
                // The hook stores the actionable error state for UI display.
              }
            }}
          />
        ) : null}
      </AssetEditorPanel>
    );
  };

  return (
    <div className='space-y-6'>
      {apiConfigError ? (
        <StatusBanner variant='error' title='Configuration'>
          {apiConfigError}
        </StatusBanner>
      ) : null}
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AssetListPanel
        assets={assets}
        pinnedAsset={pinnedAsset}
        linkedTagNames={linkedTagNames}
        expandedId={expanded.expandedId}
        filters={filters}
        isLoadingAssets={isLoadingAssets}
        isLoadingMoreAssets={isLoadingMoreAssets}
        isDeletingAssetId={isDeletingAssetId}
        assetsError={assetsError}
        nextCursor={nextCursor}
        onQueryChange={setQueryFilter}
        onVisibilityChange={setVisibilityFilter}
        onTagNameChange={setTagNameFilter}
        onLoadMore={loadMoreAssets}
        onToggle={handleToggle}
        onDeleteAsset={async (assetId) => {
          try {
            await deleteAssetEntry(assetId);
          } catch {
            // The hook stores the actionable error state for UI display.
          }
        }}
        renderDetail={renderDetail}
      />
    </div>
  );
}
