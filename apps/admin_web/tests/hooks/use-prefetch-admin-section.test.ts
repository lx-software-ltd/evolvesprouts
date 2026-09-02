import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const listAdminContacts = vi.fn();
const listLeads = vi.fn();

vi.mock('@/lib/entity-api', () => ({
  listAdminContacts: (...args: unknown[]) => listAdminContacts(...args),
}));
vi.mock('@/lib/leads-api', () => ({
  listLeads: (...args: unknown[]) => listLeads(...args),
}));

import { useAdminEntityContacts } from '@/hooks/use-admin-entity-contacts';
import { prefetchAdminSection } from '@/hooks/use-prefetch-admin-section';
import { resetAdminQueryClientForTests } from '@/lib/admin-query-client';

describe('prefetchAdminSection', () => {
  it('warms the contacts list so the hook mounts with cached rows and no refetch', async () => {
    resetAdminQueryClientForTests({ queries: { staleTime: 60_000 } });
    listAdminContacts.mockResolvedValue({
      items: [{ id: 'c1', first_name: 'Ada' }],
      nextCursor: null,
      totalCount: 1,
    });

    await prefetchAdminSection('contacts');
    expect(listAdminContacts).toHaveBeenCalledTimes(1);
    expect(listAdminContacts.mock.calls[0][0]).toMatchObject({
      query: '',
      active: 'true',
      cursor: null,
      limit: 25,
    });

    const { result } = renderHook(() => useAdminEntityContacts());
    expect(result.current.contacts).toEqual([{ id: 'c1', first_name: 'Ada' }]);
    expect(result.current.isLoading).toBe(false);
    await waitFor(() => expect(listAdminContacts).toHaveBeenCalledTimes(1));
  });

  it('is a no-op for sections without a registered prefetch and swallows fetch errors', async () => {
    await expect(prefetchAdminSection('tags')).resolves.toBeUndefined();

    listLeads.mockRejectedValue(new Error('boom'));
    await expect(prefetchAdminSection('sales')).resolves.toBeUndefined();
    expect(listLeads).toHaveBeenCalledTimes(1);
  });
});
