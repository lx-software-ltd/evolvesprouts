import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { PartnersPanel } from '@/components/admin/services/partners-panel';

import type { usePartners } from '@/hooks/use-partners';
import type { components } from '@/types/generated/admin-api.generated';

const noopRefresh = vi.fn().mockResolvedValue(undefined);

const panelShell = {
  tags: [] as components['schemas']['EntityTagRef'][],
  locations: [],
  geographicAreas: [],
  areasLoading: false,
  refreshLocations: noopRefresh,
  tagsLoadError: '',
};

function buildPartnersHook(
  overrides: Partial<ReturnType<typeof usePartners>> = {}
): ReturnType<typeof usePartners> {
  return {
    partners: [],
    filters: { query: '', active: '' },
    setFilter: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: '',
    loadMore: vi.fn(),
    totalCount: 0,
    isSaving: false,
    createPartner: vi.fn().mockResolvedValue(null),
    updatePartner: vi.fn().mockResolvedValue(null),
    addMember: vi.fn().mockResolvedValue(null),
    removeMember: vi.fn().mockResolvedValue(null),
    updateMember: vi.fn().mockResolvedValue(null),
    deletePartner: vi.fn().mockResolvedValue(undefined),
    refetch: vi.fn(),
    relationshipOptions: ['partner'],
    ...overrides,
  };
}

vi.mock('@/hooks/use-confirm-dialog', () => ({
  useConfirmDialog: () => [
    {
      open: false,
      title: '',
      description: '',
      onConfirm: () => {},
      onCancel: () => {},
    },
    () => Promise.resolve(true),
  ],
}));

