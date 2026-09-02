import { AdminApiError, adminApiRequest } from './api-admin-client';
import { asNullableString, asTrimmedString, asStringArray } from './api-payload';
import { isRecord } from './type-guards';

import type {
  AdminAsset,
  AdminAssetListResult,
  AdminAssetTag,
  AssetGrant,
  AssetType,
  AssetVisibility,
  CreateAssetGrantInput,
  CreatedAssetUpload,
  InitAdminAssetContentReplaceUpload,
  ListAdminAssetsInput,
  PaginatedList,
  UpdateAdminAssetPatchInput,
  UpsertAdminAssetInput,
} from '@/types/assets';
import { ACCESS_GRANT_TYPES, ASSET_TYPES, ASSET_VISIBILITIES } from '@/types/assets';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];
type ApiAsset = ApiSchemas['Asset'];
type ApiAssetResponse = ApiSchemas['AssetResponse'];
type ApiAssetListResponse = ApiSchemas['AssetListResponse'];
type ApiAssetGrant = ApiSchemas['AssetGrant'];
type ApiAssetGrantResponse = ApiSchemas['AssetGrantResponse'];
type ApiAssetGrantListResponse = ApiSchemas['AssetGrantListResponse'];
type ApiCreateAssetRequest = ApiSchemas['CreateAssetRequest'];
type ApiPartialUpdateAssetRequest = ApiSchemas['PartialUpdateAssetRequest'];
type ApiCreateAssetResponse = ApiSchemas['CreateAssetResponse'];
type ApiCreateAssetGrantRequest = ApiSchemas['CreateAssetGrantRequest'];
type ApiAssetShareLinkResponse = ApiSchemas['AssetShareLinkResponse'];
type ApiAssetShareLinkPolicyRequest = ApiSchemas['AssetShareLinkPolicyRequest'];

type ApiAssetListPayload = ApiAssetListResponse | ApiAsset[];
type ApiAssetPayload = ApiAssetResponse | ApiAsset;
type ApiAssetGrantListPayload = ApiAssetGrantListResponse | ApiAssetGrant[];
type ApiAssetGrantPayload = ApiAssetGrantResponse | ApiAssetGrant;
type ApiCreateAssetPayload = ApiCreateAssetResponse;
type ApiInitAssetContentReplaceResponse = ApiSchemas['InitAssetContentReplaceResponse'];
type ApiInitAssetContentReplacePayload = ApiInitAssetContentReplaceResponse;
type ApiAssetShareLinkPayload = ApiAssetShareLinkResponse;
type ApiAssetDownloadResponse = ApiSchemas['AssetDownloadResponse'];
type ApiAssetDownloadPayload = ApiAssetDownloadResponse;

export interface CreateAdminAssetResult {
  asset: AdminAsset | null;
  upload: CreatedAssetUpload;
}

export interface AssetShareLink {
  assetId: string;
  shareUrl: string;
  allowedDomains: string[];
}

export interface AssetShareLinkPolicyInput {
  allowedDomains: string[];
}

function isApiAsset(value: unknown): value is ApiAsset {
  return isRecord(value) && typeof value.id === 'string';
}

function isApiAssetResponse(value: unknown): value is ApiAssetResponse {
  return isRecord(value) && isApiAsset(value.asset);
}

function isApiAssetGrant(value: unknown): value is ApiAssetGrant {
  return isRecord(value) && typeof value.id === 'string';
}

function isApiAssetGrantResponse(value: unknown): value is ApiAssetGrantResponse {
  return isRecord(value) && isApiAssetGrant(value.grant);
}

function isApiAssetShareLinkResponse(value: unknown): value is ApiAssetShareLinkResponse {
  return isRecord(value) && typeof value.share_url === 'string';
}

function isApiAssetDownloadResponse(value: unknown): value is ApiAssetDownloadResponse {
  return isRecord(value) && typeof value.download_url === 'string';
}

function isApiInitAssetContentReplaceResponse(
  value: unknown
): value is ApiInitAssetContentReplaceResponse {
  return isRecord(value) && typeof value.pending_s3_key === 'string';
}

