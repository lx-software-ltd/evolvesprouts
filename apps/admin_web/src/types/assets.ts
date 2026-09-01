import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];
type ApiAsset = ApiSchemas['Asset'];
type ApiAssetGrant = ApiSchemas['AssetGrant'];
type ApiCreateAssetRequest = ApiSchemas['CreateAssetRequest'];
type ApiPartialUpdateAssetRequest = ApiSchemas['PartialUpdateAssetRequest'];
type ApiCreateAssetResponse = ApiSchemas['CreateAssetResponse'];
type ApiCreateAssetGrantRequest = ApiSchemas['CreateAssetGrantRequest'];

type OptionalToNullable<T> = Exclude<T, undefined>;

function defineEnumValues<T extends string>() {
  return <U extends readonly T[]>(values: U & ([T] extends [U[number]] ? unknown : never)) => values;
}

export type AssetType = ApiAsset['asset_type'];
export const ASSET_TYPES = defineEnumValues<AssetType>()(
  ['guide', 'video', 'pdf', 'document'] as const satisfies readonly AssetType[]
);

export type AssetVisibility = ApiAsset['visibility'];
export const ASSET_VISIBILITIES = defineEnumValues<AssetVisibility>()(
  ['public', 'restricted'] as const satisfies readonly AssetVisibility[]
);

/** System tag name for assets linked to an expense (matches admin API `tag_name` filter). */
export const EXPENSE_ATTACHMENT_ASSET_TAG = 'expense_attachment' as const;

/** Admin-assignable client-facing document tag (matches admin API `client_tag`). */
export const CLIENT_DOCUMENT_ASSET_TAG = 'client_document' as const;

/** System tag name for assets linked to an issued customer invoice. */
export const CUSTOMER_INVOICE_ASSET_TAG = 'customer_invoice' as const;

export function isExpenseAttachmentAssetTag(tagName: string): boolean {
  return tagName.toLowerCase() === EXPENSE_ATTACHMENT_ASSET_TAG;
}

export function isCustomerInvoiceAssetTag(tagName: string): boolean {
  return tagName.toLowerCase() === CUSTOMER_INVOICE_ASSET_TAG;
}

export function isRestrictedSystemAssetTag(tagName: string): boolean {
  return isExpenseAttachmentAssetTag(tagName) || isCustomerInvoiceAssetTag(tagName);
}

export function assetHasRestrictedSystemTag(asset: { tags: ReadonlyArray<{ name: string }> }): boolean {
  return asset.tags.some((tag) => isRestrictedSystemAssetTag(tag.name));
}

/** Allowed `content_language` values for admin asset create/update (matches OpenAPI enum). */
export type AdminAssetWriteContentLanguage = NonNullable<
  Exclude<ApiCreateAssetRequest['content_language'], null | undefined>
>;

export type AdminAssetTag = {
  id: string;
  name: string;
  color: string | null;
};

export type AccessGrantType = ApiAssetGrant['grant_type'];
export const ACCESS_GRANT_TYPES = defineEnumValues<AccessGrantType>()(
  ['all_authenticated', 'organization', 'user'] as const satisfies readonly AccessGrantType[]
);

export interface AdminAsset {
  id: ApiAsset['id'];
  title: ApiAsset['title'];
  description: OptionalToNullable<ApiAsset['description']>;
  assetType: AssetType;
  s3Key: ApiAsset['s3_key'];
  fileName: ApiAsset['file_name'];
  resourceKey: OptionalToNullable<ApiAsset['resource_key']>;
  contentType: OptionalToNullable<ApiAsset['content_type']>;
  contentLanguage: OptionalToNullable<ApiAsset['content_language']>;
  visibility: AssetVisibility;
  tags: AdminAssetTag[];
  createdBy: OptionalToNullable<ApiAsset['created_by']>;
  createdAt: OptionalToNullable<ApiAsset['created_at']>;
  updatedAt: OptionalToNullable<ApiAsset['updated_at']>;
}

