import { adminApiRequest } from '@/lib/api-admin-client';
import { asBoolean, asNullableString } from '@/lib/api-payload';
import { isRecord } from '@/lib/type-guards';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export type SalesSettings = ApiSchemas['SalesSettings'];
export type UpdateSalesSettingsRequest = ApiSchemas['UpdateSalesSettingsRequest'];

function parseSalesSettings(value: unknown): SalesSettings {
  const row = isRecord(value) ? value : {};
  return {
    default_assigned_to: asNullableString(row.default_assigned_to),
    notify_assignee_on_assignment: asBoolean(row.notify_assignee_on_assignment, false),
    helper_detector_enabled: asBoolean(row.helper_detector_enabled, false),
    updated_at: asNullableString(row.updated_at) ?? undefined,
    updated_by: asNullableString(row.updated_by) ?? undefined,
  };
}

export async function getSalesSettings(signal?: AbortSignal): Promise<SalesSettings> {
  const payload = await adminApiRequest<ApiSchemas['SalesSettingsResponse']>({
    endpointPath: '/v1/admin/leads/settings',
    method: 'GET',
    signal,
  });
  return parseSalesSettings(payload.settings);
}

export async function updateSalesSettings(
  body: UpdateSalesSettingsRequest
): Promise<SalesSettings> {
  const payload = await adminApiRequest<ApiSchemas['SalesSettingsResponse']>({
    endpointPath: '/v1/admin/leads/settings',
    method: 'PATCH',
    body,
  });
  return parseSalesSettings(payload.settings);
}
