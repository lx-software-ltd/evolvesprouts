'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listAdminAssets } from '@/lib/assets-api';
import {
  CLIENT_DOCUMENT_ASSET_TAG,
  type AdminAsset,
  type AssetVisibility,
  type ListAdminAssetsInput,
} from '@/types/assets';

import { toErrorMessage } from './hook-errors';
import { useDebouncedCallback } from './use-debounced-callback';
import { useLocationSearchParam } from './use-query-tab-state';

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
  const [filters, setFilters] = useState<Filters>(() => filtersFromLocation(urlQuery, urlTag));
  const filtersRef = useRef<Filters>(filtersFromLocation(urlQuery, urlTag));
  const latestRefreshRequestIdRef = useRef(0);
  const [assets, setAssets] = useState<AdminAsset[]>([]);
  const [linkedTagNames, setLinkedTagNames] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingAssets, setIsLoadingAssets] = useState(true);
  const [isLoadingMoreAssets, setIsLoadingMoreAssets] = useState(false);
  const [assetsError, setAssetsError] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId]
  );

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const refreshAssets = useCallback(async (nextFilters?: Partial<Filters>) => {
    const requestId = latestRefreshRequestIdRef.current + 1;
    latestRefreshRequestIdRef.current = requestId;
    const effectiveFilters = {
      ...filtersRef.current,
      ...nextFilters,
    };

    setIsLoadingAssets(true);
    setAssetsError('');

    try {
      const response = await listAdminAssets({
        ...effectiveFilters,
        assetType: ASSET_LIST_TYPE_FILTER,
        cursor: null,
        limit: 25,
      });
      if (requestId !== latestRefreshRequestIdRef.current) {
        return;
      }

      setAssets(response.items);
      setLinkedTagNames(response.linkedTagNames);
      setNextCursor(response.nextCursor);
      setSelectedAssetId((currentId) => {
        if (!currentId) {
          return response.items[0]?.id ?? null;
        }
        return response.items.some((item) => item.id === currentId)
          ? currentId
          : (response.items[0]?.id ?? null);
      });
    } catch (error) {
      if (requestId !== latestRefreshRequestIdRef.current) {
        return;
      }
      setAssetsError(toErrorMessage(error, 'Failed to load assets.'));
    } finally {
      if (requestId === latestRefreshRequestIdRef.current) {
        setIsLoadingAssets(false);
      }
    }
  }, []);

  const loadMoreAssets = useCallback(async () => {
    if (!nextCursor) {
      return;
    }

    setIsLoadingMoreAssets(true);
    setAssetsError('');

    try {
      const response = await listAdminAssets({
        ...filtersRef.current,
        assetType: ASSET_LIST_TYPE_FILTER,
        cursor: nextCursor,
        limit: 25,
      });

      setAssets((previous) => [...previous, ...response.items]);
      setLinkedTagNames(response.linkedTagNames);
      setNextCursor(response.nextCursor);
    } catch (error) {
      setAssetsError(toErrorMessage(error, 'Failed to load more assets.'));
    } finally {
      setIsLoadingMoreAssets(false);
    }
  }, [nextCursor]);

  useEffect(() => {
    void refreshAssets();
  }, [refreshAssets]);

  useEffect(() => {
    const nextFilters = {
      ...filtersRef.current,
      query: urlQuery,
      tagName: urlTag || CLIENT_DOCUMENT_ASSET_TAG,
    };
    if (
      nextFilters.query === filtersRef.current.query &&
      nextFilters.tagName === filtersRef.current.tagName
    ) {
      return;
    }
    filtersRef.current = nextFilters;
    setFilters(nextFilters);
    void refreshAssets(nextFilters);
  }, [refreshAssets, urlQuery, urlTag]);

  const debouncedRefresh = useDebouncedCallback((nextFilters: Partial<Filters>) => {
    void refreshAssets(nextFilters);
  }, 350);

  const setQueryFilter = useCallback(
    (query: string) => {
      const nextFilters = {
        ...filtersRef.current,
        query,
      };
      filtersRef.current = nextFilters;
      setFilters(nextFilters);
      debouncedRefresh(nextFilters);
    },
    [debouncedRefresh]
  );

  const setVisibilityFilter = useCallback(
    (visibility: AssetVisibility | '') => {
      const nextFilters = {
        ...filtersRef.current,
        visibility,
      };
      filtersRef.current = nextFilters;
      setFilters(nextFilters);
      void refreshAssets(nextFilters);
    },
    [refreshAssets]
  );

  const setTagNameFilter = useCallback(
    (tagName: ListAdminAssetsInput['tagName']) => {
      const nextFilters = {
        ...filtersRef.current,
        tagName: tagName ?? '',
      };
      filtersRef.current = nextFilters;
      setFilters(nextFilters);
      void refreshAssets(nextFilters);
    },
    [refreshAssets]
  );

  const selectAsset = useCallback((assetId: string) => {
    setSelectedAssetId(assetId);
  }, []);

  const clearSelectedAsset = useCallback(() => {
    setSelectedAssetId(null);
  }, []);

  const applyCreatedAsset = useCallback(
    async (createdAsset: AdminAsset | null) => {
      if (!createdAsset) {
        await refreshAssets();
        return;
      }
      if (filtersRef.current.tagName) {
        await refreshAssets();
        return;
      }
      setAssets((previous) => [createdAsset, ...previous]);
      setSelectedAssetId(createdAsset.id);
    },
    [refreshAssets]
  );

  const applyUpdatedAsset = useCallback(
    async (assetId: string, updatedAsset: AdminAsset | null) => {
      if (!updatedAsset) {
        await refreshAssets();
        return;
      }

      setAssets((previous) =>
        previous.map((asset) => (asset.id === assetId ? updatedAsset : asset))
      );
    },
    [refreshAssets]
  );

  const applyDeletedAsset = useCallback((assetId: string) => {
    setAssets((previous) => previous.filter((asset) => asset.id !== assetId));
    setSelectedAssetId((currentId) => (currentId === assetId ? null : currentId));
  }, []);

  return {
    filters,
    assets,
    linkedTagNames,
    nextCursor,
    isLoadingAssets,
    isLoadingMoreAssets,
    assetsError,
    selectedAssetId,
    selectedAsset,
    setQueryFilter,
    setVisibilityFilter,
    setTagNameFilter,
    refreshAssets,
    loadMoreAssets,
    selectAsset,
    clearSelectedAsset,
    applyCreatedAsset,
    applyUpdatedAsset,
    applyDeletedAsset,
  };
}
