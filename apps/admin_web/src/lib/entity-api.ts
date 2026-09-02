import { clampAdminListLimit } from '@/lib/admin-list-limit';

import { adminApiRequest } from './api-admin-client';
import { asNullableString, asNumber } from './api-payload';
import { isRecord } from './type-guards';

import type { EntityListFilters } from '@/types/entity-list';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

type ApiContactList = ApiSchemas['AdminContactListResponse'];
type ApiContactResponse = ApiSchemas['AdminContactResponse'];
type ApiFamilyList = ApiSchemas['AdminFamilyListResponse'];
type ApiFamilyResponse = ApiSchemas['AdminFamilyResponse'];
type ApiOrganizationList = ApiSchemas['AdminOrganizationListResponse'];
type ApiOrganizationResponse = ApiSchemas['AdminOrganizationResponse'];
type ApiTagList = ApiSchemas['EntityTagListResponse'];
type ApiEntityPickerList = ApiSchemas['EntityPickerListResponse'];
type ApiNoteList = ApiSchemas['AdminNoteListResponse'];
type ApiEntityServicesList = ApiSchemas['EntityServicesResponse'];

export type AdminContactRow = ApiSchemas['AdminContact'];
export type AdminFamilyRow = ApiSchemas['AdminFamily'];
export type AdminOrganizationRow = ApiSchemas['AdminOrganization'];
export type EntityTagRef = ApiSchemas['EntityTagRef'];
export type EntityPickerListItem = ApiSchemas['EntityPickerListItem'];
export type NoteRow = ApiSchemas['Note'];

function parseContact(value: unknown): AdminContactRow {
  const row = isRecord(value) ? value : {};
  return {
    ...(row as AdminContactRow),
    standalone_note_count: asNumber(row.standalone_note_count, 0),
  };
}

function parseFamily(value: unknown): AdminFamilyRow {
  const row = isRecord(value) ? value : {};
  return row as AdminFamilyRow;
}

export function parseAdminOrganization(value: unknown): AdminOrganizationRow {
  const row = isRecord(value) ? value : {};
  return row as AdminOrganizationRow;
}

function parseTag(value: unknown): EntityTagRef {
  const row = isRecord(value) ? value : {};
  return row as EntityTagRef;
}

function parsePickerItem(value: unknown): EntityPickerListItem {
  const row = isRecord(value) ? value : {};
  return row as EntityPickerListItem;
}

function parseNote(value: unknown): NoteRow {
  const row = isRecord(value) ? value : {};
  return row as NoteRow;
}

export async function listEntityTags(signal?: AbortSignal): Promise<EntityTagRef[]> {
  const payload = await adminApiRequest<ApiTagList>({
    endpointPath: '/v1/admin/contacts/tags',
    method: 'GET',
    signal,
  });
  return Array.isArray(payload.items) ? payload.items.map((t) => parseTag(t)) : [];
}

export async function listEntityFamilyPicker(
  signal?: AbortSignal
): Promise<EntityPickerListItem[]> {
  const payload = await adminApiRequest<ApiEntityPickerList>({
    endpointPath: `/v1/admin/families/picker?limit=${clampAdminListLimit(100)}`,
    method: 'GET',
    signal,
  });
  return Array.isArray(payload.items) ? payload.items.map((e) => parsePickerItem(e)) : [];
}

export async function listEntityOrganizationPicker(
  params?: { relationshipType?: string },
  signal?: AbortSignal
): Promise<EntityPickerListItem[]> {
  const query = new URLSearchParams();
  query.set('limit', `${clampAdminListLimit(100)}`);
  if (params?.relationshipType?.trim()) {
    query.set('relationship_type', params.relationshipType.trim());
  }
  const payload = await adminApiRequest<ApiEntityPickerList>({
    endpointPath: `/v1/admin/organizations/picker?${query.toString()}`,
    method: 'GET',
    signal,
  });
  return Array.isArray(payload.items) ? payload.items.map((e) => parsePickerItem(e)) : [];
}

