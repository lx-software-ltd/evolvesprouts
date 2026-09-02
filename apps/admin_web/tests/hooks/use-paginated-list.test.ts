import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePaginatedList } from '@/hooks/use-paginated-list';
import { resetAdminQueryClientForTests } from '@/lib/admin-query-client';

type Filters = { query: string };

describe('usePaginatedList', () => {
  it('serves a shared-key list from cache on remount and revalidates in the background', async () => {
    resetAdminQueryClientForTests({ queries: { staleTime: 60_000 } });
    const fetcher = vi.fn(async () => ({ items: ['a', 'b'], nextCursor: null, totalCount: 2 }));
    const options = {
      fetcher,
      defaultFilters: { query: '' } as Filters,
      queryKey: ['admin', 'test-resource', 'list'] as const,
    };

    const first = renderHook(() => usePaginatedList(options));
    expect(first.result.current.isLoading).toBe(true);
    await waitFor(() => expect(first.result.current.items).toEqual(['a', 'b']));
    expect(first.result.current.totalCount).toBe(2);
    first.unmount();

    const second = renderHook(() => usePaginatedList(options));
    expect(second.result.current.items).toEqual(['a', 'b']);
    expect(second.result.current.isLoading).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('appends pages on loadMore and lets setItems patch the cached rows', async () => {
    const fetcher = vi.fn(
      async ({ cursor }: Filters & { cursor: string | null; limit: number; signal: AbortSignal }) =>
        cursor === null
          ? { items: ['a'], nextCursor: 'c1', totalCount: 2 }
          : { items: ['b'], nextCursor: null, totalCount: 2 }
    );
    const { result } = renderHook(() =>
      usePaginatedList({ fetcher, defaultFilters: { query: '' } as Filters })
    );

    await waitFor(() => expect(result.current.items).toEqual(['a']));
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.items).toEqual(['a', 'b']));
    expect(result.current.hasMore).toBe(false);

    act(() => {
      result.current.setItems((current) => current.map((item) => item.toUpperCase()));
    });
    await waitFor(() => expect(result.current.items).toEqual(['A', 'B']));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('starts fetching once fetchOnMount flips to true', async () => {
    const fetcher = vi.fn(async () => ({ items: ['x'], nextCursor: null }));
    const { result, rerender } = renderHook(
      ({ fetchOnMount }: { fetchOnMount: boolean }) =>
        usePaginatedList({ fetcher, defaultFilters: { query: '' } as Filters, fetchOnMount }),
      { initialProps: { fetchOnMount: false } }
    );

    expect(result.current.isLoading).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();

    rerender({ fetchOnMount: true });
    await waitFor(() => expect(result.current.items).toEqual(['x']));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('ignores stale responses when a newer refetch completes first', async () => {
    let resolveFirst: ((value: { items: string[]; nextCursor: null; totalCount: number }) => void) | null =
      null;
    let resolveSecond:
      | ((value: { items: string[]; nextCursor: null; totalCount: number }) => void)
      | null = null;

    const fetcher = vi.fn(
      ({ query }: Filters & { cursor: string | null; limit: number; signal: AbortSignal }) =>
        new Promise<{ items: string[]; nextCursor: null; totalCount: number }>((resolve, reject) => {
          if (query === 'first') {
            resolveFirst = resolve;
            return;
          }
          if (query === 'second') {
            resolveSecond = resolve;
            return;
          }
          reject(new Error(`Unexpected query: ${query}`));
        })
    );

    const { result } = renderHook(() =>
      usePaginatedList({
        fetcher,
        defaultFilters: { query: 'first' },
        fetchOnMount: false,
      })
    );

    await act(async () => {
      const firstPromise = result.current.refetch({ query: 'first' });
      const secondPromise = result.current.refetch({ query: 'second' });
      resolveSecond?.({ items: ['fresh'], nextCursor: null, totalCount: 1 });
      await secondPromise;
      resolveFirst?.({ items: ['stale'], nextCursor: null, totalCount: 1 });
      await firstPromise;
    });

    await waitFor(() => {
      expect(result.current.items).toEqual(['fresh']);
    });
  });

  it('does not set error state for aborted requests', async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });

    const { result } = renderHook(() =>
      usePaginatedList({
        fetcher,
        defaultFilters: { query: '' },
        fetchOnMount: true,
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('');
  });
});
