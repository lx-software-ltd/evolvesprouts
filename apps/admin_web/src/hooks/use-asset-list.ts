'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ADMIN_LIST_PAGE_SIZE } from '@/lib/admin-list-query';
import { getAdminAsset, listAdminAssets } from '@/lib/assets-api';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import {
  CLIENT_DOCUMENT_ASSET_TAG,
  type AdminAsset,
  type AssetVisibility,
  type ListAdminAssetsInput,
} from '@/types/assets';

import { DRAFT_RECORD_ID, useExpandedRecord, type UseExpandedRecordReturn } from './use-expanded-record';
import { useExpandedRecordForm } from './use-expanded-record-form';
import { useLocationSearchParam } from './use-query-tab-state';
import { usePaginatedList } from './use-paginated-list';

type Filters = Pick<ListAdminAssetsInput, 'query' | 'visibility' | 'tagName'>;

const ASSET_LIST_TYPE_FILTER = 'document' as const;

/** Query parameter that mirrors the expanded asset row (`?asset=<id>` or `?asset=new`). */
export const ADMIN_ASSET_QUERY_PARAM = 'asset';

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
  /** Deep-linked asset fetched because it is not in the loaded pages; render it above the list. */
  pinnedAsset: AdminAsset | null;
  /** Single-open row state (draft or asset), URL-synced and guarded by `setEditorDirty`. */
  expanded: UseExpandedRecordReturn;
  /** Flag unsaved editor changes so switching rows asks first. */
  setEditorDirty: (dirty: boolean) => void;
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
  const editorDirtyRef = useRef(false);
  const setEditorDirty = useCallback((dirty: boolean) => {
    editorDirtyRef.current = dirty;
  }, []);
  const expanded = useExpandedRecord({
    paramName: ADMIN_ASSET_QUERY_PARAM,
    isDirty: () => editorDirtyRef.current,
  });

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
    queryKey: adminQueryKeys.assets.lists(),
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

  const noop = useCallback(() => {}, []);
  // Deep links to an asset outside the loaded pages fetch it once and pin it
  // above the list; unresolvable ids collapse. The editor keeps its own field
  // state (keyed by asset id), so there is nothing to apply or reset here.
  const { pinnedRow: pinnedAsset } = useExpandedRecordForm<AdminAsset>({
    expandedId: expanded.expandedId,
    rows: items,
    isLoading,
    applyRow: noop,
    reset: noop,
    collapse: expanded.collapse,
    fetchMissing: getAdminAsset,
  });

  const expandedAssetId =
    expanded.expandedId && expanded.expandedId !== DRAFT_RECORD_ID ? expanded.expandedId : null;
  const selectedAsset = useMemo(
    () =>
      items.find((asset) => asset.id === expandedAssetId) ??
      (pinnedAsset?.id === expandedAssetId ? pinnedAsset : null),
    [items, expandedAssetId, pinnedAsset]
  );
  const resolvedSelectedAssetId = selectedAsset?.id ?? null;

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

  const { expand: expandRow, collapse: collapseRow, expandedId } = expanded;

  const selectAsset = useCallback(
    (assetId: string) => {
      expandRow(assetId);
    },
    [expandRow]
  );

  const clearSelectedAsset = useCallback(() => {
    collapseRow();
  }, [collapseRow]);

  const applyCreatedAsset = useCallback(
    async (createdAsset: AdminAsset | null) => {
      if (!createdAsset || filters.tagName) {
        await refreshAssets();
        return;
      }
      setItems((previous) => [createdAsset, ...previous]);
      // The draft row was the open editor; move the expansion to the new record
      // so the upload status renders on it.
      editorDirtyRef.current = false;
      expandRow(createdAsset.id);
    },
    [expandRow, filters.tagName, refreshAssets, setItems]
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
      if (expandedId === assetId) {
        editorDirtyRef.current = false;
        collapseRow();
      }
    },
    [collapseRow, expandedId, setItems]
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
    pinnedAsset,
    expanded,
    setEditorDirty,
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
