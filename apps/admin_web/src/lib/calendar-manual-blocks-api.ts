import { adminApiRequest } from '@/lib/api-admin-client';
import { isRecord } from '@/lib/type-guards';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export type AdminCalendarManualBlockRow = ApiSchemas['AdminCalendarManualBlockRef'];

export const CONSULTATION_BOOKING_BLOCK_PURPOSE = 'consultation_booking';

function parseBlock(value: unknown): AdminCalendarManualBlockRow {
  return (isRecord(value) ? value : {}) as AdminCalendarManualBlockRow;
}

export async function listCalendarManualBlocks(
  params: { purpose: string; from: string; to: string },
  signal?: AbortSignal,
): Promise<AdminCalendarManualBlockRow[]> {
  const query = new URLSearchParams();
  query.set('purpose', params.purpose);
  query.set('from', params.from);
  query.set('to', params.to);
  const payload = await adminApiRequest<ApiSchemas['AdminCalendarManualBlockListResponse']>({
    endpointPath: `/v1/admin/calendar/manual-blocks?${query.toString()}`,
    method: 'GET',
    signal,
  });
  return Array.isArray(payload.items) ? payload.items.map((row) => parseBlock(row)) : [];
}

export async function createCalendarManualBlock(
  body: ApiSchemas['CreateAdminCalendarManualBlockRequest'],
): Promise<AdminCalendarManualBlockRow | null> {
  const payload = await adminApiRequest<ApiSchemas['AdminCalendarManualBlockResponse']>({
    endpointPath: '/v1/admin/calendar/manual-blocks',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.block ? parseBlock(payload.block) : null;
}

export async function updateCalendarManualBlock(
  id: string,
  body: ApiSchemas['UpdateAdminCalendarManualBlockRequest'],
): Promise<AdminCalendarManualBlockRow | null> {
  const payload = await adminApiRequest<ApiSchemas['AdminCalendarManualBlockResponse']>({
    endpointPath: `/v1/admin/calendar/manual-blocks/${id}`,
    method: 'PATCH',
    body,
  });
  return payload.block ? parseBlock(payload.block) : null;
}

export async function deleteCalendarManualBlock(id: string): Promise<boolean> {
  const payload = await adminApiRequest<ApiSchemas['AdminCalendarManualBlockDeleteResponse']>({
    endpointPath: `/v1/admin/calendar/manual-blocks/${id}`,
    method: 'DELETE',
  });
  return Boolean(isRecord(payload) && payload.deleted);
}
