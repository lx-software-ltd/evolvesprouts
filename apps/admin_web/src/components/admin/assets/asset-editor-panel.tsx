'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

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

import {
  EMPTY_ASSET_FORM,
  isPdfFile,
  metadataPatchFor,
  normalizeResourceKey,
  resolveContentLanguage,
  toAssetFormState,
  type AssetFormState,
} from '@/components/admin/assets/asset-editor-form';
import { AssetShareLinkSection } from '@/components/admin/assets/asset-share-link-section';
import { StatusBanner } from '@/components/status-banner';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { ContentLanguageSelect } from '@/components/ui/content-language-select';
import { FileUploadButton } from '@/components/ui/file-upload-button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const ASSET_EDITOR_FORM_ID = 'admin-asset-editor-form';

export interface AssetEditorPanelProps {
  /** `null` renders the draft (create) editor. */
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
  /** Reports unsaved edits so the row switch guard can ask before discarding them. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Extra sections (for example access grants) rendered after the share link. */
  children?: ReactNode;
}

/** Editor rendered inside the expanded asset row. */
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
  onDirtyChange,
  children,
}: AssetEditorPanelProps) {
  const [formState, setFormState] = useState<AssetFormState>(() =>
    selectedAsset ? toAssetFormState(selectedAsset) : EMPTY_ASSET_FORM
  );
  const [formError, setFormError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [metadataSaveWarningAfterReplace, setMetadataSaveWarningAfterReplace] = useState(false);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const patchForm = useCallback(
    (patch: Partial<AssetFormState>) => {
      onDirtyChange?.(true);
      setFormState((previous) => ({ ...previous, ...patch }));
    },
    [onDirtyChange]
  );

  const isEditMode = Boolean(selectedAsset);
  const isExpenseLinked = Boolean(selectedAsset?.tags.some((t) => isExpenseAttachmentAssetTag(t.name)));
  const isInvoiceLinked = Boolean(selectedAsset?.tags.some((t) => isCustomerInvoiceAssetTag(t.name)));
  const isRestrictedSystemLinked = Boolean(selectedAsset && assetHasRestrictedSystemTag(selectedAsset));
  const canReplaceFile = isEditMode && Boolean(onReplaceFile) && !isRestrictedSystemLinked;

  const metadataPatch = useMemo(
    () => (selectedAsset ? metadataPatchFor(selectedAsset, formState, isRestrictedSystemLinked) : {}),
    [selectedAsset, formState, isRestrictedSystemLinked]
  );
  const hasMetadataChangesForSubmit = Object.keys(metadataPatch).length > 0;

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
    if (fileToUpload && !isPdfFile(fileToUpload)) {
      setFormError('Only PDF files are allowed.');
      return;
    }

    const normalizedResourceKey = normalizeResourceKey(formState.resourceKey);
    if (formState.resourceKey.trim() && !normalizedResourceKey) {
      setFormError('Resource key must include letters or numbers.');
      return;
    }
    const resourceKey = normalizedResourceKey || null;

    const contentLanguage = resolveContentLanguage(formState.contentLanguage);
    if (contentLanguage === 'unrecognized') {
      setFormError('Invalid language selection.');
      return;
    }

    const clientTagValue: typeof CLIENT_DOCUMENT_ASSET_TAG | null =
      formState.clientTag === CLIENT_DOCUMENT_ASSET_TAG ? CLIENT_DOCUMENT_ASSET_TAG : null;

    if (isEditMode && selectedAsset) {
      if (matchAdminSelectableContentLanguage(selectedAsset.contentLanguage) === 'unrecognized') {
        setFormError(
          'This asset has a language value that is not supported in the admin list. Contact engineering before saving, or the value will be cleared.'
        );
        return;
      }
      if (replacementFile && !isPdfFile(replacementFile)) {
        setFormError('Replacement file must be a PDF.');
        return;
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
        return;
      }
      onDirtyChange?.(false);
      return;
    }

    if (!fileToUpload) {
      setFormError('Select a PDF file to upload.');
      return;
    }
    onDirtyChange?.(false);
    await onCreate(
      {
        title,
        description: formState.description.trim() || null,
        fileName: fileToUpload.name || 'document.pdf',
        resourceKey,
        visibility: formState.visibility,
        contentLanguage,
        clientTag: clientTagValue,
      },
      fileToUpload
    );
  };

  const status = (
    <>
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
          The PDF was replaced. Metadata may not have saved; check the Validation message above or the
          Asset banner, then save again if needed.
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
    </>
  );

  return (
    <AdminEditorPanel
      status={<div className='space-y-2'>{status}</div>}
      actions={
        <AdminEditorActions
          mode={isEditMode ? 'edit' : 'create'}
          formId={ASSET_EDITOR_FORM_ID}
          isSaving={isSavingAsset}
          savingLabel={submitLoadingLabel}
          submitDisabled={isDeletingCurrentAsset || (hasPendingUpload && uploadState === 'failed')}
          submitLabel={submitLabel}
        />
      }
    >
      <form id={ASSET_EDITOR_FORM_ID} onSubmit={handleSubmit} className='space-y-4'>
        <AdminFieldGrid columns={4}>
          <AdminField label='Title' htmlFor='asset-title' span={2}>
            <Input
              id='asset-title'
              value={formState.title}
              onChange={(event) => patchForm({ title: event.target.value })}
              placeholder='Infant nutrition guide'
            />
          </AdminField>
          <AdminField label='Visibility' htmlFor='asset-visibility'>
            <Select
              id='asset-visibility'
              value={formState.visibility}
              disabled={isSavingAsset || isRestrictedSystemLinked}
              title={
                isRestrictedSystemLinked
                  ? 'Visibility must remain restricted for expense and invoice assets.'
                  : undefined
              }
              onChange={(event) => patchForm({ visibility: event.target.value as AssetVisibility })}
            >
              {ASSET_VISIBILITIES.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {formatEnumLabel(visibility)}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Resource key' htmlFor='asset-resource-key'>
            <Input
              id='asset-resource-key'
              value={formState.resourceKey}
              onChange={(event) => patchForm({ resourceKey: event.target.value })}
              placeholder='patience-free-guide'
            />
          </AdminField>

          <AdminField label='Tag' htmlFor='asset-tag'>
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
                  patchForm({
                    clientTag: event.target.value === CLIENT_DOCUMENT_ASSET_TAG ? CLIENT_DOCUMENT_ASSET_TAG : '',
                  })
                }
              >
                <option value=''>No tag</option>
                <option value={CLIENT_DOCUMENT_ASSET_TAG}>Client</option>
              </Select>
            )}
          </AdminField>
          <AdminField>
            <ContentLanguageSelect
              id='asset-content-language'
              label='Language'
              value={formState.contentLanguage}
              disabled={isSavingAsset}
              onChange={(next) => patchForm({ contentLanguage: next })}
            />
          </AdminField>
          {!isEditMode ? (
            <AdminField label='PDF file' htmlFor='asset-file-upload' span={2}>
              <FileUploadButton
                id='asset-file-upload'
                accept='application/pdf,.pdf'
                selectedFileName={selectedFile?.name ?? null}
                emptyLabel='No file chosen'
                inputAriaLabel='Upload PDF file'
                disabled={isSavingAsset}
                onChange={(event) => {
                  onDirtyChange?.(true);
                  setSelectedFile(event.target.files?.[0] ?? null);
                }}
              />
            </AdminField>
          ) : (
            <AdminField label='Current file' htmlFor='asset-file-name' span={2}>
              <Input id='asset-file-name' value={selectedAsset?.fileName || '—'} readOnly aria-readonly='true' />
            </AdminField>
          )}
          {isEditMode && selectedAsset ? (
            isRestrictedSystemLinked ? (
              <AdminField
                label='Replace PDF'
                span={2}
                hint={
                  isInvoiceLinked
                    ? 'File replacement is not available for assets linked to a customer invoice.'
                    : 'File replacement is not available for assets linked to an expense.'
                }
              >
                <Input value='Not available' readOnly aria-readonly='true' aria-label='Replace PDF' />
              </AdminField>
            ) : canReplaceFile ? (
              <AdminField
                label='Replace PDF'
                htmlFor='asset-replace-file-upload'
                span={2}
                hint='Choose a new PDF and save to upload it. Grants and share links for this asset stay the same.'
              >
                <FileUploadButton
                  id='asset-replace-file-upload'
                  accept='application/pdf,.pdf'
                  selectedFileName={replacementFile?.name ?? null}
                  emptyLabel='No replacement file chosen'
                  inputAriaLabel='Replace PDF file'
                  disabled={isSavingAsset}
                  onChange={(event) => {
                    onDirtyChange?.(true);
                    setReplacementFile(event.target.files?.[0] ?? null);
                  }}
                />
              </AdminField>
            ) : null
          ) : null}
          <AdminField label='Description' htmlFor='asset-description' span='full'>
            <Textarea
              id='asset-description'
              rows={3}
              value={formState.description}
              onChange={(event) => patchForm({ description: event.target.value })}
              placeholder='Optional summary shown in client applications.'
            />
          </AdminField>
        </AdminFieldGrid>
      </form>

      {isEditMode && selectedAsset ? (
        <AdminDisclosure id={`asset-share-link-${selectedAsset.id}`} title='Share link'>
          <AssetShareLinkSection selectedAsset={selectedAsset} />
        </AdminDisclosure>
      ) : null}
      {children}
    </AdminEditorPanel>
  );
}
