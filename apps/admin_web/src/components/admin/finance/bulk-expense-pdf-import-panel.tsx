'use client';

import { useState } from 'react';

import { StatusBanner } from '@/components/status-banner';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Button } from '@/components/ui/button';
import { FileUploadButton } from '@/components/ui/file-upload-button';
import { Select } from '@/components/ui/select';
import type { Vendor } from '@/types/vendors';

import { BulkExpenseImportJobsPanel } from './bulk-expense-import-jobs-panel';

interface BulkExpensePdfImportPanelProps {
  vendorOptions: Vendor[];
  isLoadingVendors: boolean;
  isBusy: boolean;
  error: string;
  onImport: (payload: { file: File; defaultVendorId: string }) => Promise<void>;
  onCancelBusy?: () => void;
  onAfterJobMutation?: () => void;
  className?: string;
}

/**
 * Combined-PDF import as a sub-accordion above the expenses table: the
 * import form, then the recent jobs as a nested record table. Collapsed by
 * default so the expenses list stays first.
 */
export function BulkExpensePdfImportPanel({
  vendorOptions,
  isLoadingVendors,
  isBusy,
  error,
  onImport,
  onCancelBusy,
  onAfterJobMutation,
  className,
}: BulkExpensePdfImportPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [defaultVendorId, setDefaultVendorId] = useState('');
  const [formKey, setFormKey] = useState(0);

  const vendorRequired = defaultVendorId.trim().length === 0;
  const submitDisabled = isBusy || vendorRequired || !file;

  async function handleSubmit() {
    if (!file || vendorRequired) {
      return;
    }
    await onImport({ file, defaultVendorId: defaultVendorId.trim() });
    setFile(null);
    setDefaultVendorId('');
    setFormKey((value) => value + 1);
  }

  return (
    <AdminDisclosure
      id='expense-bulk-import'
      title='Import from combined PDF'
      summary={isBusy ? 'Working…' : undefined}
      className={className}
    >
      <div className='space-y-4'>
        <p className='text-sm text-slate-600'>
          Upload one PDF that lists several expenses. Each extracted row becomes an expense sharing
          this attachment; rows without a matching vendor name use the default vendor. Processing
          runs in the background and may take a few minutes for large PDFs.
        </p>
        {error ? (
          <StatusBanner variant='error' title='Bulk import'>
            {error}
          </StatusBanner>
        ) : null}
        <form
          key={formKey}
          id='bulk-expense-pdf-import'
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <AdminFieldGrid columns={4}>
            <AdminField label='Default vendor' htmlFor='bulk-expense-pdf-default-vendor' span={2} required>
              <Select
                id='bulk-expense-pdf-default-vendor'
                value={defaultVendorId}
                onChange={(event) => setDefaultVendorId(event.target.value)}
                required
                aria-required
                disabled={isBusy}
              >
                <option value=''>{isLoadingVendors ? 'Loading vendors...' : 'Select default vendor'}</option>
                {vendorOptions.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                    {vendor.active ? '' : ' (Inactive)'}
                  </option>
                ))}
              </Select>
            </AdminField>
            <AdminField label='Combined PDF (max 15MB)' htmlFor='bulk-expense-pdf-file' span={2}>
              <FileUploadButton
                id='bulk-expense-pdf-file'
                accept='application/pdf'
                disabled={isBusy}
                selectedFileName={file?.name ?? null}
                emptyLabel='No file selected'
                buttonLabel='Choose PDF'
                onChange={(event) => {
                  const picked = event.target.files?.[0] ?? null;
                  setFile(picked);
                }}
              />
            </AdminField>
          </AdminFieldGrid>
          <div className='flex flex-wrap items-center justify-start gap-2'>
            <Button type='submit' disabled={submitDisabled} loading={isBusy} loadingLabel='Working…'>
              Parse PDF and create expenses
            </Button>
            {isBusy && onCancelBusy ? (
              <Button type='button' variant='outline' onClick={() => onCancelBusy()}>
                Stop waiting
              </Button>
            ) : null}
          </div>
        </form>
        <BulkExpenseImportJobsPanel onAfterMutation={onAfterJobMutation} />
      </div>
    </AdminDisclosure>
  );
}
