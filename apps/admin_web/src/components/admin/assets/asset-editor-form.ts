import type {
  AdminAsset,
  AdminAssetWriteContentLanguage,
  AssetVisibility,
  UpdateAdminAssetPatchInput,
} from '@/types/assets';

import { matchAdminSelectableContentLanguage } from '@/lib/format';
import { CLIENT_DOCUMENT_ASSET_TAG } from '@/types/assets';

export interface AssetFormState {
  title: string;
  description: string;
  resourceKey: string;
  visibility: AssetVisibility;
  /** BCP 47 tag or empty when unset / unknown */
  contentLanguage: string;
  /** Select value: empty string = no client tag; client_document = Client */
  clientTag: '' | typeof CLIENT_DOCUMENT_ASSET_TAG;
}

export const EMPTY_ASSET_FORM: AssetFormState = {
  title: '',
  description: '',
  resourceKey: '',
  visibility: 'restricted',
  contentLanguage: '',
  clientTag: '',
};

const RESOURCE_KEY_MAX_LENGTH = 64;

export function assetHasClientDocumentTag(asset: AdminAsset): boolean {
  return asset.tags.some((t) => t.name.toLowerCase() === CLIENT_DOCUMENT_ASSET_TAG);
}

function toContentLanguageSelectValue(asset: AdminAsset): string {
  const match = matchAdminSelectableContentLanguage(asset.contentLanguage);
  return match && match !== 'unrecognized' ? match : '';
}

function canonicalContentLanguageFromApi(value: string | null | undefined): string | null {
  const match = matchAdminSelectableContentLanguage(value);
  return match === 'unrecognized' ? null : match;
}

export function toAssetFormState(asset: AdminAsset): AssetFormState {
  return {
    title: asset.title,
    description: asset.description ?? '',
    resourceKey: asset.resourceKey ?? '',
    visibility: asset.visibility,
    contentLanguage: toContentLanguageSelectValue(asset),
    clientTag: assetHasClientDocumentTag(asset) ? CLIENT_DOCUMENT_ASSET_TAG : '',
  };
}

export function normalizeResourceKey(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, RESOURCE_KEY_MAX_LENGTH)
    .replaceAll(/-+$/g, '');
}

export function isPdfFile(file: File): boolean {
  const isPdfMime = !file.type || file.type === 'application/pdf';
  return isPdfMime && file.name.toLowerCase().endsWith('.pdf');
}

/** Resolve the select value to an API language, or `'unrecognized'` when it cannot be sent. */
export function resolveContentLanguage(
  value: string
): AdminAssetWriteContentLanguage | null | 'unrecognized' {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  return matchAdminSelectableContentLanguage(trimmed);
}

export function buildEditMetadataPatch(
  asset: AdminAsset,
  input: {
    title: string;
    description: string | null;
    resourceKey: string | null;
    visibility: AssetVisibility;
    contentLanguage: AdminAssetWriteContentLanguage | null;
    clientTagValue: typeof CLIENT_DOCUMENT_ASSET_TAG | null;
    isRestrictedSystemLinked: boolean;
  }
): UpdateAdminAssetPatchInput {
  const patch: UpdateAdminAssetPatchInput = {};
  if (input.title !== asset.title) {
    patch.title = input.title;
  }
  if (input.description !== (asset.description ?? null)) {
    patch.description = input.description;
  }
  if (input.resourceKey !== (asset.resourceKey ?? null)) {
    patch.resourceKey = input.resourceKey;
  }
  if (!input.isRestrictedSystemLinked && input.visibility !== asset.visibility) {
    patch.visibility = input.visibility;
  }
  const prevLangCanonical = canonicalContentLanguageFromApi(asset.contentLanguage);
  if (input.contentLanguage !== prevLangCanonical) {
    patch.contentLanguage = input.contentLanguage;
  }
  if (!input.isRestrictedSystemLinked) {
    const hadClient = assetHasClientDocumentTag(asset);
    const nextHasClient = input.clientTagValue === CLIENT_DOCUMENT_ASSET_TAG;
    if (hadClient !== nextHasClient) {
      patch.clientTag = input.clientTagValue;
    }
  }
  return patch;
}

/** Metadata patch for the current form against the stored asset (empty when nothing changed). */
export function metadataPatchFor(
  asset: AdminAsset,
  formState: AssetFormState,
  isRestrictedSystemLinked: boolean
): UpdateAdminAssetPatchInput {
  const language = resolveContentLanguage(formState.contentLanguage);
  return buildEditMetadataPatch(asset, {
    title: formState.title.trim(),
    description: formState.description.trim() || null,
    resourceKey: normalizeResourceKey(formState.resourceKey) || null,
    visibility: formState.visibility,
    contentLanguage: language === 'unrecognized' ? null : language,
    clientTagValue: formState.clientTag === CLIENT_DOCUMENT_ASSET_TAG ? CLIENT_DOCUMENT_ASSET_TAG : null,
    isRestrictedSystemLinked,
  });
}
