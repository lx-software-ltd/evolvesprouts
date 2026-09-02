import { clampAdminListLimit } from '@/lib/admin-list-limit';

import { adminApiRequest } from './api-admin-client';
import { asNullableString, asNumber } from './api-payload';
import { parseEnrollment } from './services-api-parse';
import { listDiscountCodes } from './services-api-discounts';

import type { components } from '@/types/generated/admin-api.generated';
import type {
  DiscountCode,
  Enrollment,
  EnrollmentListFilters,
} from '@/types/services';

type ApiSchemas = components['schemas'];
type ApiEnrollmentListResponse = ApiSchemas['EnrollmentListResponse'];
type ApiEnrollmentResponse = ApiSchemas['EnrollmentResponse'];
type ApiCreateEnrollmentRequest = ApiSchemas['CreateEnrollmentRequest'];
type ApiUpdateEnrollmentRequest = ApiSchemas['UpdateEnrollmentRequest'];

export async function listEnrollments(
  serviceId: string,
  instanceId: string,
  params: Partial<EnrollmentListFilters> & { cursor?: string | null; limit?: number },
  signal?: AbortSignal
): Promise<{ items: Enrollment[]; nextCursor: string | null; totalCount: number }> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.status) query.set('status', params.status);
  const queryString = query.toString();
  const payload = await adminApiRequest<ApiEnrollmentListResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}/enrollments${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items.map((entry) => parseEnrollment(entry)) : [],
    nextCursor: asNullableString(payload.next_cursor),
    totalCount: asNumber(payload.total_count, 0),
  };
}

export async function createEnrollment(
  serviceId: string,
  instanceId: string,
  body: ApiCreateEnrollmentRequest
): Promise<Enrollment | null> {
  const payload = await adminApiRequest<ApiEnrollmentResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}/enrollments`,
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.enrollment ? parseEnrollment(payload.enrollment) : null;
}

export async function updateEnrollment(
  serviceId: string,
  instanceId: string,
  enrollmentId: string,
  body: ApiUpdateEnrollmentRequest
): Promise<Enrollment | null> {
  const payload = await adminApiRequest<ApiEnrollmentResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}/enrollments/${enrollmentId}`,
    method: 'PATCH',
    body,
  });
  return payload.enrollment ? parseEnrollment(payload.enrollment) : null;
}

export async function deleteEnrollment(
  serviceId: string,
  instanceId: string,
  enrollmentId: string
): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}/enrollments/${enrollmentId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 204],
  });
}

const ENROLLMENT_DISCOUNT_OPTIONS_PAGE_LIMIT = 200;

/**
 * Discount codes applicable when creating/editing an enrollment for one instance:
 * global (unscoped), service-scoped for `serviceId`, and instance-scoped for `instanceId`.
 */
export async function listEnrollmentDiscountOptions(
  serviceId: string,
  instanceId: string,
  signal?: AbortSignal
): Promise<DiscountCode[]> {
  const base = { active: 'true' as const, limit: ENROLLMENT_DISCOUNT_OPTIONS_PAGE_LIMIT };
  const [unscoped, forService, forInstance] = await Promise.all([
    listDiscountCodes({ ...base, scope: 'unscoped' }, signal),
    listDiscountCodes({ ...base, scope: 'service', service_id: serviceId }, signal),
    listDiscountCodes({ ...base, scope: 'instance', instance_id: instanceId }, signal),
  ]);
  const byId = new Map<string, DiscountCode>();
  for (const row of [...unscoped.items, ...forService.items, ...forInstance.items]) {
    if (row.id) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { sensitivity: 'base' })
  );
}
