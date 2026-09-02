import { buildAdminListPath } from '@/lib/admin-list-query';

import { adminApiRequest } from './api-admin-client';
import { asNullableString, asNumber } from './api-payload';
import { parseDiscountCode } from './services-api-parse';

import type { components } from '@/types/generated/admin-api.generated';
import type { DiscountCode, DiscountCodeFilters } from '@/types/services';

type ApiSchemas = components['schemas'];
type ApiDiscountCodeListResponse = ApiSchemas['DiscountCodeListResponse'];
type ApiDiscountCodeResponse = ApiSchemas['DiscountCodeResponse'];
type ApiCreateDiscountCodeRequest = ApiSchemas['CreateDiscountCodeRequest'];
type ApiUpdateDiscountCodeRequest = ApiSchemas['UpdateDiscountCodeRequest'];

export async function listDiscountCodes(
  params: Partial<DiscountCodeFilters> & {
    cursor?: string | null;
    limit?: number;
    service_id?: string;
    instance_id?: string;
  },
  signal?: AbortSignal
): Promise<{ items: DiscountCode[]; nextCursor: string | null; totalCount: number }> {
  const payload = await adminApiRequest<ApiDiscountCodeListResponse>({
    endpointPath: buildAdminListPath('/v1/admin/discount-codes', {
      filters: {
        active: params.active,
        search: params.search,
        scope: params.scope,
        service_id: params.service_id,
        instance_id: params.instance_id,
      },
      cursor: params.cursor,
      limit: params.limit,
    }),
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items.map((entry) => parseDiscountCode(entry)) : [],
    nextCursor: asNullableString(payload.next_cursor),
    totalCount: asNumber(payload.total_count, 0),
  };
}

export async function createDiscountCode(
  body: ApiCreateDiscountCodeRequest
): Promise<DiscountCode | null> {
  const payload = await adminApiRequest<ApiDiscountCodeResponse>({
    endpointPath: '/v1/admin/discount-codes',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.discount_code ? parseDiscountCode(payload.discount_code) : null;
}

export async function updateDiscountCode(
  codeId: string,
  body: ApiUpdateDiscountCodeRequest
): Promise<DiscountCode | null> {
  const payload = await adminApiRequest<ApiDiscountCodeResponse>({
    endpointPath: `/v1/admin/discount-codes/${codeId}`,
    method: 'PUT',
    body,
  });
  return payload.discount_code ? parseDiscountCode(payload.discount_code) : null;
}

export async function deleteDiscountCode(codeId: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/discount-codes/${codeId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 204],
  });
}