function parseAssetType(value: unknown): AssetType {
  if (typeof value === 'string' && ASSET_TYPES.includes(value as AssetType)) {
    return value as AssetType;
  }
  return 'document';
}

function parseVisibility(value: unknown): AssetVisibility {
  if (typeof value === 'string' && ASSET_VISIBILITIES.includes(value as AssetVisibility)) {
    return value as AssetVisibility;
  }
  return 'restricted';
}

function parseAssetTagRef(value: unknown): AdminAssetTag | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    color: asNullableString(value.color ?? null),
  };
}

function parseGrantType(value: unknown): AssetGrant['grantType'] {
  if (typeof value === 'string' && ACCESS_GRANT_TYPES.includes(value as AssetGrant['grantType'])) {
    return value as AssetGrant['grantType'];
  }
  return 'user';
}

function parseAsset(value: ApiAsset): AdminAsset {
  const tagsRaw = value.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map(parseAssetTagRef).filter((tag): tag is AdminAssetTag => tag !== null)
    : [];

  return {
    id: asTrimmedString(value.id) ?? '',
    title: asTrimmedString(value.title) ?? 'Untitled asset',
    description: asNullableString(value.description ?? null),
    assetType: parseAssetType(value.asset_type),
    s3Key: asTrimmedString(value.s3_key) ?? '',
    fileName: asTrimmedString(value.file_name) ?? '',
    resourceKey: asNullableString(value.resource_key ?? null),
    contentType: asNullableString(value.content_type ?? null),
    contentLanguage: asNullableString(value.content_language ?? null),
    visibility: parseVisibility(value.visibility),
    tags,
    createdBy: asNullableString(value.created_by ?? null),
    createdAt: asNullableString(value.created_at ?? null),
    updatedAt: asNullableString(value.updated_at ?? null),
  };
}

function parseGrant(value: ApiAssetGrant): AssetGrant {
  return {
    id: asTrimmedString(value.id) ?? '',
    assetId: asTrimmedString(value.asset_id) ?? '',
    grantType: parseGrantType(value.grant_type),
    granteeId: asNullableString(value.grantee_id ?? null),
    grantedBy: asNullableString(value.granted_by ?? null),
    createdAt: asNullableString(value.created_at ?? null),
  };
}

function extractAssetList(payload: ApiAssetListPayload): {
  items: AdminAsset[];
  nextCursor: string | null;
  linkedTagNames: string[];
} {
  if (Array.isArray(payload)) {
    return {
      items: payload.filter(isApiAsset).map((entry) => parseAsset(entry)),
      nextCursor: null,
      linkedTagNames: [],
    };
  }

  if (!isRecord(payload)) {
    return { items: [], nextCursor: null, linkedTagNames: [] };
  }

  const items = Array.isArray(payload.items)
    ? payload.items.filter((entry): entry is ApiAsset => isApiAsset(entry)).map((entry) => parseAsset(entry))
    : [];

  const asList = payload as ApiAssetListResponse;

  return {
    items,
    nextCursor: asTrimmedString(asList.next_cursor) ?? null,
    linkedTagNames: asStringArray(asList.linked_tag_names),
  };
}

function extractAsset(payload: ApiAssetPayload): AdminAsset | null {

  if (isApiAsset(payload)) {
    return parseAsset(payload);
  }

  if (isApiAssetResponse(payload)) {
    return parseAsset(payload.asset);
  }

  return null;
}

function extractGrantList(payload: ApiAssetGrantListPayload): AssetGrant[] {
  if (Array.isArray(payload)) {
    return payload
      .filter((entry): entry is ApiAssetGrant => isApiAssetGrant(entry))
      .map((entry) => parseGrant(entry));
  }

  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return [];
  }

  return payload.items
    .filter((entry): entry is ApiAssetGrant => isApiAssetGrant(entry))
    .map((entry) => parseGrant(entry));
}

function extractGrant(payload: ApiAssetGrantPayload): AssetGrant | null {
  if (isApiAssetGrant(payload)) {
    return parseGrant(payload);
  }

  if (isApiAssetGrantResponse(payload)) {
    return parseGrant(payload.grant);
  }

  return null;
}

