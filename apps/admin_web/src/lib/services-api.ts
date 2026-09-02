import { buildAdminListPath } from '@/lib/admin-list-query';

import { adminApiRequest, isAbortRequestError } from './api-admin-client';
import { asNullableString, asNumber } from './api-payload';
import { isRecord } from './type-guards';
import { parseServiceDetail, parseServiceSummary } from './services-api-parse';

export { isAbortRequestError };
export { parseInstance } from './services-api-parse';
export {
  createLocation,
  deleteLocation,
  geocodeVenueAddress,
  listAllLocations,
  listAllVenueAndPartnerLocations,
  listGeographicAreas,
  listLocations,
  updateLocation,
  updateLocationPartial,
} from './services-api-venues';
export type { GeocodeLocationResult } from './services-api-venues';
export {
  createInstance,
  deleteInstance,
  getInstance,
  listAllInstances,
  listInstances,
  updateInstance,
} from './services-api-instances';
export {
  createEnrollment,
  deleteEnrollment,
  listEnrollmentDiscountOptions,
  listEnrollments,
  updateEnrollment,
} from './services-api-enrollments';
export {
  createDiscountCode,
  deleteDiscountCode,
  listDiscountCodes,
  updateDiscountCode,
} from './services-api-discounts';

import type { components } from '@/types/generated/admin-api.generated';
import type {
  ServiceDetail,
  ServiceListFilters,
  ServiceSummary,
} from '@/types/services';

type ApiSchemas = components['schemas'];
type ApiServiceListResponse = ApiSchemas['ServiceListResponse'];
type ApiServiceResponse = ApiSchemas['ServiceResponse'];
type ApiServiceCoverImageUploadResponse = ApiSchemas['ServiceCoverImageUploadResponse'];
type ApiCreateServiceRequest = ApiSchemas['CreateServiceRequest'];
type ApiUpdateServiceRequest = ApiSchemas['UpdateServiceRequest'];
type ApiPartialUpdateServiceRequest = ApiSchemas['PartialUpdateServiceRequest'];
type ApiCreateCoverImageUploadRequest = ApiSchemas['CreateServiceCoverImageUploadRequest'];
type ApiDiscountCodeUsageSummaryResponse = ApiSchemas['DiscountCodeUsageSummaryResponse'];

export async function listServices(
  params: Partial<ServiceListFilters> & { cursor?: string | null; limit?: number },
  signal?: AbortSignal
): Promise<{ items: ServiceSummary[]; nextCursor: string | null; totalCount: number }> {
  const payload = await adminApiRequest<ApiServiceListResponse>({
    endpointPath: buildAdminListPath('/v1/admin/services', {
      filters: { service_type: params.serviceType, status: params.status, search: params.search },
      cursor: params.cursor,
      limit: params.limit,
    }),
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items.map((entry) => parseServiceSummary(entry)) : [],
    nextCursor: asNullableString(payload.next_cursor),
    totalCount: asNumber(payload.total_count, 0),
  };
}

export interface ServiceDiscountCodeUsageSummary {
  totalCurrentUses: number;
  referencingCodeCount: number;
}

function parseDiscountCodeUsageSummary(value: unknown): ServiceDiscountCodeUsageSummary | null {
  const item = isRecord(value) ? value : {};
  return {
    totalCurrentUses: asNumber(item.total_current_uses, 0),
    referencingCodeCount: asNumber(item.referencing_code_count, 0),
  };
}

export interface DiscountCodeUsageSummaryResult {
  summary: ServiceDiscountCodeUsageSummary | null;
  error: Error | null;
}

export async function getServiceDiscountCodeUsageSummary(
  serviceId: string,
  signal?: AbortSignal,
): Promise<DiscountCodeUsageSummaryResult> {
  try {
    const payload = await adminApiRequest<ApiDiscountCodeUsageSummaryResponse>({
      endpointPath: `/v1/admin/services/${serviceId}/discount-code-usage-summary`,
      method: 'GET',
      signal,
    });
    return { summary: parseDiscountCodeUsageSummary(payload), error: null };
  } catch (caught) {
    if (isAbortRequestError(caught)) {
      throw caught;
    }
    const error = caught instanceof Error ? caught : new Error(String(caught));
    return { summary: null, error };
  }
}

export async function getService(id: string, signal?: AbortSignal): Promise<ServiceDetail | null> {
  const payload = await adminApiRequest<ApiServiceResponse>({
    endpointPath: `/v1/admin/services/${id}`,
    method: 'GET',
    signal,
  });
  return payload.service ? parseServiceDetail(payload.service) : null;
}

export async function createService(body: ApiCreateServiceRequest): Promise<ServiceDetail | null> {
  const payload = await adminApiRequest<ApiServiceResponse>({
    endpointPath: '/v1/admin/services',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.service ? parseServiceDetail(payload.service) : null;
}

export async function updateService(
  id: string,
  body: ApiUpdateServiceRequest | ApiPartialUpdateServiceRequest,
  partial = false
): Promise<ServiceDetail | null> {
  const payload = await adminApiRequest<ApiServiceResponse>({
    endpointPath: `/v1/admin/services/${id}`,
    method: partial ? 'PATCH' : 'PUT',
    body,
  });
  return payload.service ? parseServiceDetail(payload.service) : null;
}

export async function deleteService(id: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/services/${id}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 204],
  });
}

export async function createServiceCoverImageUpload(
  serviceId: string,
  body: ApiCreateCoverImageUploadRequest
): Promise<{
  uploadUrl: string | null;
  uploadMethod: string;
  uploadHeaders: Record<string, string>;
  s3Key: string | null;
  expiresAt: string | null;
  service: { id: string | null; coverImageS3Key: string | null };
}> {
  const payload = await adminApiRequest<ApiServiceCoverImageUploadResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/cover-image`,
    method: 'POST',
    body,
  });
  const service = isRecord(payload.service) ? payload.service : {};
  return {
    uploadUrl: asNullableString(payload.upload_url),
    uploadMethod: asNullableString(payload.upload_method) ?? 'PUT',
    uploadHeaders: isRecord(payload.upload_headers)
      ? Object.fromEntries(
          Object.entries(payload.upload_headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        )
      : {},
    s3Key: asNullableString(payload.s3_key),
    expiresAt: asNullableString(payload.expires_at),
    service: {
      id: asNullableString(service.id),
      coverImageS3Key: asNullableString(service.cover_image_s3_key),
    },
  };
}
