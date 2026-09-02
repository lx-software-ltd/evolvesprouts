import { clampAdminListLimit } from '@/lib/admin-list-limit';

import { adminApiRequest } from './api-admin-client';
import { asNullableString, asNumber, unwrapPayload } from './api-payload';
import { parseGeographicAreaSummary, parseLocationSummary } from './services-api-parse';

import type { components } from '@/types/generated/admin-api.generated';
import type {
  GeographicAreaSummary,
  LocationSummary,
  VenueFilters,
} from '@/types/services';

type ApiSchemas = components['schemas'];
type ApiLocationListResponse = ApiSchemas['LocationListResponse'];
type ApiLocationResponse = ApiSchemas['LocationResponse'];
type ApiGeographicAreaListResponse = ApiSchemas['GeographicAreaListResponse'];
type ApiCreateLocationRequest = ApiSchemas['CreateLocationRequest'];
type ApiUpdateLocationRequest = ApiSchemas['UpdateLocationRequest'];
type ApiPartialUpdateLocationRequest = ApiSchemas['PartialUpdateLocationRequest'];
type ApiGeocodeLocationRequest = ApiSchemas['GeocodeLocationRequest'];
type ApiGeocodeLocationResponse = ApiSchemas['GeocodeLocationResponse'];

export async function listGeographicAreas(
  params: { flat?: boolean; activeOnly?: boolean } = {},
  signal?: AbortSignal
): Promise<GeographicAreaSummary[]> {
  const query = new URLSearchParams();
  if (params.flat) query.set('flat', 'true');
  if (params.activeOnly === false) query.set('active_only', 'false');
  const queryString = query.toString();
  const payload = await adminApiRequest<ApiGeographicAreaListResponse>({
    endpointPath: `/v1/admin/geographic-areas${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return Array.isArray(root.items) ? root.items.map((entry) => parseGeographicAreaSummary(entry)) : [];
}

export async function listLocations(
  params: Partial<VenueFilters> & {
    cursor?: string | null;
    limit?: number;
    /** When true, omit locations used as a non-archived family or organisation venue. */
    excludeAddresses?: boolean;
  },
  signal?: AbortSignal
): Promise<{ items: LocationSummary[]; nextCursor: string | null; totalCount: number }> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.areaId) query.set('area_id', params.areaId);
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.excludeAddresses) query.set('exclude_addresses', 'true');
  const queryString = query.toString();

  const payload = await adminApiRequest<ApiLocationListResponse>({
    endpointPath: `/v1/admin/locations${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return {
    items: Array.isArray(root.items) ? root.items.map((entry) => parseLocationSummary(entry)) : [],
    nextCursor: asNullableString(root.next_cursor),
    totalCount: asNumber(root.total_count, 0),
  };
}

export async function listAllLocations(signal?: AbortSignal): Promise<LocationSummary[]> {
  const all: LocationSummary[] = [];
  let cursor: string | null = null;
  do {
    const page = await listLocations(
      {
        cursor,
        limit: clampAdminListLimit(100),
      },
      signal
    );
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

/**
 * Locations suitable for service instances: standalone venues (not used as a
 * family or non-partner org address) plus any location linked to an active
 * partner organisation (those may be excluded from the venue-only query).
 */
export async function listAllVenueAndPartnerLocations(signal?: AbortSignal): Promise<LocationSummary[]> {
  const byId = new Map<string, LocationSummary>();

  let venueCursor: string | null = null;
  do {
    const page = await listLocations(
      {
        cursor: venueCursor,
        limit: clampAdminListLimit(100),
        excludeAddresses: true,
      },
      signal
    );
    for (const loc of page.items) {
      byId.set(loc.id, loc);
    }
    venueCursor = page.nextCursor;
  } while (venueCursor);

  let allCursor: string | null = null;
  do {
    const page = await listLocations(
      {
        cursor: allCursor,
        limit: clampAdminListLimit(100),
      },
      signal
    );
    for (const loc of page.items) {
      if (loc.partnerOrganizationLabels.length > 0) {
        byId.set(loc.id, loc);
      }
    }
    allCursor = page.nextCursor;
  } while (allCursor);

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface GeocodeLocationResult {
  lat: number;
  lng: number;
  displayName: string | null;
}

export async function geocodeVenueAddress(
  body: ApiGeocodeLocationRequest,
  signal?: AbortSignal
): Promise<GeocodeLocationResult> {
  const payload = await adminApiRequest<ApiGeocodeLocationResponse>({
    endpointPath: '/v1/admin/locations/geocode',
    method: 'POST',
    body,
    signal,
  });
  const root = unwrapPayload(payload);
  const lat = typeof root.lat === 'number' ? root.lat : NaN;
  const lng = typeof root.lng === 'number' ? root.lng : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Geocoding response was invalid.');
  }
  return {
    lat,
    lng,
    displayName: asNullableString(root.display_name),
  };
}

export async function createLocation(body: ApiCreateLocationRequest): Promise<LocationSummary | null> {
  const payload = await adminApiRequest<ApiLocationResponse>({
    endpointPath: '/v1/admin/locations',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  const root = unwrapPayload(payload);
  return root.location ? parseLocationSummary(root.location) : null;
}

export async function updateLocation(
  id: string,
  body: ApiUpdateLocationRequest
): Promise<LocationSummary | null> {
  const payload = await adminApiRequest<ApiLocationResponse>({
    endpointPath: `/v1/admin/locations/${id}`,
    method: 'PUT',
    body,
  });
  const root = unwrapPayload(payload);
  return root.location ? parseLocationSummary(root.location) : null;
}

export async function updateLocationPartial(
  id: string,
  body: ApiPartialUpdateLocationRequest
): Promise<LocationSummary | null> {
  const payload = await adminApiRequest<ApiLocationResponse>({
    endpointPath: `/v1/admin/locations/${id}`,
    method: 'PATCH',
    body,
  });
  const root = unwrapPayload(payload);
  return root.location ? parseLocationSummary(root.location) : null;
}

export async function deleteLocation(id: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/locations/${id}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 204],
  });
}
