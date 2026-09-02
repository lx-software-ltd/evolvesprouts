import { ADMIN_API_MAX_LIST_LIMIT, buildAdminListPath } from '@/lib/admin-list-query';

import { adminApiRequest } from './api-admin-client';
import { asNullableString, asNumber } from './api-payload';
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
  const payload = await adminApiRequest<ApiGeographicAreaListResponse>({
    endpointPath: buildAdminListPath('/v1/admin/geographic-areas', {
      filters: { flat: params.flat, active_only: params.activeOnly === false ? 'false' : undefined },
    }),
    method: 'GET',
    signal,
  });
  return Array.isArray(payload.items) ? payload.items.map((entry) => parseGeographicAreaSummary(entry)) : [];
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
  const payload = await adminApiRequest<ApiLocationListResponse>({
    endpointPath: buildAdminListPath('/v1/admin/locations', {
      filters: { area_id: params.areaId, search: params.search, exclude_addresses: params.excludeAddresses },
      cursor: params.cursor,
      limit: params.limit,
    }),
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items.map((entry) => parseLocationSummary(entry)) : [],
    nextCursor: asNullableString(payload.next_cursor),
    totalCount: asNumber(payload.total_count, 0),
  };
}

export async function listAllLocations(signal?: AbortSignal): Promise<LocationSummary[]> {
  const all: LocationSummary[] = [];
  let cursor: string | null = null;
  do {
    const page = await listLocations(
      {
        cursor,
        limit: ADMIN_API_MAX_LIST_LIMIT,
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
        limit: ADMIN_API_MAX_LIST_LIMIT,
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
        limit: ADMIN_API_MAX_LIST_LIMIT,
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
  const lat = typeof payload.lat === 'number' ? payload.lat : NaN;
  const lng = typeof payload.lng === 'number' ? payload.lng : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Geocoding response was invalid.');
  }
  return {
    lat,
    lng,
    displayName: asNullableString(payload.display_name),
  };
}

export async function createLocation(body: ApiCreateLocationRequest): Promise<LocationSummary | null> {
  const payload = await adminApiRequest<ApiLocationResponse>({
    endpointPath: '/v1/admin/locations',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.location ? parseLocationSummary(payload.location) : null;
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
  return payload.location ? parseLocationSummary(payload.location) : null;
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
  return payload.location ? parseLocationSummary(payload.location) : null;
}

export async function deleteLocation(id: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/locations/${id}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 204],
  });
}
