import { adminApiRequest } from './api-admin-client';
import { unwrapPayload } from './api-payload';
import { isRecord } from './type-guards';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export type AdminApiKeySummary = ApiSchemas['ApiKeySummary'];
export type AdminApiKeyCreated = ApiSchemas['ApiKeyCreatedResponse'];
export type CreateAdminApiKeyRequest = ApiSchemas['CreateApiKeyRequest'];

export async function listAdminApiKeys(signal?: AbortSignal): Promise<AdminApiKeySummary[]> {
  const payload = await adminApiRequest<ApiSchemas['ApiKeyListResponse']>({
    endpointPath: '/v1/admin/api-keys',
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return Array.isArray(root.items) ? root.items : [];
}

export async function createAdminApiKey(
  body: CreateAdminApiKeyRequest
): Promise<AdminApiKeyCreated> {
  const payload = await adminApiRequest<AdminApiKeyCreated>({
    endpointPath: '/v1/admin/api-keys',
    method: 'POST',
    body,
    expectedSuccessStatuses: [201],
  });
  return unwrapPayload(payload);
}

export async function revokeAdminApiKey(id: string): Promise<AdminApiKeySummary> {
  const payload = await adminApiRequest<AdminApiKeySummary>({
    endpointPath: `/v1/admin/api-keys/${encodeURIComponent(id)}`,
    method: 'DELETE',
  });
  return unwrapPayload(payload);
}
