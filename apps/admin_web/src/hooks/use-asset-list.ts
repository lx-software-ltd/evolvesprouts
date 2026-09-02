'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

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
    limit: 25,
    errorPrefix: 'Failed to load assets',
    debounceKeys: ['query'],
    debounceMs: 350,
  });

  const selectedAsset = useMemo(
    () => list.items.find((asset) => asset.id === selectedAssetId) ?? null,
    [list.items, selectedAssetId]
  );

  useEffect(() => {
    setSelectedAssetId((currentId) => {
      if (!currentId) {
        return list.items[0]?.id ?? null;
      }
      return list.items.some((item) => item.id === currentId) ? currentId : (list.items[0]?.id ?? null);
    });
  }, [list.items]);

  const currentQuery = list.filters.query;
  const currentTagName = list.filters.tagName;
  const setFilter = list.setFilter;

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
      await list.refetch(nextFilters);
    },
    [list.refetch]
  );

  const setQueryFilter = useCallback(
    (query: string) => {
      list.setFilter('query', query);
    },
    [list.setFilter]
  );

  const setVisibilityFilter = useCallback(
    (visibility: AssetVisibility | '') => {
      list.setFilter('visibility', visibility);
    },
    [list.setFilter]
  );

  const setTagNameFilter = useCallback(
    (tagName: ListAdminAssetsInput['tagName']) => {
      list.setFilter('tagName', tagName ?? '');
    },
    [list.setFilter]
  );

  const selectAsset = useCallback((assetId: string) => {
    setSelectedAssetId(assetId);
  }, []);

  const clearSelectedAsset = useCallback(() => {
    setSelectedAssetId(null);
  }, []);

  const applyCreatedAsset = useCallback(
    async (createdAsset: AdminAsset | null) => {
      if (!createdAsset || list.filters.tagName) {
        await refreshAssets();
        return;
      }
      list.setItems((previous) => [createdAsset, ...previous]);
      setSelectedAssetId(createdAsset.id);
    },
    [list.filters.tagName, list.setItems, refreshAssets]
  );

  const applyUpdatedAsset = useCallback(
    async (assetId: string, updatedAsset: AdminAsset | null) => {
      if (!updatedAsset) {
        await refreshAssets();
        return;
      }
      list.setItems((previous) => previous.map((asset) => (asset.id === assetId ? updatedAsset : asset)));
    },
    [list.setItems, refreshAssets]
  );

  const applyDeletedAsset = useCallback(
    (assetId: string) => {
      list.setItems((previous) => previous.filter((asset) => asset.id !== assetId));
      setSelectedAssetId((currentId) => (currentId === assetId ? null : currentId));
    },
    [list.setItems]
  );

  return {
    filters: list.filters,
    assets: list.items,
    linkedTagNames,
    nextCursor: list.hasMore ? 'more' : null,
    isLoadingAssets: list.isLoading,
    isLoadingMoreAssets: list.isLoadingMore,
    assetsError: list.error,
    selectedAssetId,
    selectedAsset,
    setQueryFilter,
    setVisibilityFilter,
    setTagNameFilter,
    refreshAssets,
    loadMoreAssets: list.loadMore,
    selectAsset,
    clearSelectedAsset,
    applyCreatedAsset,
    applyUpdatedAsset,
    applyDeletedAsset,
  };
}
