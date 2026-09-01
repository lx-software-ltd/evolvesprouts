'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * Persist a tab-style view selection in the page URL as a query parameter
 * (e.g. `?tab=vendors`).
 *
 * Design notes:
 * - `useSyncExternalStore` is used so the server snapshot (empty) matches
 *   the statically prerendered HTML (`output: 'export'`) while the client
 *   snapshot immediately reflects `window.location.search`. React handles
 *   the cross-over during hydration without tripping a hydration mismatch.
 * - Tab changes use `history.replaceState` so they do not create back/forward
 *   history entries. The param is omitted entirely when the active tab is the
 *   default, keeping URLs clean (e.g. `/finance` rather than
 *   `/finance?tab=expenses`). Unrelated query parameters are preserved.
 * - Because `history.replaceState` does not fire `popstate`, each update
 *   dispatches a synthetic `popstate` event so subscribers re-read the
 *   search string immediately.
 * - An effect strips unknown tab values and explicit-default tab values
 *   from the URL. It only mutates `history`; it never calls `setState`.
 */
export function useLocationSearchParam(paramName: string): string {
  const search = useSyncExternalStore(
    subscribeToLocationSearch,
    getClientLocationSearch,
    getServerLocationSearch
  );
  return new URLSearchParams(search).get(paramName)?.trim() ?? '';
}

export function useQueryTabState<T extends string>(
  validKeys: readonly T[],
  defaultKey: T,
  paramName: string = 'tab'
): [T, (next: T) => void] {
  const search = useSyncExternalStore(
    subscribeToLocationSearch,
    getClientLocationSearch,
    getServerLocationSearch
  );

  const rawValue = new URLSearchParams(search).get(paramName);
  const isKnownKey =
    rawValue !== null && (validKeys as readonly string[]).includes(rawValue);
  const activeTab: T =
    isKnownKey && rawValue !== defaultKey ? (rawValue as T) : defaultKey;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (rawValue === null) {
      return;
    }
    if (isKnownKey && rawValue !== defaultKey) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete(paramName);
    window.history.replaceState(null, '', formatUrl(url));
    emitLocationSearchChange();
  }, [rawValue, isKnownKey, defaultKey, paramName]);

  const setActiveTab = useCallback(
    (next: T) => {
      if (typeof window === 'undefined') {
        return;
      }
      const url = new URL(window.location.href);
      if (next === defaultKey) {
        url.searchParams.delete(paramName);
      } else {
        url.searchParams.set(paramName, next);
      }
      window.history.replaceState(null, '', formatUrl(url));
      emitLocationSearchChange();
    },
    [defaultKey, paramName]
  );

  return [activeTab, setActiveTab];
}

const LOCATION_SEARCH_EVENT = 'cursor:location-search-change';

function subscribeToLocationSearch(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener('popstate', onStoreChange);
  window.addEventListener(LOCATION_SEARCH_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('popstate', onStoreChange);
    window.removeEventListener(LOCATION_SEARCH_EVENT, onStoreChange);
  };
}

function getClientLocationSearch(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location.search;
}

function getServerLocationSearch(): string {
  return '';
}

function emitLocationSearchChange(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(LOCATION_SEARCH_EVENT));
}

function formatUrl(url: URL): string {
  const query = url.searchParams.toString();
  const suffix = query ? `?${query}` : '';
  return `${url.pathname}${suffix}${url.hash}`;
}