export async function listEntityPartnerOrganizationPicker(
  signal?: AbortSignal
): Promise<EntityPickerListItem[]> {
  return listEntityOrganizationPicker({ relationshipType: 'partner' }, signal);
}

export async function searchEntityContactsForPicker(
  params: { query: string; excludeContactId?: string | null; limit?: number },
  signal?: AbortSignal
): Promise<EntityPickerListItem[]> {
  const q = new URLSearchParams();
  q.set('query', params.query.trim());
  if (params.excludeContactId?.trim()) {
    q.set('exclude_contact_id', params.excludeContactId.trim());
  }
  if (typeof params.limit === 'number') {
    q.set('limit', `${clampAdminListLimit(params.limit)}`);
  }
  const payload = await adminApiRequest<ApiEntityPickerList>({
    endpointPath: `/v1/admin/contacts/search?${q.toString()}`,
    method: 'GET',
    signal,
  });
  return Array.isArray(payload.items) ? payload.items.map((e) => parsePickerItem(e)) : [];
}

export async function getAdminContact(
  contactId: string,
  signal?: AbortSignal
): Promise<AdminContactRow | null> {
  const payload = await adminApiRequest<ApiContactResponse>({
    endpointPath: `/v1/admin/contacts/${contactId}`,
    method: 'GET',
    signal,
  });
  return payload.contact ? parseContact(payload.contact) : null;
}

export async function listAdminContacts(
  params: Partial<EntityListFilters> & { cursor?: string | null; limit?: number },
  signal?: AbortSignal
): Promise<{ items: AdminContactRow[]; nextCursor: string | null; totalCount: number }> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.query?.trim()) query.set('query', params.query.trim());
  if (params.active) query.set('active', params.active);
  if (params.contact_type) query.set('contact_type', params.contact_type);
  const qs = query.toString();
  const payload = await adminApiRequest<ApiContactList>({
    endpointPath: `/v1/admin/contacts${qs ? `?${qs}` : ''}`,
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items.map((e) => parseContact(e)) : [],
    nextCursor: asNullableString(payload.next_cursor),
    totalCount: asNumber(payload.total_count, 0),
  };
}

