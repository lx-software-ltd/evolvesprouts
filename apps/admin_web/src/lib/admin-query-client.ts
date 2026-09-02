import { QueryClient, type DefaultOptions } from '@tanstack/react-query';

/**
 * Cache tuning for the admin SPA. Lists render from cache instantly on
 * remount and revalidate in the background once older than `staleTime`.
 * Retries stay off: admin API errors surface to the user immediately and the
 * feature hooks already own their error banners.
 */
export const ADMIN_QUERY_DEFAULTS: DefaultOptions = {
  queries: {
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  },
  mutations: {
    retry: false,
  },
};

let client: QueryClient | null = null;

/**
 * Single QueryClient for the whole admin app. Hooks pass it explicitly so the
 * cache works the same inside and outside `QueryClientProvider` (tests render
 * hooks and components without a wrapper).
 */
export function getAdminQueryClient(): QueryClient {
  if (!client) {
    client = new QueryClient({ defaultOptions: ADMIN_QUERY_DEFAULTS });
  }
  return client;
}

/**
 * Replace the singleton with a fresh client. Tests call this before each case
 * so cached pages never leak between tests; `staleTime: 0` restores the
 * fetch-on-mount behaviour feature tests were written against.
 */
export function resetAdminQueryClientForTests(overrides: DefaultOptions = {}): QueryClient {
  client?.clear();
  client = new QueryClient({
    defaultOptions: {
      ...ADMIN_QUERY_DEFAULTS,
      ...overrides,
      queries: { ...ADMIN_QUERY_DEFAULTS.queries, ...overrides.queries },
      mutations: { ...ADMIN_QUERY_DEFAULTS.mutations, ...overrides.mutations },
    },
  });
  return client;
}
