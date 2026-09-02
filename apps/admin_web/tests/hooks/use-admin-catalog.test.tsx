import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAdminQueryClientForTests } from '@/lib/admin-query-client';

const listInstructorUsers = vi.fn();
const listAllLocations = vi.fn();
const listAllVenueAndPartnerLocations = vi.fn();

vi.mock('@/lib/users-api', () => ({
  listAdminUsers: vi.fn(async () => ({ items: [] })),
  listInstructorUsers: () => listInstructorUsers(),
}));

vi.mock('@/lib/entity-api', () => ({
  listEntityTags: vi.fn(async () => []),
}));

vi.mock('@/lib/services-api', () => ({
  listGeographicAreas: vi.fn(async () => []),
  listAllLocations: () => listAllLocations(),
  listAllVenueAndPartnerLocations: () => listAllVenueAndPartnerLocations(),
}));

import { invalidateSharedLocations } from '@/hooks/use-admin-catalog';
import { useInstructorUsers } from '@/hooks/use-instructor-users';
import { useLocationList } from '@/hooks/use-location-list';

describe('shared admin catalogs', () => {
  beforeEach(() => {
    listInstructorUsers.mockResolvedValue({
      items: [{ id: 'u1', email: 'a@example.com', displayName: 'A' }],
    });
    listAllLocations.mockResolvedValue([{ id: 'loc-all' }]);
    listAllVenueAndPartnerLocations.mockResolvedValue([{ id: 'loc-venue' }]);
  });

  afterEach(() => {
    // Unmount before resetting so a still-mounted hook cannot refetch into the
    // fresh store and leak state into the next test.
    cleanup();
    resetAdminQueryClientForTests();
    vi.clearAllMocks();
  });

  it('useInstructorUsers does not fetch while disabled and exposes an empty list', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useInstructorUsers(enabled),
      { initialProps: { enabled: false } }
    );

    expect(result.current.users).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(listInstructorUsers).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.users).toHaveLength(1));
    expect(listInstructorUsers).toHaveBeenCalledTimes(1);
  });

  it('useLocationList shares one venue-location fetch across hook instances', async () => {
    const first = renderHook(() => useLocationList());
    const second = renderHook(() => useLocationList());

    await waitFor(() => expect(first.result.current.locations).toEqual([{ id: 'loc-venue' }]));
    await waitFor(() => expect(second.result.current.locations).toEqual([{ id: 'loc-venue' }]));
    expect(listAllVenueAndPartnerLocations).toHaveBeenCalledTimes(1);
  });

  it('invalidateSharedLocations reloads the venue-location catalog', async () => {
    const { result } = renderHook(() => useLocationList());
    await waitFor(() => expect(result.current.locations).toHaveLength(1));

    listAllVenueAndPartnerLocations.mockResolvedValue([{ id: 'loc-venue' }, { id: 'loc-new' }]);
    act(() => {
      invalidateSharedLocations();
    });

    await waitFor(() => expect(result.current.locations).toHaveLength(2));
    expect(listAllVenueAndPartnerLocations).toHaveBeenCalledTimes(2);
  });
});
