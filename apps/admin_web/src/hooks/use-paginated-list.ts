'use client';

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import {
  hashKey,
  keepPreviousData,
  useInfiniteQuery,
  type InfiniteData,
  type QueryFunctionContext,
} from '@tanstack/react-query';

import { ADMIN_LIST_PAGE_SIZE, clampAdminListLimit } from '@/lib/admin-list-query';
import { getAdminQueryClient } from '@/lib/admin-query-client';

import { toErrorMessage } from './hook-errors';
import { useDebouncedCallback } from './use-debounced-callback';

export interface PaginatedResponse<TItem> {
  items: TItem[];
  nextCursor: string | null;
  /** When omitted, {@link usePaginatedList} exposes `totalCount: null` (unknown total). */
  totalCount?: number;
}

export type PaginatedFetcherParams<TFilters extends object> = TFilters & {
  cursor: string | null;
  limit: number;
  signal: AbortSignal;
};

export interface UsePaginatedListOptions<TItem, TFilters extends object> {
  fetcher: (params: PaginatedFetcherParams<TFilters>) => Promise<PaginatedResponse<TItem>>;
  defaultFilters: TFilters;
  limit?: number;
  errorPrefix?: string;
  debounceKeys?: (keyof TFilters)[];
  debounceMs?: number;
  fetchOnMount?: boolean;
  /**
   * Cache key prefix (see `adminQueryKeys.<resource>.lists()`). The active
   * filters are appended, so every hook instance with the same prefix and
   * filters shares one cached list across mounts. When omitted the list is
   * cached for this hook instance only.
   */
  queryKey?: readonly unknown[];
}

export interface UsePaginatedListReturn<TItem, TFilters extends object> {
  items: TItem[];
  setItems: Dispatch<SetStateAction<TItem[]>>;
  filters: TFilters;
  setFilter: <TKey extends keyof TFilters>(key: TKey, value: TFilters[TKey]) => void;
  clearFilters: () => void;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string;
  refetch: (nextFilters?: Partial<TFilters>) => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  /** `null` when the list API omitted `totalCount` (unknown). */
  totalCount: number | null;
}

type PageParam = string | null;
type ListData<TItem> = InfiniteData<PaginatedResponse<TItem>, PageParam>;

function getNextPageParam<TItem>(lastPage: PaginatedResponse<TItem>): PageParam | undefined {
  return lastPage.nextCursor ?? undefined;
}

function flattenPages<TItem>(data: ListData<TItem> | undefined): TItem[] {
  if (!data) {
    return [];
  }
  return data.pages.flatMap((page) => page.items);
}

