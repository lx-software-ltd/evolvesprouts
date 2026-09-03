'use client';

import { useMemo, useState, type FormEvent } from 'react';

import type {
  AdminAsset,
  AdminAssetWriteContentLanguage,
  AssetVisibility,
  UpdateAdminAssetPatchInput,
} from '@/types/assets';

import { formatEnumLabel, matchAdminSelectableContentLanguage } from '@/lib/format';
import {
  ASSET_VISIBILITIES,
  CLIENT_DOCUMENT_ASSET_TAG,
  assetHasRestrictedSystemTag,
  isCustomerInvoiceAssetTag,
  isExpenseAttachmentAssetTag,
} from '@/types/assets';

import type { AssetUploadPhase } from '@/hooks/use-asset-mutations';

import { AssetShareLinkSection } from '@/components/admin/assets/asset-share-link-section';
import { StatusBanner } from '@/components/status-banner';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { Button } from '@/components/ui/button';
import { ContentLanguageSelect } from '@/components/ui/content-language-select';
import { FileUploadButton } from '@/components/ui/file-upload-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const ASSET_EDITOR_FORM_ID = 'admin-asset-editor-form';

interface AssetEditorPanelProps {
  selectedAsset: AdminAsset | null;
  isSavingAsset: boolean;
  isDeletingCurrentAsset: boolean;
  assetMutationError: string;
  uploadState: 'idle' | 'uploading' | 'failed' | 'succeeded';
  uploadPhase: AssetUploadPhase | null;
  uploadError: string;
  hasPendingUpload: boolean;
  onRetryUpload: () => Promise<void>;
  /** When set in edit mode (non–expense- or invoice-linked assets), user may pick a new PDF and save to replace file content. */
  onReplaceFile?: (file: File) => Promise<boolean>;
  onCreate: (
    payload: {
      title: string;
      description: string | null;
      fileName: string;
      resourceKey: string | null;
      visibility: AssetVisibility;
      contentLanguage: AdminAssetWriteContentLanguage | null;
      clientTag: typeof CLIENT_DOCUMENT_ASSET_TAG | null;
    },
    file: File
  ) => Promise<void>;
  onUpdate: (assetId: string, payload: UpdateAdminAssetPatchInput) => Promise<boolean>;
  onStartCreate: () => void;
}

interface AssetFormState {
  title: string;
  description: string;
  resourceKey: string;
  visibility: AssetVisibility;
  /** BCP 47 tag or empty when unset / unknown */
  contentLanguage: string;
  /** Select value: empty string = no client tag; client_document = Client */
  clientTag: '' | typeof CLIENT_DOCUMENT_ASSET_TAG;
}

const EMPTY_ASSET_FORM: AssetFormState = {
  title: '',
  description: '',
  resourceKey: '',
  visibility: 'restricted',
  contentLanguage: '',
  clientTag: '',
};

const RESOURCE_KEY_MAX_LENGTH = 64;

function assetHasClientDocumentTag(asset: AdminAsset): boolean {
  return asset.tags.some((t) => t.name.toLowerCase() === CLIENT_DOCUMENT_ASSET_TAG);
}

function toContentLanguageSelectValue(asset: AdminAsset): string {
  const match = matchAdminSelectableContentLanguage(asset.contentLanguage);
  return match && match !== 'unrecognized' ? match : '';
}

function canonicalContentLanguageFromApi(value: string | null | undefined): string | null {
  const match = matchAdminSelectableContentLanguage(value);
  if (match === 'unrecognized') {
    return null;
  }
  return match;
}

function toFormState(asset: AdminAsset): AssetFormState {
  return {
    title: asset.title,
    description: asset.description ?? '',
    resourceKey: asset.resourceKey ?? '',
    visibility: asset.visibility,
    contentLanguage: toContentLanguageSelectValue(asset),
    clientTag: assetHasClientDocumentTag(asset) ? CLIENT_DOCUMENT_ASSET_TAG : '',
  };
}

function normalizeResourceKey(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, RESOURCE_KEY_MAX_LENGTH)
    .replaceAll(/-+$/g, '');
}