export interface AssetGrant {
  id: ApiAssetGrant['id'];
  assetId: ApiAssetGrant['asset_id'];
  grantType: AccessGrantType;
  granteeId: OptionalToNullable<ApiAssetGrant['grantee_id']>;
  grantedBy: OptionalToNullable<ApiAssetGrant['granted_by']>;
  createdAt: OptionalToNullable<ApiAssetGrant['created_at']>;
}

export interface PaginatedList<TItem> {
  items: TItem[];
  nextCursor: string | null;
}

export interface ListAdminAssetsInput {
  query?: string;
  visibility?: AssetVisibility | '';
  assetType?: AssetType | '';
  /** When set, lists only assets with this tag (canonical API tag name). */
  tagName?: string;
  cursor?: string | null;
  limit?: number;
}

export interface AdminAssetListResult extends PaginatedList<AdminAsset> {
  /** Tag names linked to at least one asset (same asset_type scope as the request). */
  linkedTagNames: string[];
}

export interface UpsertAdminAssetInput {
  title: ApiCreateAssetRequest['title'];
  description?: OptionalToNullable<ApiCreateAssetRequest['description']>;
  assetType: ApiCreateAssetRequest['asset_type'];
  fileName: ApiCreateAssetRequest['file_name'];
  resourceKey?: OptionalToNullable<ApiCreateAssetRequest['resource_key']>;
  contentType?: OptionalToNullable<ApiCreateAssetRequest['content_type']>;
  contentLanguage?: OptionalToNullable<ApiCreateAssetRequest['content_language']>;
  visibility: ApiCreateAssetRequest['visibility'];
  /**
   * Maps to API `client_tag`. Omit on update when the asset is expense- or invoice-tagged (API forbids the field).
   */
  clientTag?: ApiCreateAssetRequest['client_tag'];
}

/** Fields for `PATCH /v1/admin/assets/{id}` — omit keys that are unchanged. */
export interface UpdateAdminAssetPatchInput {
  title?: string;
  description?: string | null;
  assetType?: AssetType;
  fileName?: string;
  resourceKey?: string | null;
  contentType?: string | null;
  contentLanguage?: OptionalToNullable<ApiPartialUpdateAssetRequest['content_language']>;
  visibility?: AssetVisibility;
  /** Omit when the asset is expense- or invoice-tagged (API forbids the field). */
  clientTag?: typeof CLIENT_DOCUMENT_ASSET_TAG | null;
}

export interface CreatedAssetUpload {
  /** Null when absent, blank after trim, or not returned (trimmed presigned URL). */
  uploadUrl: OptionalToNullable<ApiCreateAssetResponse['upload_url']> | null;
  uploadMethod: string;
  uploadHeaders: NonNullable<ApiCreateAssetResponse['upload_headers']>;
  /** Null when absent or not a string in the payload (ISO date-time when present). */
  expiresAt: OptionalToNullable<ApiCreateAssetResponse['expires_at']> | null;
}

type ApiInitAssetContentReplaceResponse = ApiSchemas['InitAssetContentReplaceResponse'];

/** Presigned upload for replacing an existing asset file (step 1). */
export interface InitAdminAssetContentReplaceUpload {
  pendingS3Key: ApiInitAssetContentReplaceResponse['pending_s3_key'];
  /** Null when absent, blank after trim, or not returned (trimmed presigned URL). */
  uploadUrl: OptionalToNullable<ApiInitAssetContentReplaceResponse['upload_url']> | null;
  uploadMethod: string;
  uploadHeaders: NonNullable<ApiInitAssetContentReplaceResponse['upload_headers']>;
  /** Null when absent or not a string in the payload (ISO date-time when present). */
  expiresAt: OptionalToNullable<ApiInitAssetContentReplaceResponse['expires_at']> | null;
}

export interface CreateAssetGrantInput {
  grantType: ApiCreateAssetGrantRequest['grant_type'];
  granteeId?: OptionalToNullable<ApiCreateAssetGrantRequest['grantee_id']>;
}
