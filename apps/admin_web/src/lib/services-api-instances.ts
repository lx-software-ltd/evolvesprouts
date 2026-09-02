import { buildAdminListPath } from '@/lib/admin-list-query';

import { adminApiRequest } from './api-admin-client';
import { asNullableString, asNumber } from './api-payload';
import { parseInstance } from './services-api-parse';

import type { components } from '@/types/generated/admin-api.generated';
import type { ServiceInstance } from '@/types/services';

type ApiSchemas = components['schemas'];
type ApiCreateInstanceRequest = ApiSchemas['CreateInstanceRequest'];
type ApiUpdateInstanceRequest = ApiSchemas['UpdateInstanceRequest'];
type ApiInstanceListResponse = ApiSchemas['InstanceListResponse'];
type ApiInstanceResponse = ApiSchemas['InstanceResponse'];

export async function listInstances(
  serviceId: string,
  params: { status?: string; cursor?: string | null; limit?: number },
  signal?: AbortSignal
): Promise<{ items: ServiceInstance[]; nextCursor: string | null; totalCount: number }> {
  const payload = await adminApiRequest<ApiInstanceListResponse>({
    endpointPath: buildAdminListPath(`/v1/admin/services/${serviceId}/instances`, {
      filters: { status: params.status },
      cursor: params.cursor,
      limit: params.limit,
    }),
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items.map((entry) => parseInstance(entry)) : [],
    nextCursor: asNullableString(payload.next_cursor),
    totalCount: asNumber(payload.total_count, 0),
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
    endpointPath: buildAdminListPath('/v1/admin/services/instances', {
      filters: {
        status: params.status,
        service_id: params.serviceId,
        service_type: params.serviceType,
        contact_id: params.contactId,
        family_id: params.familyId,
        organization_id: params.organizationId,
      },
      cursor: params.cursor,
      limit: params.limit,
    }),
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items.map((entry) => parseInstance(entry)) : [],
    nextCursor: asNullableString(payload.next_cursor),
    totalCount: asNumber(payload.total_count, 0),
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
  return payload.instance ? parseInstance(payload.instance) : null;
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
  return payload.instance ? parseInstance(payload.instance) : null;
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
  return payload.instance ? parseInstance(payload.instance) : null;
}

export async function deleteInstance(serviceId: string, instanceId: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 204],
  });
}
