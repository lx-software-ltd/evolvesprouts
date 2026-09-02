import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { OrganizationsPanel } from '@/components/admin/contacts/organizations-panel';

import type { useAdminEntityOrganizations } from '@/hooks/use-admin-entity-organizations';
import { ORGANIZATION_RELATIONSHIP_TYPES } from '@/types/entity-relationship';
import type { components } from '@/types/generated/admin-api.generated';

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

function buildOrgsHook(
  overrides: Partial<ReturnType<typeof useAdminEntityOrganizations>> = {}
): ReturnType<typeof useAdminEntityOrganizations> {
  return {
    organizations: [],
    filters: { query: '', active: 'true' as const, contact_type: '' as const },
    setFilter: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: '',
    loadMore: vi.fn(),
    totalCount: 0,
    isSaving: false,
    createOrganization: vi.fn().mockResolvedValue(null),
    updateOrganization: vi.fn().mockResolvedValue(null),
    addMember: vi.fn().mockResolvedValue(null),
    removeMember: vi.fn().mockResolvedValue(null),
    updateMember: vi.fn().mockResolvedValue(null),
    deleteOrganization: vi.fn().mockResolvedValue(undefined),
    refetch: vi.fn(),
    relationshipOptions: [...ORGANIZATION_RELATIONSHIP_TYPES] as ReturnType<
      typeof useAdminEntityOrganizations
    >['relationshipOptions'],
    ...overrides,
  };
}