describe('PartnersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/services');
  });

  it('always shows partner key field and creates with relationship_type partner', async () => {
    const user = userEvent.setup();
    const createPartner = vi.fn().mockResolvedValue(null);
    const partners = buildPartnersHook({ createPartner });

    render(<PartnersPanel partners={partners} {...panelShell} />);

    expect(screen.getByRole('region', { name: 'Partners' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Partner' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Partner key')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New partner' }));

    expect(await screen.findByLabelText('Partner key')).toBeInTheDocument();
    expect(screen.getByLabelText('Legal name')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Name/), 'Gamma');
    await user.type(screen.getByLabelText('Partner key'), 'gamma-slug');
    await user.type(screen.getByLabelText('Legal name'), 'Gamma Learning Limited');
    await user.click(screen.getByRole('button', { name: 'Create partner' }));

    expect(createPartner).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Gamma',
        relationship_type: 'partner',
        partner_key: 'gamma-slug',
        legal_name: 'Gamma Learning Limited',
      })
    );
  });

  it('toolbar filters call setFilter', async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    const partners = buildPartnersHook({ setFilter });

    render(<PartnersPanel partners={partners} {...panelShell} />);

    const search = screen.getByLabelText('Search');
    await user.type(search, 'x');
    expect(setFilter).toHaveBeenCalled();
  });

  it('sorts table rows by name A→Z (case- and accent-insensitive) over the loaded set', () => {
    const baseRow = {
      organization_type: 'company' as const,
      relationship_type: 'partner' as const,
      partner_key: null,
      legal_name: null,
      website: null,
      location_id: null,
      location_summary: null,
      tag_ids: [] as string[],
      tags: [],
      members: [],
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      has_sales_conversation: false,
      sales_conversation_channel: null,
      has_service_instance: false,
      has_invoice: false,
    };
    const rows: components['schemas']['AdminOrganization'][] = [
      { id: 'b', name: 'Beta Co', ...baseRow },
      { id: 'a', name: 'alpha llc', ...baseRow },
      { id: 'g', name: 'Gamma Org', ...baseRow },
    ];
    const partners = buildPartnersHook({ partners: rows });

    render(<PartnersPanel partners={partners} {...panelShell} />);

    const expandButtons = screen.getAllByRole('button', { name: /^Expand / });
    expect(expandButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Expand alpha llc',
      'Expand Beta Co',
      'Expand Gamma Org',
    ]);
  });

  it('edits partner and updates with relationship_type partner', async () => {
    const user = userEvent.setup();
    const updatePartner = vi.fn().mockResolvedValue(null);
    const row: components['schemas']['AdminOrganization'] = {
      id: 'p-row',
      name: 'Row Partner',
      organization_type: 'school',
      relationship_type: 'partner',
      partner_key: 'row-slug',
      legal_name: 'Row Partner Legal Ltd',
      website: 'https://example.com',
      location_id: null,
      location_summary: null,
      tag_ids: [],
      tags: [],
      members: [],
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      has_sales_conversation: false,
      sales_conversation_channel: null,
      has_service_instance: false,
      has_invoice: false,
    };
    const partners = buildPartnersHook({
      partners: [row],
      updatePartner,
    });

    render(<PartnersPanel partners={partners} {...panelShell} />);

    await user.click(screen.getByRole('button', { name: 'Expand Row Partner' }));
    expect(await screen.findByLabelText('Legal name')).toHaveValue('Row Partner Legal Ltd');
    expect(screen.getByLabelText('Status', { selector: '#svc-partner-active' })).toHaveValue('true');
    await user.clear(screen.getByLabelText(/^Name/));
    await user.type(screen.getByLabelText(/^Name/), 'Row Partner Renamed');
    await user.clear(screen.getByLabelText('Legal name'));
    await user.type(screen.getByLabelText('Legal name'), 'Row Partner Legal Renamed');
    await user.click(screen.getByRole('button', { name: 'Update partner' }));

    expect(updatePartner).toHaveBeenCalledWith(
      'p-row',
      expect.objectContaining({
        name: 'Row Partner Renamed',
        relationship_type: 'partner',
        partner_key: 'row-slug',
        legal_name: 'Row Partner Legal Renamed',
      })
    );
  });

  it('partner owning locked venue can Change and save via Update partner', async () => {
    const user = userEvent.setup();
    const updatePartner = vi.fn().mockResolvedValue(null);

    const locId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const partnerId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const row: components['schemas']['AdminOrganization'] = {
      id: partnerId,
      name: 'Venue Owner',
      organization_type: 'company',
      relationship_type: 'partner',
      partner_key: null,
      legal_name: null,
      website: null,
      location_id: locId,
      location_summary: null,
      tag_ids: [],
      tags: [],
      members: [],
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      has_sales_conversation: false,
      sales_conversation_channel: null,
      has_service_instance: false,
      has_invoice: false,
    };
    const partners = buildPartnersHook({ partners: [row], updatePartner });
    const locations = [
      {
        id: locId,
        name: 'Ignored name',
        areaId: 'area-1',
        address: '1 Test St',
        lat: null,
        lng: null,
        createdAt: null,
        updatedAt: null,
        lockedFromPartnerOrg: true,
        partnerOrganizationLabels: ['Venue Owner'],
        partnerOrganizationIds: [partnerId],
      },
    ];
    const areas = [
      {
        id: 'area-1',
        parentId: null,
        name: 'Hong Kong',
        level: 'country' as const,
        code: 'HK',
        sovereignCountryId: null,
        active: true,
        displayOrder: 0,
      },
    ];

    render(
      <PartnersPanel
        partners={partners}
        {...panelShell}
        locations={locations}
        geographicAreas={areas}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Expand Venue Owner' }));
    await user.click(await screen.findByRole('button', { name: /^Location/ }));
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.clear(screen.getByLabelText('Address'));
    await user.type(screen.getByLabelText('Address'), '2 Test St');
    await user.click(screen.getByRole('button', { name: 'Update partner' }));

    await waitFor(() => {
      expect(updateLocationPartial).toHaveBeenCalledWith(
        locId,
        expect.objectContaining({ address: '2 Test St' })
      );
    });
    expect(updatePartner).toHaveBeenCalledWith(
      partnerId,
      expect.objectContaining({
        location_id: locId,
      })
    );
  });

  it('deletes partner after confirmation from table', async () => {
    const user = userEvent.setup();
    const deletePartner = vi.fn().mockResolvedValue(undefined);
    const row: components['schemas']['AdminOrganization'] = {
      id: 'p-del',
      name: 'Del Partner',
      organization_type: 'company',
      relationship_type: 'partner',
      partner_key: 'del',
      legal_name: null,
      website: null,
      location_id: null,
      location_summary: null,
      tag_ids: [],
      tags: [],
      members: [],
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      has_sales_conversation: false,
      sales_conversation_channel: null,
      has_service_instance: false,
      has_invoice: false,
    };
    const partners = buildPartnersHook({
      deletePartner,
      partners: [row],
    });

    render(<PartnersPanel partners={partners} {...panelShell} />);

    const table = screen.getByRole('table');
    await user.click(within(table).getByRole('button', { name: 'Delete partner' }));

    await waitFor(() => {
      expect(deletePartner).toHaveBeenCalledWith('p-del');
    });
  });
});
