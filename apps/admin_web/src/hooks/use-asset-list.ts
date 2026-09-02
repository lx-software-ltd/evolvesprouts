'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ADMIN_LIST_PAGE_SIZE } from '@/lib/admin-list-query';
import { listAdminAssets } from '@/lib/assets-api';
import {
  CLIENT_DOCUMENT_ASSET_TAG,
  type AdminAsset,
  type AssetVisibility,
  type ListAdminAssetsInput,
} from '@/types/assets';

import { useLocationSearchParam } from './use-query-tab-state';
import { usePaginatedList } from './use-paginated-list';

type Filters = Pick<ListAdminAssetsInput, 'query' | 'visibility' | 'tagName'>;

const ASSET_LIST_TYPE_FILTER = 'document' as const;

export interface UseAssetListReturn {
  filters: Filters;
  assets: AdminAsset[];
  linkedTagNames: string[];
  nextCursor: string | null;
  isLoadingAssets: boolean;
  isLoadingMoreAssets: boolean;
  assetsError: string;
  selectedAssetId: string | null;
  selectedAsset: AdminAsset | null;
  setQueryFilter: (query: string) => void;
  setVisibilityFilter: (visibility: AssetVisibility | '') => void;
  setTagNameFilter: (tagName: ListAdminAssetsInput['tagName']) => void;
  refreshAssets: (nextFilters?: Partial<Filters>) => Promise<void>;
  loadMoreAssets: () => Promise<void>;
  selectAsset: (assetId: string) => void;
  clearSelectedAsset: () => void;
  applyCreatedAsset: (createdAsset: AdminAsset | null) => Promise<void>;
  applyUpdatedAsset: (assetId: string, updatedAsset: AdminAsset | null) => Promise<void>;
  applyDeletedAsset: (assetId: string) => void;
}

function filtersFromLocation(query: string, tag: string): Filters {
  return {
    query,
    visibility: '',
    tagName: tag || CLIENT_DOCUMENT_ASSET_TAG,
  };
}

export function useAssetList(): UseAssetListReturn {
  const urlQuery = useLocationSearchParam('query');
  const urlTag = useLocationSearchParam('tag');
  const [linkedTagNames, setLinkedTagNames] = useState<string[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  const fetcher = useCallback(
    async (params: Filters & { cursor: string | null; limit: number; signal: AbortSignal }) => {
      const response = await listAdminAssets({
        query: params.query,
        visibility: params.visibility,
        tagName: params.tagName,
        assetType: ASSET_LIST_TYPE_FILTER,
        cursor: params.cursor,
        limit: params.limit,
      });
      setLinkedTagNames(response.linkedTagNames);
      return { items: response.items, nextCursor: response.nextCursor };
    },
    []
  );

  const list = usePaginatedList<AdminAsset, Filters>({
    fetcher,
    defaultFilters: filtersFromLocation(urlQuery, urlTag),
    limit: ADMIN_LIST_PAGE_SIZE,
    errorPrefix: 'Failed to load assets',
    debounceKeys: ['query'],
    debounceMs: 350,
  });

  const {
    items,
    filters,
    setFilter,
    setItems,
    refetch,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    loadMore,
  } = list;

  // Keep the explicit selection only when that row is still in the list. Never
  // auto-select the first row; create mode must stay reachable via Cancel.
  const resolvedSelectedAssetId =
    selectedAssetId && items.some((item) => item.id === selectedAssetId)
      ? selectedAssetId
      : null;

  const selectedAsset = useMemo(
    () => items.find((asset) => asset.id === resolvedSelectedAssetId) ?? null,
    [items, resolvedSelectedAssetId]
  );

  const currentQuery = filters.query;
  const currentTagName = filters.tagName;

  useEffect(() => {
    const nextQuery = urlQuery;
    const nextTag = urlTag || CLIENT_DOCUMENT_ASSET_TAG;
    if (nextQuery !== currentQuery) {
      setFilter('query', nextQuery);
    }
    if (nextTag !== currentTagName) {
      setFilter('tagName', nextTag);
    }
  }, [currentQuery, currentTagName, setFilter, urlQuery, urlTag]);

  const refreshAssets = useCallback(
    async (nextFilters?: Partial<Filters>) => {
      await refetch(nextFilters);
    },
    [refetch]
  );

  const setQueryFilter = useCallback(
    (query: string) => {
      setFilter('query', query);
    },
    [setFilter]
  );

  const setVisibilityFilter = useCallback(
    (visibility: AssetVisibility | '') => {
      setFilter('visibility', visibility);
    },
    [setFilter]
  );

  const setTagNameFilter = useCallback(
    (tagName: ListAdminAssetsInput['tagName']) => {
      setFilter('tagName', tagName ?? '');
    },
    [setFilter]
  );

  const selectAsset = useCallback((assetId: string) => {
    setSelectedAssetId(assetId);
  }, []);

  const clearSelectedAsset = useCallback(() => {
    setSelectedAssetId(null);
  }, []);

  const applyCreatedAsset = useCallback(
    async (createdAsset: AdminAsset | null) => {
      if (!createdAsset || filters.tagName) {
        await refreshAssets();
        return;
      }
      setItems((previous) => [createdAsset, ...previous]);
      setSelectedAssetId(createdAsset.id);
    },
    [filters.tagName, refreshAssets, setItems]
  );

  const applyUpdatedAsset = useCallback(
    async (assetId: string, updatedAsset: AdminAsset | null) => {
      if (!updatedAsset) {
        await refreshAssets();
        return;
      }
      setItems((previous) => previous.map((asset) => (asset.id === assetId ? updatedAsset : asset)));
    },
    [refreshAssets, setItems]
  );

  const applyDeletedAsset = useCallback(
    (assetId: string) => {
      setItems((previous) => previous.filter((asset) => asset.id !== assetId));
      setSelectedAssetId((currentId) => (currentId === assetId ? null : currentId));
    },
    [setItems]
  );

  return {
    filters,
    assets: items,
    linkedTagNames,
    nextCursor: hasMore ? 'more' : null,
    isLoadingAssets: isLoading,
    isLoadingMoreAssets: isLoadingMore,
    assetsError: error,
    selectedAssetId: resolvedSelectedAssetId,
    selectedAsset,
    setQueryFilter,
    setVisibilityFilter,
    setTagNameFilter,
    refreshAssets,
    loadMoreAssets: loadMore,
    selectAsset,
    clearSelectedAsset,
    applyCreatedAsset,
    applyUpdatedAsset,
    applyDeletedAsset,
  };
}
