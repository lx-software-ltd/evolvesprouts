import { adminApiRequest } from './api-admin-client';
import { buildAdminListPath } from './admin-list-query';
import { isRecord } from './type-guards';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export type AdminTagRow = ApiSchemas['AdminTagRef'];

export type AdminTagListFilter = 'active' | 'archived' | 'all';

export type AdminTagDeleteOutcome = ApiSchemas['AdminTagDeleteResponse'];

function parseAdminTag(value: unknown): AdminTagRow {
  const row = isRecord(value) ? value : {};
  return row as AdminTagRow;
}

export async function listAdminTags(
  params?: { filter?: AdminTagListFilter },
  signal?: AbortSignal
): Promise<AdminTagRow[]> {
  const filter = params?.filter ?? 'active';
  const payload = await adminApiRequest<ApiSchemas['AdminTagListResponse']>({
    endpointPath: buildAdminListPath('/v1/admin/tags', {
      filters: { include_archived: filter === 'all', archived_only: filter === 'archived' },
    }),
    method: 'GET',
    signal,
  });
  return Array.isArray(payload.items) ? payload.items.map((t) => parseAdminTag(t)) : [];
}

export async function createAdminTag(
  body: ApiSchemas['CreateAdminTagRequest']
): Promise<AdminTagRow | null> {
  const payload = await adminApiRequest<ApiSchemas['AdminTagResponse']>({
    endpointPath: '/v1/admin/tags',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.tag ? parseAdminTag(payload.tag) : null;
}

export async function updateAdminTag(
  tagId: string,
  body: ApiSchemas['UpdateAdminTagRequest']
): Promise<AdminTagRow | null> {
  const payload = await adminApiRequest<ApiSchemas['AdminTagResponse']>({
    endpointPath: `/v1/admin/tags/${tagId}`,
    method: 'PATCH',
    body,
  });
  return payload.tag ? parseAdminTag(payload.tag) : null;
}

export async function deleteOrArchiveAdminTag(tagId: string): Promise<AdminTagDeleteOutcome> {
  const payload = await adminApiRequest<ApiSchemas['AdminTagDeleteResponse']>({
    endpointPath: `/v1/admin/tags/${tagId}`,
    method: 'DELETE',
  });
  if (!isRecord(payload)) {
    return { deleted: true, usage_count: 0 };
  }
  return {
    deleted: Boolean(payload.deleted),
    usage_count: typeof payload.usage_count === 'number' ? payload.usage_count : 0,
    tag: payload.tag ? parseAdminTag(payload.tag) : undefined,
  };
}
