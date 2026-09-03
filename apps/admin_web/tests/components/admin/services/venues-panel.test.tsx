import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { geocodeVenueAddress } = vi.hoisted(() => ({
  geocodeVenueAddress: vi.fn(),
}));

vi.mock('@/lib/services-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services-api')>('@/lib/services-api');
  return {
    ...actual,
    geocodeVenueAddress,
    listAllLocations: vi.fn().mockResolvedValue([]),
  };
});

import { VenuesPanel } from '@/components/admin/services/venues-panel';

describe('VenuesPanel', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/services');
  });

  it('fills latitude and longitude when geocoding succeeds', async () => {
    const user = userEvent.setup();
    geocodeVenueAddress.mockResolvedValueOnce({
      lat: 22.3193,
      lng: 114.1694,
      displayName: 'Example, Hong Kong',
    });

    render(
      <VenuesPanel
        venues={[]}
        geographicAreas={[
          {
            id: 'area-1',
            parentId: null,
            name: 'Hong Kong',
            level: 'country',
            code: 'HK',
            sovereignCountryId: null,
            active: true,
            displayOrder: 0,
          },
        ]}
        areasLoading={false}
        filters={{ areaId: '', search: '' }}
        isLoading={false}
        isLoadingMore={false}
        isSaving={false}
        hasMore={false}
        error=''
        onFilterChange={vi.fn()}
        onLoadMore={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUpdatePartial={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'New venue' }));
    await user.selectOptions(await screen.findByLabelText(/^Geographic area/), 'area-1');
    await user.type(screen.getByLabelText('Address'), '1 Test Road');

    await user.click(screen.getByRole('button', { name: 'Fill coordinates from address' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Latitude')).toHaveValue('22.3193');
      expect(screen.getByLabelText('Longitude')).toHaveValue('114.1694');
    });
    expect(geocodeVenueAddress).toHaveBeenCalledWith({
      area_id: 'area-1',
      address: '1 Test Road',
    });
  });

  it('lists name, address, area, and operations columns without partner organisations, coordinates, or updated', () => {
    render(
      <VenuesPanel
        venues={[
          {
            id: 'loc-1',
            name: 'Studio A',
            address: '1 Main St',
            areaId: 'area-1',
            lat: 1,
            lng: 2,
            createdAt: null,
            updatedAt: '2025-01-01T00:00:00Z',
            lockedFromPartnerOrg: false,
            partnerOrganizationLabels: [],
            partnerOrganizationIds: [],
          },
        ]}
        geographicAreas={[
          {
            id: 'area-1',
            parentId: null,
            name: 'Hong Kong',
            level: 'country',
            code: 'HK',
            sovereignCountryId: null,
            active: true,
            displayOrder: 0,
          },
        ]}
        areasLoading={false}
        filters={{ areaId: '', search: '' }}
        isLoading={false}
        isLoadingMore={false}
        isSaving={false}
        hasMore={false}
        error=''
        onFilterChange={vi.fn()}
        onLoadMore={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUpdatePartial={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole('region', { name: 'Venues' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New venue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete venue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand studio a/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Address' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Partner organisations' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Area' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Operations' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Coordinates' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Updated' })).not.toBeInTheDocument();
  });
});
