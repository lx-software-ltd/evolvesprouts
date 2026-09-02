import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateAdminPartner, mockUpdateAdminPartner, mockRefetch, paginatedState } = vi.hoisted(() => {
  const mockRefetch = vi.fn().mockResolvedValue(undefined);
  const paginatedState = {
    items: [],
    filters: { query: '', active: '' },
    setFilter: vi.fn(),
    clearFilters: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    error: '',
    refetch: mockRefetch,
    loadMore: vi.fn(),
    hasMore: false,
    totalCount: 0,
  };

  return {
    mockCreateAdminPartner: vi.fn(),
    mockUpdateAdminPartner: vi.fn(),
    mockRefetch,
    paginatedState,
  };
});

vi.mock('@/hooks/use-paginated-list', () => ({
  usePaginatedList: vi.fn((opts: { fetchOnMount?: boolean }) => ({
    ...paginatedState,
    isLoading: opts?.fetchOnMount === false ? false : paginatedState.isLoading,
  })),
}));

vi.mock('@/lib/entity-api', () => ({
  listAdminOrganizations: vi.fn(),
  createAdminOrganization: mockCreateAdminPartner,
  updateAdminOrganization: mockUpdateAdminPartner,
  deleteAdminOrganization: vi.fn(),
  addAdminOrganizationMember: vi.fn(),
  removeAdminOrganizationMember: vi.fn(),
  patchAdminOrganizationMember: vi.fn(),
}));

import { usePartners } from '@/hooks/use-partners';

describe('usePartners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates partner and refetches', async () => {
    mockCreateAdminPartner.mockResolvedValue({ id: 'p1' });
    const { result } = renderHook(() => usePartners());

    await act(async () => {
      await result.current.createPartner({
        name: 'Coop',
        organization_type: 'ngo',
        relationship_type: 'partner',
        website: null,
        location_id: null,
        tag_ids: [],
      });
    });

    expect(mockCreateAdminPartner).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Coop',
        relationship_type: 'partner',
      })
    );
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('exposes fixed partner relationship option', () => {
    const { result } = renderHook(() => usePartners());
    expect(result.current.relationshipOptions).toEqual(['partner']);
  });
});