function extractHeaders(value: Record<string, string> | null | undefined): Record<string, string> {
  if (!value || !isRecord(value)) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const [headerName, headerValue] of Object.entries(value)) {
    if (typeof headerValue === 'string') {
      headers[headerName] = headerValue;
    }
  }
  return headers;
}

function normalizeAssetInput(input: UpsertAdminAssetInput): ApiCreateAssetRequest {
  const trimmedDescription = input.description?.trim() ?? '';
  const trimmedResourceKey = input.resourceKey?.trim() ?? '';
  const trimmedContentType = input.contentType?.trim() ?? '';

  const body: ApiCreateAssetRequest = {
    title: input.title.trim(),
    description: trimmedDescription || null,
    asset_type: input.assetType,
    file_name: input.fileName.trim(),
    resource_key: trimmedResourceKey || null,
    content_type: trimmedContentType || null,
    visibility: input.visibility,
  };
  if (input.contentLanguage !== undefined) {
    body.content_language = input.contentLanguage;
  }
  if (input.clientTag !== undefined) {
    body.client_tag = input.clientTag;
  }
  return body;
}

function buildAdminAssetPatchBody(input: UpdateAdminAssetPatchInput): ApiPartialUpdateAssetRequest {
  const body: ApiPartialUpdateAssetRequest = {};

  if (input.title !== undefined) {
    body.title = input.title.trim();
  }
  if (input.description !== undefined) {
    const trimmed = input.description?.trim() ?? '';
    body.description = trimmed || null;
  }
  if (input.assetType !== undefined) {
    body.asset_type = input.assetType;
  }
  if (input.fileName !== undefined) {
    body.file_name = input.fileName.trim();
  }
  if (input.resourceKey !== undefined) {
    const trimmed = input.resourceKey?.trim() ?? '';
    body.resource_key = trimmed || null;
  }
  if (input.contentType !== undefined) {
    const trimmed = input.contentType?.trim() ?? '';
    body.content_type = trimmed || null;
  }
  if (input.contentLanguage !== undefined) {
    body.content_language = input.contentLanguage;
  }
  if (input.visibility !== undefined) {
    body.visibility = input.visibility;
  }
  if (input.clientTag !== undefined) {
    body.client_tag = input.clientTag;
  }

  return body;
}

export async function listAdminAssets(
  input: ListAdminAssetsInput = {}
): Promise<AdminAssetListResult> {
  const params = new URLSearchParams();
  if (input.query?.trim()) {
    params.set('query', input.query.trim());
  }
  if (input.visibility?.trim()) {
    params.set('visibility', input.visibility);
  }
  if (input.assetType?.trim()) {
    params.set('asset_type', input.assetType);
  }
  const tagFilter = input.tagName?.trim();
  if (tagFilter) {
    params.set('tag_name', tagFilter);
  }
  if (input.cursor?.trim()) {
    params.set('cursor', input.cursor);
  }
  if (typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0) {
    params.set('limit', `${Math.floor(input.limit)}`);
  }

  const queryString = params.toString();
  const endpointPath = queryString ? `/v1/admin/assets?${queryString}` : '/v1/admin/assets';
  const payload = await adminApiRequest<ApiAssetListPayload>({
    endpointPath,
    method: 'GET',
  });
  const list = extractAssetList(payload);

  return {
    items: list.items,
    nextCursor: list.nextCursor,
    linkedTagNames: list.linkedTagNames,
  };
}

export async function getAdminAsset(assetId: string): Promise<AdminAsset | null> {
  const payload = await adminApiRequest<ApiAssetPayload>({
    endpointPath: `/v1/admin/assets/${assetId}`,
    method: 'GET',
  });
  return extractAsset(payload);
}

