'use client';

import { AssetEditorPanel } from './asset-editor-panel';
import { AssetGrantsPanel } from './asset-grants-panel';
import { AssetListPanel } from './asset-list-panel';

import { StatusBanner } from '@/components/status-banner';
import { AdminCollapsibleSection } from '@/components/ui/admin-collapsible-section';
import { useAdminAssets } from '@/hooks/use-admin-assets';
import { getApiConfigError } from '@/lib/config';

const DEFAULT_ASSET_TYPE = 'document' as const;
const DEFAULT_CONTENT_TYPE = 'application/pdf' as const;

export function AssetsPage() {
  const apiConfigError = getApiConfigError();
  const {
    filters,
    assets,
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
    selectedAsset,
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
    createAssetEntry,
    replaceAssetFileEntry,
    updateAssetEntry,
    deleteAssetEntry,
    createGrantEntry,
    deleteGrantEntry,
    retryPendingUpload,
    replaceSuccessNonce,
  } = useAdminAssets();

  return (
    <div className='space-y-6'>
      {apiConfigError ? (
        <StatusBanner variant='error' title='Configuration'>
          {apiConfigError}
        </StatusBanner>
      ) : null}

      <AssetEditorPanel
        key={`${selectedAsset?.id ?? 'new-asset'}-${replaceSuccessNonce}`}
        selectedAsset={selectedAsset}
        isSavingAsset={isSavingAsset}
        isDeletingCurrentAsset={Boolean(selectedAssetId) && isDeletingAssetId === selectedAssetId}
        assetMutationError={assetMutationError}
        uploadState={uploadState}
        uploadPhase={uploadPhase}
        uploadError={uploadError}
        hasPendingUpload={hasPendingUpload}
        onRetryUpload={retryPendingUpload}
        onReplaceFile={async (file) => {
          if (!selectedAssetId) {
            return false;
          }
          return replaceAssetFileEntry(selectedAssetId, file, DEFAULT_CONTENT_TYPE);
        }}
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
        onStartCreate={clearSelectedAsset}
      />

      <AdminCollapsibleSection id='asset-access-grants' title='Access grants'>
        <AssetGrantsPanel
          selectedAsset={selectedAsset}
          grants={grants}
          isLoadingGrants={isLoadingGrants}
          grantsError={grantsError}
          grantMutationError={grantMutationError}
          isSavingGrant={isSavingGrant}
          isDeletingGrantId={isDeletingGrantId}
          onCreateGrant={async (assetId, input) => {
            try {
              await createGrantEntry(assetId, input);
            } catch {
              // The hook stores the actionable error state for UI display.
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
      </AdminCollapsibleSection>

      <AssetListPanel
        assets={assets}
        linkedTagNames={linkedTagNames}
        selectedAssetId={selectedAssetId}
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
        onSelectAsset={selectAsset}
        onDeleteAsset={async (assetId) => {
          try {
            await deleteAssetEntry(assetId);
          } catch {
            // The hook stores the actionable error state for UI display.
          }
        }}
      />
    </div>
  );
}