describe('OrganizationsPanel', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/contacts');
  });

  it('creates an organisation with default type from the draft row', async () => {
    const user = userEvent.setup();
    const createOrganization = vi.fn().mockResolvedValue(null);
    const organizations = buildOrgsHook({ createOrganization });

    render(
      <OrganizationsPanel
        organizations={organizations}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        contactOptions={[]}
        contactsForMembership={[]}
      />
    );

    expect(screen.getByRole('region', { name: 'Organisations' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New organisation' }));

    expect(window.location.search).toBe('?organization=new');
    expect(screen.getByTestId('admin-row-new')).toHaveAttribute('data-draft', 'true');

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create organisation' }));

    expect(createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Acme',
        organization_type: 'company',
        relationship_type: 'prospect',
      })
    );
  });

  it('lists CRM relationship options without partner and explains where vendors and partners live', async () => {
    const user = userEvent.setup();
    render(
      <OrganizationsPanel
        organizations={buildOrgsHook()}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        contactOptions={[]}
        contactsForMembership={[]}
      />
    );

    await user.click(screen.getByRole('button', { name: 'New organisation' }));

    const rel = screen.getByLabelText('Relationship');
    const options = Array.from(rel.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['prospect', 'client', 'other']);
    expect(
      screen.getByText(/CRM organisations only\. Vendors are managed under Finance → Vendors; partners under Services → Partners\./)
    ).toBeInTheDocument();
  });

  it('read-only when linked location is partner-org locked', async () => {
    const user = userEvent.setup();
    const row: components['schemas']['AdminOrganization'] = {
      id: 'org-1',
      name: 'Venue Org',
      organization_type: 'company',
      relationship_type: 'client',
      partner_key: null,
      website: null,
      location_id: 'loc-1',
      location_summary: {
        id: 'loc-1',
        name: null,
        area_id: 'area-hk',
        area_name: 'Hong Kong',
        address: 'Locked St',
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
    };
    const organizations = buildOrgsHook({
      organizations: [row],
    });

    render(
      <OrganizationsPanel
        organizations={organizations}
        tags={[]}
        locations={[
          {
            id: 'loc-1',
            name: null,
            areaId: 'area-hk',
            address: 'Locked St',
            lat: null,
            lng: null,
            createdAt: null,
            updatedAt: null,
            lockedFromPartnerOrg: true,
            partnerOrganizationLabels: ['Partner Org'],
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

    await user.click(screen.getByText('Venue Org'));
    await user.click(screen.getByRole('button', { name: /^Location/ }));

    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    expect(screen.getByText(/Managed from the partner organisation/)).toBeInTheDocument();
    expect(
      screen.getByText(/To change the venue name or switch to a different address/)
    ).toBeInTheDocument();
  });

  it('PATCHes location on inline update without name field', async () => {
    const user = userEvent.setup();
    const updateOrganization = vi.fn().mockResolvedValue(null);
    const row: components['schemas']['AdminOrganization'] = {
      id: 'org-2',
      name: 'School Co',
      organization_type: 'school',
      relationship_type: 'client',
      partner_key: null,
      website: null,
      location_id: 'loc-2',
      location_summary: {
        id: 'loc-2',
        name: 'Named Venue',
        area_id: 'area-hk',
        area_name: 'Hong Kong',
        address: 'Old Addr',
        lat: 1,
        lng: 2,
      },
      tag_ids: [],
      tags: [],
      members: [],
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      ...emptyRelatedFlags,
    };
    const organizations = buildOrgsHook({
      updateOrganization,
      organizations: [row],
    });

    render(
      <OrganizationsPanel
        organizations={organizations}
        tags={[]}
        locations={[
          {
            id: 'loc-2',
            name: 'Named Venue',
            areaId: 'area-hk',
            address: 'Old Addr',
            lat: 1,
            lng: 2,
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

    await user.click(screen.getByText('School Co'));
    expect(window.location.search).toBe('?organization=org-2');
    expect(screen.getByLabelText('Name')).toHaveValue('School Co');

    await user.click(screen.getByRole('button', { name: /^Location/ }));
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.clear(screen.getByLabelText('Address'));
    await user.type(screen.getByLabelText('Address'), 'New Addr');
    await user.click(screen.getByRole('button', { name: 'Update organisation' }));

    await waitFor(() => {
      expect(updateLocationPartial).toHaveBeenCalledWith('loc-2', {
        area_id: 'area-hk',
        address: 'New Addr',
        lat: 1,
        lng: 2,
      });
    });
    expect(updateLocationPartial.mock.calls[0][1]).not.toHaveProperty('name');
    expect(updateOrganization).toHaveBeenCalledWith(
      'org-2',
      expect.objectContaining({
        location_id: 'loc-2',
      })
    );
  });

  it('deletes an organisation after confirmation', async () => {
    const user = userEvent.setup();
    const deleteOrganization = vi.fn().mockResolvedValue(undefined);
    const row: components['schemas']['AdminOrganization'] = {
      id: 'org-del',
      name: 'Delete Org',
      organization_type: 'company',
      relationship_type: 'client',
      partner_key: null,
      website: null,
      location_id: null,
      location_summary: null,
      tag_ids: [],
      tags: [],
      members: [],
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      ...emptyRelatedFlags,
    };
    const organizations = buildOrgsHook({
      deleteOrganization,
      organizations: [row],
    });

    render(
      <OrganizationsPanel
        organizations={organizations}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        contactOptions={[]}
        contactsForMembership={[]}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Delete organisation' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteOrganization).toHaveBeenCalledWith('org-del');
    });
  });

  it('shows related-record operation links only when those records exist', async () => {
    const user = userEvent.setup();
    const withLinks: components['schemas']['AdminOrganization'] = {
      id: 'org-linked',
      name: 'Linked Org',
      organization_type: 'company',
      relationship_type: 'client',
      partner_key: null,
      website: null,
      location_id: null,
      location_summary: null,
      tag_ids: [],
      tags: [],
      members: [],
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      has_sales_conversation: true,
      sales_conversation_channel: 'messenger',
      has_service_instance: true,
      has_invoice: true,
    };
    const withoutLinks: components['schemas']['AdminOrganization'] = {
      ...withLinks,
      id: 'org-plain',
      name: 'Plain Org',
      ...emptyRelatedFlags,
    };
    const organizations = buildOrgsHook({
      organizations: [withLinks, withoutLinks],
    });

    render(
      <OrganizationsPanel
        organizations={organizations}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        contactOptions={[]}
        contactsForMembership={[]}
      />
    );

    const linkedRow = screen.getByTestId('admin-row-org-linked');
    const salesLink = within(linkedRow).getByRole('link', { name: 'Sales conversations' });
    expect(salesLink).toHaveAttribute('href', '/sales?tab=messenger&organization=org-linked');
    expect(salesLink).toHaveClass('h-8', 'w-8', 'bg-white', 'border');
    expect(within(linkedRow).queryByRole('link', { name: 'Service instances' })).not.toBeInTheDocument();

    await user.click(within(linkedRow).getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Service instances' })).toHaveAttribute(
      'href',
      '/services?organization=org-linked'
    );
    expect(within(menu).getByRole('menuitem', { name: 'Invoices' })).toHaveAttribute(
      'href',
      '/assets?tag=customer_invoice&query=Linked+Org'
    );
    expect(within(menu).getByRole('menuitem', { name: 'Delete organisation' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    const plainRow = screen.getByTestId('admin-row-org-plain');
    expect(within(plainRow).queryByRole('link')).not.toBeInTheDocument();
    expect(within(plainRow).queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
    expect(within(plainRow).getByRole('button', { name: 'Delete organisation' })).toBeInTheDocument();
  });
});
