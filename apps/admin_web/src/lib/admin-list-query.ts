/**
 * Default page size for admin list requests. Matches backend
 * `app.api.admin_request.DEFAULT_LIST_LIMIT`; keep the two in sync.
 */
export const ADMIN_LIST_PAGE_SIZE = 25;

/** Matches backend `MAX_LIST_LIMIT` in `app.api.admin_request.parse_limit`. */
export const ADMIN_API_MAX_LIST_LIMIT = 100;

/** Clamp page size so admin list requests never exceed the API cap. */
export function clampAdminListLimit(limit: number): number {
  const n = Math.floor(limit);
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return Math.min(n, ADMIN_API_MAX_LIST_LIMIT);
}

export type AdminQueryValue = string | number | boolean | null | undefined | readonly string[];

export interface AdminListPathOptions {
  /** Filter key/value pairs in the order they should appear in the query string. */
  filters?: Record<string, AdminQueryValue>;
  cursor?: string | null;
  limit?: number | null;
}

/**
 * Serialize one query value. Skips `null`, `undefined`, `false`, blank strings,
 * non-finite numbers, and empty arrays. Arrays are comma-joined (the admin API
 * convention for multi-value filters).
 */
export function appendAdminQueryValue(query: URLSearchParams, key: string, value: AdminQueryValue): void {
  if (value === null || value === undefined || value === false) {
    return;
  }
  if (typeof value === 'boolean') {
    query.set(key, 'true');
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      query.set(key, `${value}`);
    }
    return;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      query.set(key, trimmed);
    }
    return;
  }
  const entries = value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (entries.length > 0) {
    query.set(key, entries.join(','));
  }
}

/**
 * Build `basePath?filters&cursor&limit` for admin list endpoints. The limit is
 * clamped to the API cap; a base path with no query parameters is returned
 * unchanged.
 */
export function buildAdminListPath(basePath: string, options: AdminListPathOptions = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options.filters ?? {})) {
    appendAdminQueryValue(query, key, value);
  }
  appendAdminQueryValue(query, 'cursor', options.cursor);
  if (typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    query.set('limit', `${clampAdminListLimit(options.limit)}`);
  }
  const queryString = query.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}
