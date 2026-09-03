'use client';

import { useEffect, useState } from 'react';

import { InboxImportStatus } from './inbox-import-status';

import { StatusBanner } from '@/components/status-banner';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Button } from '@/components/ui/button';
import { FileUploadButton } from '@/components/ui/file-upload-button';
import { Input } from '@/components/ui/input';
import { toErrorMessage } from '@/hooks/hook-errors';
import { createAdminAsset, deleteAdminAsset, uploadFileToPresignedUrl } from '@/lib/assets-api';
import {
  createWhatsAppExportImportJob,
  listInboxImportJobs,
  type InboxImportJobSummary,
} from '@/lib/inbox-import-api';

const MAX_EXPORT_BYTES = 15 * 1024 * 1024;
const IMPORT_FORM_ID = 'whatsapp-export-import';

export interface WhatsAppExportImportPanelProps {
  /** Called once a job is queued so the conversations list can refetch. */
  onImported?: () => void | Promise<unknown>;
  className?: string;
}

/**
 * Business App chat export import as a sub-accordion between the filters and
 * the WhatsApp conversations table. Collapsed by default so the list stays
 * first; the latest job status shows inside the accordion.
 */
export function WhatsAppExportImportPanel({ onImported, className }: WhatsAppExportImportPanelProps) {
  const [exportFile, setExportFile] = useState<File | null>(null);
  const [counterpartyWaId, setCounterpartyWaId] = useState('');
  const [businessNames, setBusinessNames] = useState('');
  const [importJob, setImportJob] = useState<InboxImportJobSummary | null>(null);
  const [importError, setImportError] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listInboxImportJobs('/v1/admin/whatsapp/import-jobs')
      .then((jobs) => {
        if (!cancelled) {
          setImportJob(jobs[0] ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImportJob(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleImportExport() {
    if (!exportFile) {
      return;
    }
    if (exportFile.size > MAX_EXPORT_BYTES) {
      setImportError('Export file exceeds 15MB.');
      return;
    }
    setIsImporting(true);
    setImportError('');
    let uploadedAssetId: string | null = null;
    try {
      const createdAsset = await createAdminAsset({
        title: exportFile.name,
        description: 'WhatsApp chat export',
        assetType: 'document',
        fileName: exportFile.name,
        contentType: exportFile.type || 'application/octet-stream',
        visibility: 'restricted',
      });
      if (!createdAsset.asset?.id || !createdAsset.upload.uploadUrl) {
        throw new Error('Could not prepare the WhatsApp export upload.');
      }
      uploadedAssetId = createdAsset.asset.id;
      await uploadFileToPresignedUrl({
        uploadUrl: createdAsset.upload.uploadUrl,
        uploadMethod: createdAsset.upload.uploadMethod,
        uploadHeaders: createdAsset.upload.uploadHeaders,
        file: exportFile,
      });
      const names = businessNames
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const job = await createWhatsAppExportImportJob({
        attachmentAssetId: uploadedAssetId,
        counterpartyWaId: counterpartyWaId.trim() || undefined,
        businessDisplayNames: names,
      });
      setImportJob(job);
      setExportFile(null);
      await onImported?.();
    } catch (error) {
      if (uploadedAssetId) {
        try {
          await deleteAdminAsset(uploadedAssetId);
        } catch {
          // Keep the original import error.
        }
      }
      setImportError(toErrorMessage(error, 'Could not import the WhatsApp export.'));
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <AdminDisclosure
      id='whatsapp-export-import-section'
      title='Import WhatsApp export'
      summary={isImporting ? 'Importing…' : undefined}
      className={className}
    >
      <div className='space-y-4'>
        <p className='text-sm text-slate-600'>
          Cloud API cannot pull old WhatsApp chats. Upload a Business App .txt or .zip export.
          Contacts are created when missing; no new sales leads are opened.
        </p>
        {importError ? (
          <StatusBanner variant='error' title='WhatsApp export'>
            {importError}
          </StatusBanner>
        ) : null}
        <InboxImportStatus job={importJob} />
        <form
          id={IMPORT_FORM_ID}
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault();
            void handleImportExport();
          }}
        >
          <AdminFieldGrid columns={4}>
            <AdminField label='Chat export (.txt or .zip, max 15MB)' htmlFor='whatsapp-export-file' span={2}>
              <FileUploadButton
                id='whatsapp-export-file'
                accept='.txt,.zip,text/plain,application/zip'
                disabled={isImporting}
                selectedFileName={exportFile?.name ?? null}
                emptyLabel='No file selected'
                buttonLabel='Choose export'
                onChange={(event) => {
                  setExportFile(event.target.files?.[0] ?? null);
                }}
              />
            </AdminField>
            <AdminField label='Counterparty WhatsApp number (optional)' htmlFor='whatsapp-export-counterparty'>
              <Input
                id='whatsapp-export-counterparty'
                value={counterpartyWaId}
                onChange={(event) => setCounterpartyWaId(event.target.value)}
                placeholder='85291234567'
                disabled={isImporting}
                autoComplete='off'
              />
            </AdminField>
            <AdminField
              label='Business display names (optional, comma-separated)'
              htmlFor='whatsapp-export-business-names'
            >
              <Input
                id='whatsapp-export-business-names'
                value={businessNames}
                onChange={(event) => setBusinessNames(event.target.value)}
                placeholder='Names that are outbound in the export'
                disabled={isImporting}
                autoComplete='off'
              />
            </AdminField>
          </AdminFieldGrid>
          <div className='flex flex-wrap items-center justify-start gap-2'>
            <Button type='submit' disabled={!exportFile} loading={isImporting} loadingLabel='Importing…'>
              Import export
            </Button>
          </div>
        </form>
      </div>
    </AdminDisclosure>
  );
}