function trimToFirstPage<TItem>(data: ListData<TItem> | undefined): ListData<TItem> | undefined {
  if (!data || data.pages.length <= 1) {
    return data;
  }
  return { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

const EMPTY_ITEMS: never[] = [];

/**
 * Warm the cache for a list's first page with the exact key and page shape
 * `usePaginatedList` will read, so the section renders instantly when the
 * user navigates there. No-op when a fresh page is already cached.
 */
export async function prefetchPaginatedList<TItem, TFilters extends object>({
  queryKey,
  filters,
  fetcher,
  limit = ADMIN_LIST_PAGE_SIZE,
}: {
  queryKey: readonly unknown[];
  filters: TFilters;
  fetcher: UsePaginatedListOptions<TItem, TFilters>['fetcher'];
  limit?: number;
}): Promise<void> {
  const pageSize = clampAdminListLimit(limit);
  try {
    await getAdminQueryClient().prefetchInfiniteQuery<
      PaginatedResponse<TItem>,
      unknown,
      PaginatedResponse<TItem>,
      readonly unknown[],
      PageParam
    >({
      queryKey: [...queryKey, filters],
      queryFn: ({ pageParam, signal }) =>
        fetcher({ ...filters, cursor: pageParam, limit: pageSize, signal }),
      initialPageParam: null,
      getNextPageParam,
      pages: 1,
    });
  } catch {
    // Prefetch is best-effort; the page surfaces errors on its own fetch.
  }
}

export function usePaginatedList<TItem, TFilters extends object>({
  fetcher,
  defaultFilters,
  limit = ADMIN_LIST_PAGE_SIZE,
  errorPrefix = 'Failed to load',
  debounceKeys = [],
  debounceMs = 300,
  fetchOnMount = true,
  queryKey,
}: UsePaginatedListOptions<TItem, TFilters>): UsePaginatedListReturn<TItem, TFilters> {
  const queryClient = getAdminQueryClient();
  const pageSize = clampAdminListLimit(limit);
  const instanceId = useId();
  // Without an explicit key the cache is private to this hook instance and a
  // new fetcher identity (closure params changed) starts a fresh list, which
  // is what the pre-cache implementation did by refetching on fetcher change.
  const fetcherIdentityRef = useRef<{ fetcher: typeof fetcher; version: number }>({
    fetcher,
    version: 0,
  });
  if (fetcherIdentityRef.current.fetcher !== fetcher) {
    fetcherIdentityRef.current = { fetcher, version: fetcherIdentityRef.current.version + 1 };
  }
  const fetcherVersion = fetcherIdentityRef.current.version;
  const baseKey = useMemo<readonly unknown[]>(
    () => queryKey ?? ['admin', 'list', instanceId, fetcherVersion],
    // Callers may pass a fresh array each render; compare by hash instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey ? hashKey(queryKey) : `${instanceId}:${fetcherVersion}`]
  );

  const [filters, setFilters] = useState<TFilters>(defaultFilters);
  const [committedFilters, setCommittedFilters] = useState<TFilters>(defaultFilters);
  const [armed, setArmed] = useState(fetchOnMount);
  // `fetchOnMount` may flip from false to true later (for example once a parent
  // record is selected); that must start fetching like a mount would.
  const enabled = armed || fetchOnMount;
  const filtersRef = useRef<TFilters>(defaultFilters);
  const explicitRefetchRef = useRef(false);

  const buildKey = useCallback(
    (activeFilters: TFilters) => [...baseKey, activeFilters] as const,
    [baseKey]
  );

  const makeQueryFn = useCallback(
    (activeFilters: TFilters) =>
      ({ pageParam, signal }: QueryFunctionContext<readonly unknown[], PageParam>) =>
        fetcher({
          ...activeFilters,
          cursor: pageParam,
          limit: pageSize,
          signal,
        }),
    [fetcher, pageSize]
  );

  const activeKey = useMemo(() => buildKey(committedFilters), [buildKey, committedFilters]);
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  const query = useInfiniteQuery<
    PaginatedResponse<TItem>,
    unknown,
    ListData<TItem>,
    readonly unknown[],
    PageParam
  >(
    {
      queryKey: activeKey,
      queryFn: makeQueryFn(committedFilters),
      initialPageParam: null,
      getNextPageParam,
      enabled,
      placeholderData: keepPreviousData,
    },
    queryClient
  );

  const commitFilters = useCallback((nextFilters: TFilters) => {
    filtersRef.current = nextFilters;
    setFilters(nextFilters);
    setCommittedFilters(nextFilters);
    setArmed(true);
  }, []);

  const refetch = useCallback(
    async (nextFilters?: Partial<TFilters>) => {
      const effectiveFilters = { ...filtersRef.current, ...(nextFilters ?? {}) };
      commitFilters(effectiveFilters);
      const key = buildKey(effectiveFilters);
      explicitRefetchRef.current = true;
      // Only page one is reloaded; "Load more" pages are dropped like before.
      queryClient.setQueryData<ListData<TItem>>(key, trimToFirstPage);
      try {
        await queryClient.fetchInfiniteQuery<
          PaginatedResponse<TItem>,
          unknown,
          PaginatedResponse<TItem>,
          readonly unknown[],
          PageParam
        >({
          queryKey: key,
          queryFn: makeQueryFn(effectiveFilters),
          initialPageParam: null,
          getNextPageParam,
          staleTime: 0,
          retry: false,
        });
      } catch {
        // The observer exposes the failure through `error`.
      } finally {
        explicitRefetchRef.current = false;
      }
    },
    [buildKey, commitFilters, makeQueryFn, queryClient]
  );

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const loadMore = useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage) {
      return;
    }
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const debouncedCommit = useDebouncedCallback((nextFilters: TFilters) => {
    commitFilters(nextFilters);
  }, debounceMs);

  const setFilter = useCallback(
    <TKey extends keyof TFilters>(key: TKey, value: TFilters[TKey]) => {
      const nextFilters = { ...filtersRef.current, [key]: value };
      filtersRef.current = nextFilters;
      setFilters(nextFilters);
      if (debounceKeys.includes(key)) {
        debouncedCommit(nextFilters);
      } else {
        commitFilters(nextFilters);
      }
    },
    [commitFilters, debouncedCommit, debounceKeys]
  );

  const clearFilters = useCallback(() => {
    void refetch(defaultFilters);
  }, [refetch, defaultFilters]);

  const setItems = useCallback<Dispatch<SetStateAction<TItem[]>>>(
    (update) => {
      queryClient.setQueryData<ListData<TItem>>(activeKeyRef.current, (data) => {
        if (!data) {
          return data;
        }
        const currentItems = flattenPages(data);
        const nextItems = typeof update === 'function' ? update(currentItems) : update;
        const lastPage = data.pages[data.pages.length - 1];
        return {
          pages: [{ ...lastPage, items: nextItems }],
          pageParams: [null],
        };
      });
    },
    [queryClient]
  );

  const items = useMemo(
    () => (query.data ? flattenPages(query.data) : (EMPTY_ITEMS as TItem[])),
    [query.data]
  );
  const lastPage = query.data?.pages[query.data.pages.length - 1];
  const totalCount = lastPage?.totalCount === undefined ? null : lastPage.totalCount;

  const isFetchingFirstPage = query.isFetching && !isFetchingNextPage;
  const isLoading =
    enabled &&
    (query.isPending ||
      query.isPlaceholderData ||
      (isFetchingFirstPage && explicitRefetchRef.current));

  let error = '';
  if (query.error && !query.isFetching && !isAbortError(query.error)) {
    error = toErrorMessage(
      query.error,
      query.isFetchNextPageError ? `${errorPrefix} more.` : `${errorPrefix}.`
    );
  }

  return {
    items,
    setItems,
    filters,
    setFilter,
    clearFilters,
    isLoading,
    isLoadingMore: isFetchingNextPage,
    error,
    refetch,
    loadMore,
    hasMore: Boolean(hasNextPage),
    totalCount,
  };
}
