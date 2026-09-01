import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { createLocation, geocodeVenueAddress, updateLocationPartial } = vi.hoisted(() => ({
  createLocation: vi.fn(),
  geocodeVenueAddress: vi.fn(),
  updateLocationPartial: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/services-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services-api')>('@/lib/services-api');
  return {
    ...actual,
    createLocation,
    geocodeVenueAddress,
    updateLocationPartial,
  };
});

import { FamiliesPanel } from '@/components/admin/contacts/families-panel';

import type { useAdminEntityFamilies } from '@/hooks/use-admin-entity-families';

const noopRefresh = vi.fn().mockResolvedValue(undefined);

const emptyRelatedFlags = {
  has_sales_conversation: false,
  sales_conversation_channel: null,
  has_service_instance: false,
  has_invoice: false,
} as const;

const hkArea = {
  id: 'area-hk',
  parentId: null,
  name: 'Hong Kong',
  level: 'country' as const,
  code: 'HK',
  sovereignCountryId: null,
  active: true,
  displayOrder: 0,
};

function buildFamiliesHook(
  overrides: Partial<ReturnType<typeof useAdminEntityFamilies>> = {}
): ReturnType<typeof useAdminEntityFamilies> {
  return {
    families: [],
    filters: { query: '', active: 'true' as const, contact_type: '' as const },
    setFilter: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: '',
    loadMore: vi.fn(),
    totalCount: 0,
    isSaving: false,
    createFamily: vi.fn().mockResolvedValue(null),
    updateFamily: vi.fn().mockResolvedValue(null),
    addMember: vi.fn().mockResolvedValue(null),
    removeMember: vi.fn().mockResolvedValue(null),
    updateMember: vi.fn().mockResolvedValue(null),
    deleteFamily: vi.fn().mockResolvedValue(undefined),
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('FamiliesPanel', () => {
  it('creates a family with non-vendor relationship default', async () => {
    const user = userEvent.setup();
    const createFamily = vi.fn().mockResolvedValue(null);
    const families = buildFamiliesHook({ createFamily });

    render(
      <FamiliesPanel
        families={families}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        contactOptions={[]}
        contactsForMembership={[]}
      />
    );

    await user.type(screen.getByLabelText('Family name'), 'The Smiths');
    await user.click(screen.getByRole('button', { name: 'Create family' }));

    expect(createFamily).toHaveBeenCalledWith(
      expect.objectContaining({
        family_name: 'The Smiths',
        relationship_type: 'prospect',
      })
    );
  });

  it('invokes loadMore when pagination allows', async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn().mockResolvedValue(undefined);
    const families = buildFamiliesHook({ hasMore: true, loadMore });

    render(
      <FamiliesPanel
        families={families}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        contactOptions={[]}
        contactsForMembership={[]}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(loadMore).toHaveBeenCalled();
  });

  it('PATCHes location without name when updating address inline', async () => {
    const user = userEvent.setup();
    const updateFamily = vi.fn().mockResolvedValue(null);
    const families = buildFamiliesHook({
      updateFamily,
      families: [
        {
          id: 'fam-1',
          family_name: 'Smith',
          relationship_type: 'prospect',
          location_id: 'loc-1',
          location_summary: {
            id: 'loc-1',
            name: 'Venue Name',
            area_id: 'area-hk',
            area_name: 'Hong Kong',
            address: '1 Old',
            lat: null,
            lng: null,
          },
          tag_ids: [],
          tags: [],
          members: [],
          active: true,
          created_at: '2020-01-01T00:00:00.000Z',
          updated_at: '2020-01-01T00:00:00.000Z',
          ...emptyRelatedFlags,
        },
      ],
    });

    render(
      <FamiliesPanel
        families={families}
        tags={[]}
        locations={[
          {
            id: 'loc-1',
            name: 'Venue Name',
            areaId: 'area-hk',
            address: '1 Old',
            lat: null,
            lng: null,
            createdAt: null,
            updatedAt: null,
            lockedFromPartnerOrg: false,
            partnerOrganizationLabels: [],
            partnerOrganizationIds: [],
          },
        ]}
        geographicAreas={[hkArea]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        contactOptions={[]}
        contactsForMembership={[]}
      />
    );

    await user.click(screen.getByText('Smith'));
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.clear(screen.getByLabelText('Address'));
    await user.type(screen.getByLabelText('Address'), '2 New St');
    await user.click(screen.getByRole('button', { name: 'Update family' }));

    await waitFor(() => {
      expect(updateLocationPartial).toHaveBeenCalledWith('loc-1', {
        area_id: 'area-hk',
        address: '2 New St',
        lat: null,
        lng: null,
      });
    });
    expect(updateLocationPartial.mock.calls[0][1]).not.toHaveProperty('name');
    expect(updateFamily).toHaveBeenCalledWith(
      'fam-1',
      expect.objectContaining({
        location_id: 'loc-1',
      })
    );
  });

  it('toggles primary contact from the members table', async () => {
    const user = userEvent.setup();
    const updateMember = vi.fn().mockResolvedValue(null);
    const families = buildFamiliesHook({
      updateMember,
      families: [
        {
          id: 'fam-1',
          family_name: 'Smith',
          relationship_type: 'prospect',
          location_id: null,
          location_summary: null,
          tag_ids: [],
          tags: [],
          members: [
            {
              id: 'mem-1',
              contact_id: 'c-1',
              contact_label: 'Alex Smith',
              role: 'parent',
              is_primary_contact: false,
            },
          ],
          active: true,
          created_at: '2020-01-01T00:00:00.000Z',
          updated_at: '2020-01-01T00:00:00.000Z',
          ...emptyRelatedFlags,
        },
      ],
    });

    render(
      <FamiliesPanel
        families={families}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        contactOptions={[]}
        contactsForMembership={[]}
      />
    );

    await user.click(screen.getByText('Smith'));
    const primaryCheckbox = screen.getByRole('checkbox', {
      name: 'Primary contact for Alex Smith',
    });
    await user.click(primaryCheckbox);

    await waitFor(() => {
      expect(updateMember).toHaveBeenCalledWith('fam-1', 'mem-1', {
        is_primary_contact: true,
      });
    });
  });

  it('deletes a family after confirmation', async () => {
    const user = userEvent.setup();
    const deleteFamily = vi.fn().mockResolvedValue(undefined);
    const families = buildFamiliesHook({
      deleteFamily,
      families: [
        {
          id: 'fam-del',
          family_name: 'Delete Me',
          relationship_type: 'prospect',
          location_id: null,
          location_summary: null,
          tag_ids: [],
          tags: [],
          members: [],
          active: true,
          created_at: '2020-01-01T00:00:00.000Z',
          updated_at: '2020-01-01T00:00:00.000Z',
          ...emptyRelatedFlags,
        },
      ],
    });

    render(
      <FamiliesPanel
        families={families}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        contactOptions={[]}
        contactsForMembership={[]}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Delete family' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteFamily).toHaveBeenCalledWith('fam-del');
    });
  });

  it('shows related-record operation links only when those records exist', () => {
    const families = buildFamiliesHook({
      families: [
        {
          id: 'fam-linked',
          family_name: 'Linked',
          relationship_type: 'client',
          location_id: null,
          location_summary: null,
          tag_ids: [],
          tags: [],
          members: [],
          active: true,
          created_at: '2020-01-01T00:00:00.000Z',
          updated_at: '2020-01-01T00:00:00.000Z',
          has_sales_conversation: true,
          sales_conversation_channel: 'instagram',
          has_service_instance: true,
          has_invoice: true,
        },
        {
          id: 'fam-plain',
          family_name: 'Plain',
          relationship_type: 'prospect',
          location_id: null,
          location_summary: null,
          tag_ids: [],
          tags: [],
          members: [],
          active: true,
          created_at: '2020-01-01T00:00:00.000Z',
          updated_at: '2020-01-01T00:00:00.000Z',
          ...emptyRelatedFlags,
        },
      ],
    });

    render(
      <FamiliesPanel
        families={families}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        contactOptions={[]}
        contactsForMembership={[]}
      />
    );

    const salesLink = screen.getByRole('link', { name: 'Sales conversations' });
    expect(salesLink).toHaveAttribute('href', '/sales?tab=instagram&family=fam-linked');
    expect(salesLink).toHaveClass('h-8', 'px-3');
    expect(screen.getByRole('link', { name: 'Service instances' })).toHaveAttribute(
      'href',
      '/services?family=fam-linked'
    );
    expect(screen.getByRole('link', { name: 'Invoices' })).toHaveAttribute(
      'href',
      '/finance?family=fam-linked'
    );
    expect(screen.getAllByRole('link', { name: 'Sales conversations' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Service instances' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Invoices' })).toHaveLength(1);
  });
});