function extractInitContentReplaceUpload(
  payload: ApiInitAssetContentReplacePayload
): InitAdminAssetContentReplaceUpload {
  if (!isApiInitAssetContentReplaceResponse(payload)) {
    throw new Error('Replace upload init response was missing pending_s3_key.');
  }
  const pendingS3Key = asTrimmedString(payload.pending_s3_key) ?? '';
  if (!pendingS3Key) {
    throw new Error('Replace upload init response was missing pending_s3_key.');
  }
  return {
    pendingS3Key,
    uploadUrl: asTrimmedString(payload.upload_url) ?? null,
    uploadMethod: asTrimmedString(payload.upload_method) ?? 'PUT',
    uploadHeaders: extractHeaders(payload.upload_headers),
    expiresAt: asNullableString(payload.expires_at ?? null),
  };
}

export async function createAdminAsset(
  input: UpsertAdminAssetInput
): Promise<CreateAdminAssetResult> {
  const payload = await adminApiRequest<ApiCreateAssetPayload>({
    endpointPath: '/v1/admin/assets',
    method: 'POST',
    body: normalizeAssetInput(input),
    expectedSuccessStatuses: [200, 201],
  });

  const upload: CreatedAssetUpload = {
    uploadUrl: asTrimmedString(payload.upload_url) ?? null,
    uploadMethod: asTrimmedString(payload.upload_method) ?? 'PUT',
    uploadHeaders: extractHeaders(payload.upload_headers),
    expiresAt: asNullableString(payload.expires_at ?? null),
  };

  return {
    asset: isApiAsset(payload.asset) ? parseAsset(payload.asset) : null,
    upload,
  };
}

export interface InitAdminAssetContentReplaceInput {
  fileName: string;
  contentType?: string | null;
}

export async function initAdminAssetContentReplace(
  assetId: string,
  input: InitAdminAssetContentReplaceInput
): Promise<InitAdminAssetContentReplaceUpload> {
  const trimmedFileName = input.fileName.trim();
  const trimmedContentType = input.contentType?.trim() ?? '';
  const body: Record<string, string | null> = {
    file_name: trimmedFileName,
    content_type: trimmedContentType || null,
  };
  const payload = await adminApiRequest<ApiInitAssetContentReplacePayload>({
    endpointPath: `/v1/admin/assets/${assetId}/content/init`,
    method: 'POST',
    body,
  });
  return extractInitContentReplaceUpload(payload);
}

export interface CompleteAdminAssetContentReplaceInput {
  pendingS3Key: string;
  fileName: string;
  contentType?: string | null;
}

export async function completeAdminAssetContentReplace(
  assetId: string,
  input: CompleteAdminAssetContentReplaceInput
): Promise<AdminAsset | null> {
  const trimmedContentType = input.contentType?.trim() ?? '';
  const payload = await adminApiRequest<ApiAssetPayload>({
    endpointPath: `/v1/admin/assets/${assetId}/content/complete`,
    method: 'POST',
    body: {
      pending_s3_key: input.pendingS3Key.trim(),
      file_name: input.fileName.trim(),
      content_type: trimmedContentType || null,
    },
  });
  return extractAsset(payload);
}

export async function updateAdminAsset(
  assetId: string,
  input: UpdateAdminAssetPatchInput
): Promise<AdminAsset | null> {
  const body = buildAdminAssetPatchBody(input);
  if (Object.keys(body).length === 0) {
    return getAdminAsset(assetId);
  }
  const payload = await adminApiRequest<ApiAssetPayload>({
    endpointPath: `/v1/admin/assets/${assetId}`,
    method: 'PATCH',
    body,
  });
  return extractAsset(payload);
}

export async function deleteAdminAsset(assetId: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/assets/${assetId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 202, 204],
  });
}

/** Resolves a time-limited CloudFront URL; uses the user download route (admins have access). */
export async function getUserAssetDownloadUrl(assetId: string): Promise<string> {
  const payload = await adminApiRequest<ApiAssetDownloadPayload>({
    endpointPath: `/v1/user/assets/${assetId}/download`,
    method: 'GET',
  });
  if (!isApiAssetDownloadResponse(payload)) {
    throw new Error('Download URL was not returned by the API.');
  }
  const url = asTrimmedString(payload.download_url);
  if (!url) {
    throw new Error('Download URL was not returned by the API.');
  }
  return url;
}

