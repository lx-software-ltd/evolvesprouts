import { ADMIN_LIST_PAGE_SIZE, buildAdminListPath } from './admin-list-query';
import { adminApiRequest } from './api-admin-client';
import { asBoolean, asNullableString, asStringArray } from './api-payload';
import { isRecord } from './type-guards';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];
type ApiCognitoUser = ApiSchemas['CognitoUser'];

export type CognitoStaffGroup = ApiSchemas['CognitoStaffGroup'];

export type CognitoUserRow = ApiCognitoUser & { id: string };

export type CognitoUsersFilters = {
  name?: string;
  email?: string;
};

export type CognitoUsersResponse = {
  items: CognitoUserRow[];
  next_cursor: string | null;
};

export type CreateCognitoUserRequest = ApiSchemas['CreateCognitoUserRequest'];
export type UpdateCognitoUserRequest = ApiSchemas['UpdateCognitoUserRequest'];

function parseCognitoUser(raw: unknown): CognitoUserRow | null {
  if (!isRecord(raw)) {
    return null;
  }
  const username = asNullableString(raw.username) ?? '';
  const sub = asNullableString(raw.sub) ?? '';
  if (!username || !sub) {
    return null;
  }
  const status = asNullableString(raw.status) ?? 'UNKNOWN';
  return {
    id: username,
    username,
    sub,
    email: asNullableString(raw.email),
    name: asNullableString(raw.name),
    email_verified: asBoolean(raw.email_verified),
    enabled: raw.enabled !== false,
    status,
    groups: asStringArray(raw.groups),
    created_at: asNullableString(raw.created_at),
    updated_at: asNullableString(raw.updated_at),
    last_auth_time: asNullableString(raw.last_auth_time),
  };
}

export function cognitoUserPath(username: string): string {
  return `/v1/admin/cognito-users/${encodeURIComponent(username)}`;
}

export async function listCognitoUsers(
  filters?: CognitoUsersFilters,
  cursor?: string | null,
  limit = ADMIN_LIST_PAGE_SIZE,
  signal?: AbortSignal
): Promise<CognitoUsersResponse> {
  const payload = await adminApiRequest<unknown>({
    endpointPath: buildAdminListPath('/v1/admin/cognito-users', {
      filters: { name: filters?.name, email: filters?.email },
      cursor,
      limit,
    }),
    method: 'GET',
    signal,
  });
  if (!isRecord(payload)) {
    return { items: [], next_cursor: null };
  }
  const items = Array.isArray(payload.items)
    ? payload.items.map(parseCognitoUser).filter((row): row is CognitoUserRow => row !== null)
    : [];
  const next = payload.next_cursor;
  return { items, next_cursor: typeof next === 'string' && next ? next : null };
}

export async function getCognitoUser(username: string, signal?: AbortSignal): Promise<CognitoUserRow | null> {
  const payload = await adminApiRequest<unknown>({
    endpointPath: cognitoUserPath(username),
    method: 'GET',
    signal,
  });
  return parseCognitoUser(payload);
}

export async function createCognitoUser(body: CreateCognitoUserRequest): Promise<CognitoUserRow> {
  const payload = await adminApiRequest<unknown>({
    endpointPath: '/v1/admin/cognito-users',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  const row = parseCognitoUser(payload);
  if (!row) {
    throw new Error('Create user returned an invalid payload.');
  }
  return row;
}

export async function updateCognitoUser(
  username: string,
  body: UpdateCognitoUserRequest
): Promise<CognitoUserRow> {
  const payload = await adminApiRequest<unknown>({
    endpointPath: cognitoUserPath(username),
    method: 'PATCH',
    body,
  });
  const row = parseCognitoUser(payload);
  if (!row) {
    throw new Error('Update user returned an invalid payload.');
  }
  return row;
}

export async function deleteCognitoUser(username: string): Promise<void> {
  await adminApiRequest<unknown>({
    endpointPath: cognitoUserPath(username),
    method: 'DELETE',
  });
}

export function primaryStaffGroup(groups: readonly string[]): CognitoStaffGroup | '' {
  if (groups.includes('admin')) {
    return 'admin';
  }
  if (groups.includes('manager')) {
    return 'manager';
  }
  if (groups.includes('instructor')) {
    return 'instructor';
  }
  return '';
}
