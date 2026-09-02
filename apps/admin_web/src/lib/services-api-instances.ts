import { clampAdminListLimit } from '@/lib/admin-list-limit';

import { adminApiRequest } from './api-admin-client';
import { asNullableString, asNumber, unwrapPayload } from './api-payload';
import { parseInstance } from './services-api-parse';

import type { components } from '@/types/generated/admin-api.generated';
import type { ServiceInstance } from '@/types/services';

type ApiSchemas = components['schemas'];
type ApiCreateInstanceRequest = ApiSchemas['CreateInstanceRequest'];
type ApiUpdateInstanceRequest = ApiSchemas['UpdateInstanceRequest'];
type ApiInstanceListResponse = ApiSchemas['InstanceListResponse'];
type ApiInstanceResponse = ApiSchemas['InstanceResponse'];

function buildInstanceListQuery(params: { status?: string; cursor?: string | null; limit?: number }) {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.status) query.set('status', params.status);
  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function buildGlobalInstanceListQuery(params: {
  status?: string;
  cursor?: string | null;
  limit?: number;
  serviceId?: string | null;
  serviceType?: string | null;
  contactId?: string | null;
  familyId?: string | null;
  organizationId?: string | null;
}) {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.status) query.set('status', params.status);
  if (params.serviceId?.trim()) query.set('service_id', params.serviceId.trim());
  if (params.serviceType?.trim()) query.set('service_type', params.serviceType.trim());
  if (params.contactId?.trim()) query.set('contact_id', params.contactId.trim());
  if (params.familyId?.trim()) query.set('family_id', params.familyId.trim());
  if (params.organizationId?.trim()) query.set('organization_id', params.organizationId.trim());
  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

export async function listInstances(
  serviceId: string,
  params: { status?: string; cursor?: string | null; limit?: number },
  signal?: AbortSignal
): Promise<{ items: ServiceInstance[]; nextCursor: string | null; totalCount: number }> {
  const payload = await adminApiRequest<ApiInstanceListResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances${buildInstanceListQuery(params)}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return {
    items: Array.isArray(root.items) ? root.items.map((entry) => parseInstance(entry)) : [],
    nextCursor: asNullableString(root.next_cursor),
    totalCount: asNumber(root.total_count, 0),
  };
}

export async function listAllInstances(
  params: {
    status?: string;
    cursor?: string | null;
    limit?: number;
    serviceId?: string | null;
    serviceType?: string | null;
    contactId?: string | null;
    familyId?: string | null;
    organizationId?: string | null;
  },
  signal?: AbortSignal
): Promise<{ items: ServiceInstance[]; nextCursor: string | null; totalCount: number }> {
  const payload = await adminApiRequest<ApiInstanceListResponse>({
    endpointPath: `/v1/admin/services/instances${buildGlobalInstanceListQuery(params)}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return {
    items: Array.isArray(root.items) ? root.items.map((entry) => parseInstance(entry)) : [],
    nextCursor: asNullableString(root.next_cursor),
    totalCount: asNumber(root.total_count, 0),
  };
}

export async function getInstance(
  serviceId: string,
  instanceId: string,
  signal?: AbortSignal
): Promise<ServiceInstance | null> {
  const payload = await adminApiRequest<ApiInstanceResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return root.instance ? parseInstance(root.instance) : null;
}

export async function createInstance(
  serviceId: string,
  body: ApiCreateInstanceRequest
): Promise<ServiceInstance | null> {
  const payload = await adminApiRequest<ApiInstanceResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances`,
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  const root = unwrapPayload(payload);
  return root.instance ? parseInstance(root.instance) : null;
}

export async function updateInstance(
  serviceId: string,
  instanceId: string,
  body: ApiUpdateInstanceRequest
): Promise<ServiceInstance | null> {
  const payload = await adminApiRequest<ApiInstanceResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}`,
    method: 'PUT',
    body,
  });
  const root = unwrapPayload(payload);
  return root.instance ? parseInstance(root.instance) : null;
}

export async function deleteInstance(serviceId: string, instanceId: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 204],
  });
}