export async function listAdminAssetGrants(assetId: string): Promise<AssetGrant[]> {
  const payload = await adminApiRequest<ApiAssetGrantListPayload>({
    endpointPath: `/v1/admin/assets/${assetId}/grants`,
    method: 'GET',
  });

  return extractGrantList(payload);
}

export async function createAdminAssetGrant(
  assetId: string,
  input: CreateAssetGrantInput
): Promise<AssetGrant | null> {
  const requestBody: ApiCreateAssetGrantRequest = {
    grant_type: input.grantType,
    grantee_id: input.granteeId?.trim() || null,
  };

  const payload = await adminApiRequest<ApiAssetGrantPayload>({
    endpointPath: `/v1/admin/assets/${assetId}/grants`,
    method: 'POST',
    body: requestBody,
    expectedSuccessStatuses: [200, 201],
  });

  return extractGrant(payload);
}

export async function deleteAdminAssetGrant(assetId: string, grantId: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/assets/${assetId}/grants/${grantId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 202, 204],
  });
}

function parseAssetShareLink(payload: ApiAssetShareLinkPayload, fallbackAssetId: string): AssetShareLink {

  if (!isApiAssetShareLinkResponse(payload)) {
    throw new Error('Share URL was not returned by the API.');
  }

  const shareUrl = asTrimmedString(payload.share_url);
  if (!shareUrl) {
    throw new Error('Share URL was not returned by the API.');
  }

  return {
    assetId: asTrimmedString(payload.asset_id) ?? fallbackAssetId,
    shareUrl,
    allowedDomains: asStringArray(payload.allowed_domains),
  };
}

function normalizeShareLinkPolicyInput(
  input: AssetShareLinkPolicyInput | undefined
): ApiAssetShareLinkPolicyRequest | undefined {
  if (!input) {
    return undefined;
  }
  return {
    allowed_domains: input.allowedDomains,
  };
}

export async function getOrCreateAdminAssetShareLink(
  assetId: string,
  input?: AssetShareLinkPolicyInput
): Promise<AssetShareLink> {
  const payload = await adminApiRequest<ApiAssetShareLinkPayload>({
    endpointPath: `/v1/admin/assets/${assetId}/share-link`,
    method: 'POST',
    body: normalizeShareLinkPolicyInput(input),
    expectedSuccessStatuses: [200, 201],
  });
  return parseAssetShareLink(payload, assetId);
}

export async function getAdminAssetShareLink(assetId: string): Promise<AssetShareLink | null> {
  try {
    const payload = await adminApiRequest<ApiAssetShareLinkPayload>({
      endpointPath: `/v1/admin/assets/${assetId}/share-link`,
      method: 'GET',
      expectedSuccessStatuses: [200],
    });
    return parseAssetShareLink(payload, assetId);
  } catch (error) {
    if (error instanceof AdminApiError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

export async function rotateAdminAssetShareLink(
  assetId: string,
  input?: AssetShareLinkPolicyInput
): Promise<AssetShareLink> {
  const payload = await adminApiRequest<ApiAssetShareLinkPayload>({
    endpointPath: `/v1/admin/assets/${assetId}/share-link/rotate`,
    method: 'POST',
    body: normalizeShareLinkPolicyInput(input),
    expectedSuccessStatuses: [200],
  });
  return parseAssetShareLink(payload, assetId);
}

export async function revokeAdminAssetShareLink(assetId: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/assets/${assetId}/share-link`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 202, 204],
  });
}

export async function uploadFileToPresignedUrl({
  uploadUrl,
  uploadMethod,
  uploadHeaders,
  file,
  signal,
}: {
  uploadUrl: string;
  uploadMethod?: string;
  uploadHeaders?: Record<string, string>;
  file: File;
  signal?: AbortSignal;
}): Promise<void> {
  const method = (uploadMethod || 'PUT').toUpperCase();
  const headers: Record<string, string> = {
    ...(uploadHeaders ?? {}),
  };
  if (!headers['Content-Type'] && file.type) {
    headers['Content-Type'] = file.type;
  }

  const response = await fetch(uploadUrl, {
    method,
    headers,
    body: file,
    signal,
  });
  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}.`);
  }
}