function buildEditMetadataPatch(
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

export function AssetEditorPanel({
  selectedAsset,
  isSavingAsset,
  isDeletingCurrentAsset,
  assetMutationError,
  uploadState,
  uploadPhase,
  uploadError,
  hasPendingUpload,
  onRetryUpload,
  onReplaceFile,
  onCreate,
  onUpdate,
  onStartCreate,
}: AssetEditorPanelProps) {
  const [formState, setFormState] = useState<AssetFormState>(() =>
    selectedAsset ? toFormState(selectedAsset) : EMPTY_ASSET_FORM
  );
  const [formError, setFormError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [metadataSaveWarningAfterReplace, setMetadataSaveWarningAfterReplace] = useState(false);

  const isEditMode = Boolean(selectedAsset);
  const isExpenseLinked = Boolean(
    selectedAsset?.tags.some((t) => isExpenseAttachmentAssetTag(t.name))
  );
  const isInvoiceLinked = Boolean(
    selectedAsset?.tags.some((t) => isCustomerInvoiceAssetTag(t.name))
  );
  const isRestrictedSystemLinked = Boolean(
    selectedAsset && assetHasRestrictedSystemTag(selectedAsset)
  );
  const canReplaceFile = isEditMode && Boolean(onReplaceFile) && !isRestrictedSystemLinked;

  const metadataPatch = useMemo(() => {
    if (!selectedAsset) {
      return {} as UpdateAdminAssetPatchInput;
    }
    const title = formState.title.trim();
    const normalizedResourceKey = normalizeResourceKey(formState.resourceKey);
    const resourceKey = normalizedResourceKey || null;
    const contentLanguageTrimmed = formState.contentLanguage.trim();
    let contentLanguage: AdminAssetWriteContentLanguage | null = null;
    if (contentLanguageTrimmed !== '') {
      const matched = matchAdminSelectableContentLanguage(contentLanguageTrimmed);
      if (matched !== 'unrecognized') {
        contentLanguage = matched;
      }
    }
    const clientTagValue: typeof CLIENT_DOCUMENT_ASSET_TAG | null =
      formState.clientTag === CLIENT_DOCUMENT_ASSET_TAG ? CLIENT_DOCUMENT_ASSET_TAG : null;
    return buildEditMetadataPatch(selectedAsset, {
      title,
      description: formState.description.trim() || null,
      resourceKey,
      visibility: formState.visibility,
      contentLanguage,
      clientTagValue,
      isRestrictedSystemLinked,
    });
  }, [selectedAsset, formState, isRestrictedSystemLinked]);

  const hasMetadataChangesForSubmit = Object.keys(metadataPatch).length > 0;

  const cardTitle = isEditMode ? 'Edit Asset' : 'Create Asset';
  const cardDescription = isEditMode
    ? 'Update metadata and visibility, optionally replace the PDF file, and manage sharing. Cancel to create a new asset.'
    : 'Create a new PDF asset or select a row below to edit. Upload starts automatically with a presigned URL.';

  const submitLabel = useMemo(() => {
    if (isEditMode && replacementFile) {
      return hasMetadataChangesForSubmit ? 'Save and replace' : 'Replace file';
    }
    return isEditMode ? 'Save changes' : 'Create asset';
  }, [isEditMode, replacementFile, hasMetadataChangesForSubmit]);
  const submitLoadingLabel = isEditMode && replacementFile ? 'Replacing…' : 'Saving…';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setMetadataSaveWarningAfterReplace(false);

    const title = formState.title.trim();
    if (!title) {
      setFormError('Title is required.');
      return;
    }

    const fileToUpload = selectedFile;
    if (!isEditMode && !fileToUpload) {
      setFormError('Select a PDF file to upload.');
      return;
    }

    if (fileToUpload) {
      const isPdfMime = !fileToUpload.type || fileToUpload.type === 'application/pdf';
      const isPdfExtension = fileToUpload.name.toLowerCase().endsWith('.pdf');
      if (!isPdfMime || !isPdfExtension) {
        setFormError('Only PDF files are allowed.');
        return;
      }
    }

    const normalizedResourceKey = normalizeResourceKey(formState.resourceKey);
    if (formState.resourceKey.trim() && !normalizedResourceKey) {
      setFormError('Resource key must include letters or numbers.');
      return;
    }
    const resourceKey = normalizedResourceKey || null;

    const contentLanguageTrimmed = formState.contentLanguage.trim();
    let contentLanguage: AdminAssetWriteContentLanguage | null = null;
    if (contentLanguageTrimmed !== '') {
      const matched = matchAdminSelectableContentLanguage(contentLanguageTrimmed);
      if (matched === 'unrecognized') {
        setFormError('Invalid language selection.');
        return;
      }
      contentLanguage = matched;
    }

    const clientTagValue: typeof CLIENT_DOCUMENT_ASSET_TAG | null =
      formState.clientTag === CLIENT_DOCUMENT_ASSET_TAG ? CLIENT_DOCUMENT_ASSET_TAG : null;

    if (isEditMode && selectedAsset) {
      const storedLang = matchAdminSelectableContentLanguage(selectedAsset.contentLanguage);
      if (storedLang === 'unrecognized') {
        setFormError(
          'This asset has a language value that is not supported in the admin list. Contact engineering before saving, or the value will be cleared.'
        );
        return;
      }

      if (replacementFile) {
        const isPdfMime = !replacementFile.type || replacementFile.type === 'application/pdf';
        const isPdfExtension = replacementFile.name.toLowerCase().endsWith('.pdf');
        if (!isPdfMime || !isPdfExtension) {
          setFormError('Replacement file must be a PDF.');
          return;
        }
      }

      const patch = metadataPatch;
      if (replacementFile && onReplaceFile) {
        const replaceOk = await onReplaceFile(replacementFile);
        if (!replaceOk) {
          if (Object.keys(patch).length > 0) {
            setFormError(
              'File replacement did not finish, so metadata was not saved. Fix the error in the Asset banner or retry, then save again.'
            );
          }
          return;
        }
      }
      if (Object.keys(patch).length > 0) {
        const updateOk = await onUpdate(selectedAsset.id, patch);
        if (!updateOk) {
          if (replacementFile) {
            setMetadataSaveWarningAfterReplace(true);
          }
          setFormError(
            'Metadata may not have saved. The new file may already be live. Refresh the list or fix the error in the Asset banner and save again.'
          );
          return;
        }
      }
      if (Object.keys(patch).length === 0 && !replacementFile) {
        setFormError('No changes to save.');
      }
      return;
    }

    const core = {
      title,
      description: formState.description.trim() || null,
      fileName: fileToUpload?.name || selectedAsset?.fileName || 'document.pdf',
      resourceKey,
      visibility: formState.visibility,
      contentLanguage,
    };

    if (!fileToUpload) {
      setFormError('Select a PDF file to upload.');
      return;
    }
    await onCreate({ ...core, clientTag: clientTagValue }, fileToUpload);
  };

  const handleCancel = () => {
    onStartCreate();
    setFormState(EMPTY_ASSET_FORM);
    setSelectedFile(null);
    setReplacementFile(null);
    setFormError('');
  };

  return (
    <AdminEditorCard
      title={cardTitle}
      description={cardDescription}
      actions={
        <>
          {isEditMode ? (
            <Button
              type='button'
              variant='secondary'
              onClick={handleCancel}
              disabled={isSavingAsset || isDeletingCurrentAsset}
            >
              Cancel
            </Button>
          ) : null}
          <Button
            type='submit'
            form={ASSET_EDITOR_FORM_ID}
            disabled={isDeletingCurrentAsset || (hasPendingUpload && uploadState === 'failed')}
            loading={isSavingAsset}
            loadingLabel={submitLoadingLabel}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      {assetMutationError ? (
        <StatusBanner variant='error' title='Asset'>
          {assetMutationError}
        </StatusBanner>
      ) : null}

      {formError ? (
        <StatusBanner variant='error' title='Validation'>
          {formError}
        </StatusBanner>
      ) : null}

      {uploadState === 'uploading' ? (
        <StatusBanner variant='info' title='Uploading'>
          {uploadPhase === 'complete'
            ? 'Finalizing file replacement...'
            : isEditMode
              ? 'Uploading PDF...'
              : 'Uploading PDF content to S3...'}
        </StatusBanner>
      ) : null}

      {uploadState === 'succeeded' && metadataSaveWarningAfterReplace ? (
        <StatusBanner variant='info' title='File replaced'>
          The PDF was replaced. Metadata may not have saved; check the Validation message above or
          the Asset banner, then save again if needed.
        </StatusBanner>
      ) : null}

      {uploadState === 'succeeded' && !metadataSaveWarningAfterReplace ? (
        <StatusBanner variant='success' title='Upload complete'>
          {isEditMode ? 'PDF updated successfully.' : 'PDF content uploaded successfully.'}
        </StatusBanner>
      ) : null}

      {uploadState === 'failed' ? (
        <StatusBanner variant='error' title='Upload failed'>
          {uploadError || 'The PDF upload failed.'}
          {hasPendingUpload ? (
            <button
              type='button'
              className='ml-2 text-xs underline underline-offset-2'
              onClick={() => void onRetryUpload()}
            >
              Retry upload
            </button>
          ) : null}
        </StatusBanner>
      ) : null}

      <form id={ASSET_EDITOR_FORM_ID} onSubmit={handleSubmit} className='space-y-4'>
        <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
          <div className='space-y-2'>
            <Label htmlFor='asset-title'>Title *</Label>
            <Input
              id='asset-title'
              value={formState.title}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, title: event.target.value }))
              }
              placeholder='Infant nutrition guide'
              required
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='asset-visibility'>Visibility *</Label>
            <Select
              id='asset-visibility'
              value={formState.visibility}
              disabled={isSavingAsset || isRestrictedSystemLinked}
              title={
                isRestrictedSystemLinked
                  ? 'Visibility must remain restricted for expense and invoice assets.'
                  : undefined
              }
              onChange={(event) =>
                setFormState((previous) => ({
                  ...previous,
                  visibility: event.target.value as AssetVisibility,
                }))
              }
            >
              {ASSET_VISIBILITIES.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {formatEnumLabel(visibility)}
                </option>
              ))}
            </Select>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='asset-resource-key'>Resource key</Label>
            <Input
              id='asset-resource-key'
              value={formState.resourceKey}
              onChange={(event) =>
                setFormState((previous) => ({
                  ...previous,
                  resourceKey: event.target.value,
                }))
              }
              placeholder='patience-free-guide'
            />
          </div>
          {!isEditMode ? (
            <div className='space-y-2'>
              <Label htmlFor='asset-file-upload'>PDF file *</Label>
              <FileUploadButton
                id='asset-file-upload'
                accept='application/pdf,.pdf'
                selectedFileName={selectedFile?.name ?? null}
                emptyLabel='No file chosen'
                inputAriaLabel='Upload PDF file'
                disabled={isSavingAsset}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setSelectedFile(file);
                }}
              />
            </div>
          ) : selectedAsset ? (
            <AssetShareLinkSection selectedAsset={selectedAsset} />
          ) : null}
          {isEditMode && selectedAsset ? (
            <div className='space-y-2 lg:col-span-2'>
              <Label htmlFor='asset-file-name'>Current file</Label>
              <Input id='asset-file-name' value={selectedAsset.fileName || '—'} disabled readOnly />
              {isRestrictedSystemLinked ? (
                <p className='text-xs text-slate-600'>
                  {isInvoiceLinked
                    ? 'File replacement is not available for assets linked to a customer invoice.'
                    : 'File replacement is not available for assets linked to an expense.'}
                </p>
              ) : canReplaceFile ? (
                <div className='space-y-2 pt-1'>
                  <Label htmlFor='asset-replace-file-upload'>Replace PDF</Label>
                  <FileUploadButton
                    id='asset-replace-file-upload'
                    accept='application/pdf,.pdf'
                    selectedFileName={replacementFile?.name ?? null}
                    emptyLabel='No replacement file chosen'
                    inputAriaLabel='Replace PDF file'
                    disabled={isSavingAsset}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setReplacementFile(file);
                    }}
                  />
                  <p className='text-xs text-slate-600'>
                    Choose a new PDF and click Save changes to upload it. Grants and share links for
                    this asset stay the same.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-end'>
          <div className='space-y-2'>
            <Label htmlFor='asset-tag'>Tag</Label>
            {isEditMode && isInvoiceLinked ? (
              <Select
                id='asset-tag'
                value='invoice'
                disabled
                aria-label='Tag (linked to customer invoice; not editable)'
                title='Tags cannot be changed for assets linked to a customer invoice.'
              >
                <option value='invoice'>Invoices</option>
              </Select>
            ) : isEditMode && isExpenseLinked ? (
              <Select
                id='asset-tag'
                value='expense'
                disabled
                aria-label='Tag (linked to expense; not editable)'
                title='Tags cannot be changed for assets linked to an expense.'
              >
                <option value='expense'>Expense</option>
              </Select>
            ) : (
              <Select
                id='asset-tag'
                value={formState.clientTag}
                disabled={isSavingAsset}
                onChange={(event) =>
                  setFormState((previous) => ({
                    ...previous,
                    clientTag:
                      event.target.value === CLIENT_DOCUMENT_ASSET_TAG
                        ? CLIENT_DOCUMENT_ASSET_TAG
                        : '',
                  }))
                }
              >
                <option value=''>No tag</option>
                <option value={CLIENT_DOCUMENT_ASSET_TAG}>Client</option>
              </Select>
            )}
          </div>
          <ContentLanguageSelect
            id='asset-content-language'
            label='Language'
            value={formState.contentLanguage}
            disabled={isSavingAsset}
            onChange={(next) =>
              setFormState((previous) => ({ ...previous, contentLanguage: next }))
            }
          />
        </div>

        <div className='space-y-2'>
          <Label htmlFor='asset-description'>Description</Label>
          <Textarea
            id='asset-description'
            rows={3}
            value={formState.description}
            onChange={(event) =>
              setFormState((previous) => ({ ...previous, description: event.target.value }))
            }
            placeholder='Optional summary shown in client applications.'
          />
        </div>
      </form>
    </AdminEditorCard>
  );
}
