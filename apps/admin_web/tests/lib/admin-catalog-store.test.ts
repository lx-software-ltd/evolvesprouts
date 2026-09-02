import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ensureAdminCatalog,
  getAdminCatalogEntry,
  invalidateAdminCatalog,
  resetAdminCatalogStoreForTests,
} from '@/lib/admin-catalog-store';

describe('admin-catalog-store', () => {
  afterEach(() => {
    resetAdminCatalogStoreForTests();
  });

  it('loads once and reuses the cached page', async () => {
    const fetcher = vi.fn(async () => [{ id: '1' }]);
    await ensureAdminCatalog('entityTags', fetcher);
    await ensureAdminCatalog('entityTags', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getAdminCatalogEntry('entityTags').items).toEqual([{ id: '1' }]);
  });

  it('reloads after invalidate', async () => {
    const fetcher = vi.fn(async () => [{ id: '1' }]);
    await ensureAdminCatalog('entityTags', fetcher);
    invalidateAdminCatalog('entityTags');
    await ensureAdminCatalog('entityTags', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
