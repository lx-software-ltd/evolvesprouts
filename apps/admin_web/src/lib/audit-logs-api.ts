import { adminApiRequest, AdminApiError } from './api-admin-client';
import { isRecord } from './type-guards';

import type { AuditLogsFilters } from '@/types/audit-log';
import type { components } from '@/types/generated/admin-api.generated';

export type { AuditLogsFilters };
export type AuditLog = components['schemas']['AuditLog'];

export interface AuditLogsResponse {
  items: AuditLog[];
  next_cursor?: string | null;
}

function buildAuditLogsPath(
  filters: AuditLogsFilters | undefined,
  cursor: string | undefined,
  limit: number
): string {
  const params = new URLSearchParams();
  if (cursor) {
    params.set('cursor', cursor);
  }
  if (limit) {
    params.set('limit', `${limit}`);
  }
  if (filters?.table) {
    params.set('table', filters.table);
  }
  if (filters?.record_id) {
    params.set('record_id', filters.record_id);
  }
  if (filters?.user_id) {
    params.set('user_id', filters.user_id);
  }
  if (filters?.email) {
    params.set('email', filters.email);
  }
  if (filters?.action) {
    params.set('action', filters.action);
  }
  if (filters?.since) {
    params.set('since', filters.since);
  }
  const qs = params.toString();
  return qs ? `/v1/admin/audit-logs?${qs}` : '/v1/admin/audit-logs';
}

function parseAuditLog(raw: unknown): AuditLog | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = raw.id;
  const table_name = raw.table_name;
  const record_id = raw.record_id;
  const action = raw.action;
  const timestamp = raw.timestamp;
  if (
    typeof id !== 'string' ||
    typeof table_name !== 'string' ||
    typeof record_id !== 'string' ||
    typeof action !== 'string' ||
    typeof timestamp !== 'string'
  ) {
    return null;
  }
  const user_id = typeof raw.user_id === 'string' ? raw.user_id : null;
  const user_email =
    typeof raw.user_email === 'string' ? raw.user_email : raw.user_email === null ? null : undefined;
  const request_id = typeof raw.request_id === 'string' ? raw.request_id : null;
  const old_values = isRecord(raw.old_values) ? raw.old_values : null;
  const new_values = isRecord(raw.new_values) ? raw.new_values : null;
  const changed_fields = Array.isArray(raw.changed_fields)
    ? raw.changed_fields.filter((f): f is string => typeof f === 'string')
    : null;
  const ip_address = typeof raw.ip_address === 'string' ? raw.ip_address : null;
  const user_agent = typeof raw.user_agent === 'string' ? raw.user_agent : null;
  const source = typeof raw.source === 'string' ? raw.source : 'trigger';

  const row: AuditLog = {
    id,
    table_name,
    record_id,
    action: action as AuditLog['action'],
    user_id: user_id ?? undefined,
    request_id: request_id ?? undefined,
    old_values: old_values ?? undefined,
    new_values: new_values ?? undefined,
    changed_fields: changed_fields ?? undefined,
    timestamp,
    source,
    ip_address: ip_address ?? undefined,
    user_agent: user_agent ?? undefined,
  };
  if (user_email !== undefined) {
    row.user_email = user_email;
  }
  return row;
}

function parseListPayload(raw: unknown): AuditLogsResponse {
  if (!isRecord(raw)) {
    return { items: [], next_cursor: null };
  }
  const itemsRaw = raw.items;
  const items: AuditLog[] = Array.isArray(itemsRaw)
    ? itemsRaw.map(parseAuditLog).filter((row): row is AuditLog => row !== null)
    : [];
  const nc = raw.next_cursor;
  const next_cursor = typeof nc === 'string' ? nc : nc === null || nc === undefined ? null : null;
  return { items, next_cursor };
}

export async function listAuditLogs(
  filters?: AuditLogsFilters,
  cursor?: string,
  limit = 25
): Promise<AuditLogsResponse> {
  const endpointPath = buildAuditLogsPath(filters, cursor, limit);
  const payload = await adminApiRequest<unknown>({
    endpointPath,
    method: 'GET',
  });
  return parseListPayload(payload);
}

export async function getAuditLog(id: string): Promise<AuditLog> {
  const payload = await adminApiRequest<unknown>({
    endpointPath: `/v1/admin/audit-logs/${encodeURIComponent(id)}`,
    method: 'GET',
  });
  const row = parseAuditLog(payload);
  if (!row) {
    throw new AdminApiError({
      statusCode: 500,
      payload,
      message: 'Invalid audit log response',
    });
  }
  return row;
}
