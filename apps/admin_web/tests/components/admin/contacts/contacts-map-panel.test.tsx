import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactsMapPanel } from '@/components/admin/contacts/contacts-map-panel';
import { resetAdminQueryClientForTests } from '@/lib/admin-query-client';

const listAdminContactMapPins = vi.fn();
const getGoogleMapsApiKey = vi.fn();
const loadGoogleMaps = vi.fn();

vi.mock('@/lib/entity-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/entity-api')>();
  return {
    ...actual,
    listAdminContactMapPins: (...args: unknown[]) => listAdminContactMapPins(...args),
  };
});

vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>();
  return {
    ...actual,
    getGoogleMapsApiKey: () => getGoogleMapsApiKey(),
  };
});

vi.mock('@/lib/google-maps-loader', () => ({
  loadGoogleMaps: (...args: unknown[]) => loadGoogleMaps(...args),
}));

type MarkerClick = () => void;

function installFakeGoogleMaps() {
  const markerClicks: MarkerClick[] = [];
  class FakeMap {
    addListener(event: string, handler: () => void) {
      void event;
      void handler;
    }
  }
  class FakeMarker {
    constructor(opts: { title?: string }) {
      void opts;
    }
    addListener(event: string, handler: () => void) {
      if (event === 'click') {
        markerClicks.push(handler);
      }
    }
    setMap() {
      return undefined;
    }
  }
  const mapsApi = { Map: FakeMap, Marker: FakeMarker };
  loadGoogleMaps.mockImplementation(async () => {
    Object.defineProperty(window, 'google', {
      configurable: true,
      writable: true,
      value: { maps: mapsApi },
    });
    return mapsApi;
  });
  return {
    markerCount() {
      return markerClicks.length;
    },
    clickFirstMarker() {
      markerClicks[0]?.();
    },
  };
}

describe('ContactsMapPanel', () => {
  beforeEach(() => {
    resetAdminQueryClientForTests();
    listAdminContactMapPins.mockReset();
    getGoogleMapsApiKey.mockReset();
    loadGoogleMaps.mockReset();
  });

  afterEach(() => {
    resetAdminQueryClientForTests();
  });

  it('shows a configuration message and does not fetch pins when the Maps key is missing', async () => {
    getGoogleMapsApiKey.mockReturnValue('');

    render(<ContactsMapPanel />);

    expect(screen.getByTestId('contacts-map-panel')).toBeInTheDocument();
    expect(screen.getByText('Google Maps is not configured')).toBeInTheDocument();
    expect(
      screen.getByText(/Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY/i)
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(listAdminContactMapPins).not.toHaveBeenCalled();
    });
    expect(loadGoogleMaps).not.toHaveBeenCalled();
  });

  it('loads pins and opens details when a marker is clicked', async () => {
    const user = userEvent.setup();
    getGoogleMapsApiKey.mockReturnValue('test-maps-key');
    const maps = installFakeGoogleMaps();
    listAdminContactMapPins.mockResolvedValue([
      {
        entity_type: 'family',
        id: '11111111-1111-1111-1111-111111111111',
        label: 'Chan family',
        address: '12 Queen Street',
        area_name: 'Central',
        lat: 22.2819,
        lng: 114.1582,
        member_labels: ['Ada Chan'],
        primary_contact_label: 'Ada Chan',
      },
    ]);

    render(<ContactsMapPanel />);

    await waitFor(() => {
      expect(listAdminContactMapPins).toHaveBeenCalled();
    });
    expect(screen.getByRole('application', { name: 'Hong Kong map of confirmed addresses' })).toBeInTheDocument();
    expect(
      screen.getByText('Click a red pin to see the family, contact, or organisation at that address.')
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(loadGoogleMaps).toHaveBeenCalledWith('test-maps-key');
    });
    await waitFor(() => {
      expect(maps.markerCount()).toBe(1);
    });

    maps.clickFirstMarker();
    expect(await screen.findByTestId('contacts-map-pin-details')).toBeInTheDocument();
    expect(screen.getByText('Family')).toBeInTheDocument();
    const familyName = screen.getByText('Chan family');
    expect(familyName).toBeInTheDocument();
    expect(familyName).toHaveClass('font-semibold');
    expect(familyName.parentElement).toHaveTextContent('Chan family · Ada Chan');
    expect(screen.getByText('12 Queen Street · Central')).toBeInTheDocument();
    expect(screen.getByText('Members: Ada Chan')).toBeInTheDocument();
    const openLink = screen.getByRole('link', { name: 'Open' });
    expect(openLink).toHaveAttribute(
      'href',
      '/contacts?tab=families&family=11111111-1111-1111-1111-111111111111'
    );
    await user.click(openLink);
  });
});