export async function createAdminContact(
  body: ApiSchemas['CreateAdminContactRequest']
): Promise<AdminContactRow | null> {
  const payload = await adminApiRequest<ApiContactResponse>({
    endpointPath: '/v1/admin/contacts',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.contact ?? null;
}

export async function updateAdminContact(
  contactId: string,
  body: ApiSchemas['UpdateAdminContactRequest']
): Promise<AdminContactRow | null> {
  const payload = await adminApiRequest<ApiContactResponse>({
    endpointPath: `/v1/admin/contacts/${contactId}`,
    method: 'PATCH',
    body,
  });
  return payload.contact ?? null;
}

export async function deleteAdminContact(contactId: string): Promise<void> {
  await adminApiRequest<unknown>({
    endpointPath: `/v1/admin/contacts/${contactId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [204],
  });
}

export async function listAdminContactNotes(
  contactId: string,
  signal?: AbortSignal
): Promise<NoteRow[]> {
  const payload = await adminApiRequest<ApiNoteList>({
    endpointPath: `/v1/admin/contacts/${contactId}/notes`,
    method: 'GET',
    signal,
  });
  return Array.isArray(payload.items) ? payload.items.map((n) => parseNote(n)) : [];
}

export async function listAdminContactServices(
  contactId: string,
  signal?: AbortSignal
): Promise<string[]> {
  const payload = await adminApiRequest<ApiEntityServicesList>({
    endpointPath: `/v1/admin/contacts/${contactId}/services`,
    method: 'GET',
    signal,
  });
  if (!Array.isArray(payload.items)) {
    return [];
  }
  return payload.items
    .map((item) => (typeof item?.label === 'string' ? item.label : null))
    .filter((label): label is string => label !== null);
}

export async function listAdminFamilyServices(
  familyId: string,
  signal?: AbortSignal
): Promise<string[]> {
  const payload = await adminApiRequest<ApiEntityServicesList>({
    endpointPath: `/v1/admin/families/${familyId}/services`,
    method: 'GET',
    signal,
  });
  if (!Array.isArray(payload.items)) {
    return [];
  }
  return payload.items
    .map((item) => (typeof item?.label === 'string' ? item.label : null))
    .filter((label): label is string => label !== null);
}

export async function listAdminOrganizationServices(
  organizationId: string,
  signal?: AbortSignal
): Promise<string[]> {
  const payload = await adminApiRequest<ApiEntityServicesList>({
    endpointPath: `/v1/admin/organizations/${organizationId}/services`,
    method: 'GET',
    signal,
  });
  if (!Array.isArray(payload.items)) {
    return [];
  }
  return payload.items
    .map((item) => (typeof item?.label === 'string' ? item.label : null))
    .filter((label): label is string => label !== null);
}

export async function createAdminContactNote(
  contactId: string,
  body: ApiSchemas['CreateNoteRequest']
): Promise<NoteRow | null> {
  const payload = await adminApiRequest<{ note?: unknown }>({
    endpointPath: `/v1/admin/contacts/${contactId}/notes`,
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.note ? parseNote(payload.note) : null;
}

export async function updateAdminContactNote(
  contactId: string,
  noteId: string,
  body: ApiSchemas['UpdateNoteRequest']
): Promise<NoteRow | null> {
  const payload = await adminApiRequest<{ note?: unknown }>({
    endpointPath: `/v1/admin/contacts/${contactId}/notes/${noteId}`,
    method: 'PATCH',
    body,
  });
  return payload.note ? parseNote(payload.note) : null;
}

export async function deleteAdminContactNote(contactId: string, noteId: string): Promise<void> {
  await adminApiRequest<unknown>({
    endpointPath: `/v1/admin/contacts/${contactId}/notes/${noteId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [204],
  });
}

export async function listAdminFamilies(
  params: Partial<EntityListFilters> & { cursor?: string | null; limit?: number },
  signal?: AbortSignal
): Promise<{ items: AdminFamilyRow[]; nextCursor: string | null; totalCount: number }> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.query?.trim()) query.set('query', params.query.trim());
  if (params.active) query.set('active', params.active);
  const qs = query.toString();
  const payload = await adminApiRequest<ApiFamilyList>({
    endpointPath: `/v1/admin/families${qs ? `?${qs}` : ''}`,
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items.map((e) => parseFamily(e)) : [],
    nextCursor: asNullableString(payload.next_cursor),
    totalCount: asNumber(payload.total_count, 0),
  };
}

export async function createAdminFamily(
  body: ApiSchemas['CreateAdminFamilyRequest']
): Promise<AdminFamilyRow | null> {
  const payload = await adminApiRequest<ApiFamilyResponse>({
    endpointPath: '/v1/admin/families',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.family ?? null;
}

export async function updateAdminFamily(
  familyId: string,
  body: ApiSchemas['UpdateAdminFamilyRequest']
): Promise<AdminFamilyRow | null> {
  const payload = await adminApiRequest<ApiFamilyResponse>({
    endpointPath: `/v1/admin/families/${familyId}`,
    method: 'PATCH',
    body,
  });
  return payload.family ?? null;
}

export async function deleteAdminFamily(familyId: string): Promise<void> {
  await adminApiRequest<unknown>({
    endpointPath: `/v1/admin/families/${familyId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [204],
  });
}

export async function addAdminFamilyMember(
  familyId: string,
  body: ApiSchemas['AddFamilyMemberRequest']
): Promise<AdminFamilyRow | null> {
  const payload = await adminApiRequest<ApiFamilyResponse>({
    endpointPath: `/v1/admin/families/${familyId}/members`,
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.family ?? null;
}

export async function removeAdminFamilyMember(
  familyId: string,
  memberId: string
): Promise<AdminFamilyRow | null> {
  const payload = await adminApiRequest<ApiFamilyResponse>({
    endpointPath: `/v1/admin/families/${familyId}/members/${memberId}`,
    method: 'DELETE',
  });
  return payload.family ?? null;
}

export async function patchAdminFamilyMember(
  familyId: string,
  memberId: string,
  body: ApiSchemas['UpdateFamilyMemberRequest']
): Promise<AdminFamilyRow | null> {
  const payload = await adminApiRequest<ApiFamilyResponse>({
    endpointPath: `/v1/admin/families/${familyId}/members/${memberId}`,
    method: 'PATCH',
    body,
  });
  return payload.family ?? null;
}

export async function listAdminOrganizations(
  params: Partial<EntityListFilters> & { cursor?: string | null; limit?: number },
  signal?: AbortSignal
): Promise<{ items: AdminOrganizationRow[]; nextCursor: string | null; totalCount: number }> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.query?.trim()) query.set('query', params.query.trim());
  if (params.active) query.set('active', params.active);
  const qs = query.toString();
  const payload = await adminApiRequest<ApiOrganizationList>({
    endpointPath: `/v1/admin/organizations${qs ? `?${qs}` : ''}`,
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items.map((e) => parseAdminOrganization(e)) : [],
    nextCursor: asNullableString(payload.next_cursor),
    totalCount: asNumber(payload.total_count, 0),
  };
}

export async function createAdminOrganization(
  body: ApiSchemas['CreateAdminOrganizationRequest']
): Promise<AdminOrganizationRow | null> {
  const payload = await adminApiRequest<ApiOrganizationResponse>({
    endpointPath: '/v1/admin/organizations',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.organization ? parseAdminOrganization(payload.organization) : null;
}

export async function updateAdminOrganization(
  organizationId: string,
  body: ApiSchemas['UpdateAdminOrganizationRequest']
): Promise<AdminOrganizationRow | null> {
  const payload = await adminApiRequest<ApiOrganizationResponse>({
    endpointPath: `/v1/admin/organizations/${organizationId}`,
    method: 'PATCH',
    body,
  });
  return payload.organization ? parseAdminOrganization(payload.organization) : null;
}

export async function deleteAdminOrganization(organizationId: string): Promise<void> {
  await adminApiRequest<unknown>({
    endpointPath: `/v1/admin/organizations/${organizationId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [204],
  });
}

export async function addAdminOrganizationMember(
  organizationId: string,
  body: ApiSchemas['AddOrganizationMemberRequest']
): Promise<AdminOrganizationRow | null> {
  const payload = await adminApiRequest<ApiOrganizationResponse>({
    endpointPath: `/v1/admin/organizations/${organizationId}/members`,
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.organization ? parseAdminOrganization(payload.organization) : null;
}

export async function removeAdminOrganizationMember(
  organizationId: string,
  memberId: string
): Promise<AdminOrganizationRow | null> {
  const payload = await adminApiRequest<ApiOrganizationResponse>({
    endpointPath: `/v1/admin/organizations/${organizationId}/members/${memberId}`,
    method: 'DELETE',
  });
  return payload.organization ? parseAdminOrganization(payload.organization) : null;
}

export async function patchAdminOrganizationMember(
  organizationId: string,
  memberId: string,
  body: ApiSchemas['UpdateOrganizationMemberRequest']
): Promise<AdminOrganizationRow | null> {
  const payload = await adminApiRequest<ApiOrganizationResponse>({
    endpointPath: `/v1/admin/organizations/${organizationId}/members/${memberId}`,
    method: 'PATCH',
    body,
  });
  return payload.organization ? parseAdminOrganization(payload.organization) : null;
}
