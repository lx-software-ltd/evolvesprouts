'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { StatusBanner } from '@/components/status-banner';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { FileUploadButton } from '@/components/ui/file-upload-button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { getAdminDefaultCurrencyCode } from '@/lib/config';
import { formatEnumLabel, getCurrencyOptions } from '@/lib/format';
import {
  EXPENSE_STATUSES,
  type Expense,
  type ExpenseLineItem,
  type ExpenseStatus,
  type UpsertExpenseInput,
} from '@/types/expenses';
import type { Vendor } from '@/types/vendors';

type ExpenseEditorInput = Omit<UpsertExpenseInput, 'attachmentAssetIds'>;

interface ExpensesEditorPanelProps {
  /** `null` renders the draft (create) editor. */
  selectedExpense: Expense | null;
  vendorOptions: Vendor[];
  isLoadingVendors: boolean;
  isSaving: boolean;
  isUploadingFiles: boolean;
  mutationError: string;
  onCreate: (payload: { input: ExpenseEditorInput; files: File[] }) => Promise<void>;
  onUpdate: (payload: {
    expenseId: string;
    input: ExpenseEditorInput;
    newFiles: File[];
    existingAttachmentAssetIds: string[];
  }) => Promise<void>;
  onAmend: (payload: {
    expenseId: string;
    input: ExpenseEditorInput;
    newFiles: File[];
    existingAttachmentAssetIds: string[];
  }) => Promise<void>;
  /** Reports unsaved edits so the row hook can guard row switches. */
  onDirtyChange?: (dirty: boolean) => void;
}

function toLineItemsJson(value: ExpenseLineItem[]): string {
  return JSON.stringify(
    value.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      amount: item.amount,
    })),
    null,
    2
  );
}

function lineItemDecimalFromJson(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function parseLineItemsJson(value: string): ExpenseLineItem[] {
  if (!value.trim()) {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Line items must be a JSON array.');
  }
  return parsed.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Each line item must be an object.');
    }
    const record = entry as Record<string, unknown>;
    return {
      description: typeof record.description === 'string' ? record.description : null,
      quantity: lineItemDecimalFromJson(record.quantity),
      unitPrice: lineItemDecimalFromJson(record.unit_price),
      amount: lineItemDecimalFromJson(record.amount),
    };
  });
}

/**
 * Body of an expanded expense row: fields in 4-per-row grids, then line
 * items and attachments as sub-accordions. Mounted only while the row is
 * open, so field state resets naturally between records.
 */
export function ExpensesEditorPanel({
  selectedExpense,
  vendorOptions,
  isLoadingVendors,
  isSaving,
  isUploadingFiles,
  mutationError,
  onCreate,
  onUpdate,
  onAmend,
  onDirtyChange,
}: ExpensesEditorPanelProps) {
  const currencyOptions = getCurrencyOptions();
  const [status, setStatus] = useState<ExpenseStatus>(selectedExpense?.status ?? 'submitted');
  const [vendorId, setVendorId] = useState(selectedExpense?.vendorId ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(selectedExpense?.invoiceNumber ?? '');
  const [invoiceDate, setInvoiceDate] = useState(selectedExpense?.invoiceDate ?? '');
  const [dueDate, setDueDate] = useState(selectedExpense?.dueDate ?? '');
  const [currency, setCurrency] = useState(selectedExpense?.currency ?? getAdminDefaultCurrencyCode());
  const [subtotal, setSubtotal] = useState(selectedExpense?.subtotal ?? '');
  const [tax, setTax] = useState(selectedExpense?.tax ?? '');
  const [total, setTotal] = useState(selectedExpense?.total ?? '');
  const [notes, setNotes] = useState(selectedExpense?.notes ?? '');
  const [lineItemsJson, setLineItemsJson] = useState(
    selectedExpense ? toLineItemsJson(selectedExpense.lineItems) : '[]'
  );
  const [lineItemsError, setLineItemsError] = useState('');
  const [lineItemsOpen, setLineItemsOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [parseRequested, setParseRequested] = useState(!selectedExpense);
  const [carryExistingAttachments, setCarryExistingAttachments] = useState(true);

  const dirtyRef = useRef(false);
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });
  useEffect(() => {
    return () => {
      onDirtyChangeRef.current?.(false);
    };
  }, []);
  function touch<TValue>(setter: (value: TValue) => void) {
    return (value: TValue) => {
      if (!dirtyRef.current) {
        dirtyRef.current = true;
        onDirtyChangeRef.current?.(true);
      }
      setter(value);
    };
  }

  const isEditMode = Boolean(selectedExpense);
  const isTerminal = selectedExpense
    ? selectedExpense.status === 'paid' ||
      selectedExpense.status === 'voided' ||
      selectedExpense.status === 'amended'
    : false;
  const trimmedVendorId = vendorId.trim();
  const vendorRequired = !isEditMode && trimmedVendorId.length === 0;
  const isSubmitDisabled = isSaving || isUploadingFiles || vendorRequired;

  const selectedAttachmentAssetIds = useMemo(
    () => selectedExpense?.attachments.map((attachment) => attachment.assetId) ?? [],
    [selectedExpense]
  );
  const existingAttachmentCount = selectedExpense?.attachments.length ?? 0;
  const lineItemCount = useMemo(() => {
    try {
      return parseLineItemsJson(lineItemsJson).length;
    } catch {
      return null;
    }
  }, [lineItemsJson]);

  async function handleSave() {
    if (vendorRequired) {
      return;
    }
    let parsedLineItems: ExpenseLineItem[] = [];
    try {
      parsedLineItems = parseLineItemsJson(lineItemsJson);
      setLineItemsError('');
    } catch (error) {
      setLineItemsError(error instanceof Error ? error.message : 'Line items JSON is invalid.');
      setLineItemsOpen(true);
      return;
    }

    const payloadInput: ExpenseEditorInput = {
      status,
      vendorId: vendorId.trim() || null,
      invoiceNumber: invoiceNumber.trim() || null,
      invoiceDate: invoiceDate.trim() || null,
      dueDate: dueDate.trim() || null,
      currency: currency.trim() || null,
      subtotal: subtotal.trim() || null,
      tax: tax.trim() || null,
      total: total.trim() || null,
      notes: notes.trim() || null,
      lineItems: parsedLineItems,
      parseRequested,
    };

    try {
      if (!selectedExpense) {
        await onCreate({ input: payloadInput, files });
      } else {
        const existingAttachmentAssetIds = carryExistingAttachments ? selectedAttachmentAssetIds : [];
        const payload = {
          expenseId: selectedExpense.id,
          input: payloadInput,
          newFiles: files,
          existingAttachmentAssetIds,
        };
        if (isTerminal) {
          await onAmend(payload);
        } else {
          await onUpdate(payload);
        }
      }
      dirtyRef.current = false;
      onDirtyChangeRef.current?.(false);
      setFiles([]);
    } catch {
      // Errors are handled by hook state for actionable user feedback.
    }
  }

  const primaryLabel = isTerminal ? 'Create amendment' : selectedExpense ? 'Update expense' : 'Submit expense';
  const attachmentsSummary = [
    existingAttachmentCount > 0 ? `${existingAttachmentCount} existing` : null,
    files.length > 0 ? `${files.length} new` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <AdminEditorPanel
      status={
        mutationError ? (
          <StatusBanner variant='error' title='Expense'>
            {mutationError}
          </StatusBanner>
        ) : null
      }
      actions={
        <AdminEditorActions
          mode={isEditMode ? 'edit' : 'create'}
          onSubmit={() => void handleSave()}
          isSaving={isSaving || isUploadingFiles}
          submitDisabled={isSubmitDisabled}
          submitLabel={primaryLabel}
        />
      }
    >
      <AdminFieldGrid columns={4}>
        <AdminField label='Vendor' htmlFor='expense-vendor' span={2} required={!isEditMode}>
          <Select
            id='expense-vendor'
            value={vendorId}
            onChange={(event) => touch(setVendorId)(event.target.value)}
            required={!isEditMode}
            aria-required={!isEditMode ? true : undefined}
          >
            <option value=''>{isLoadingVendors ? 'Loading vendors...' : 'Select vendor'}</option>
            {vendorOptions.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
                {vendor.active ? '' : ' (Inactive)'}
              </option>
            ))}
          </Select>
        </AdminField>
        <AdminField label='Invoice number' htmlFor='expense-invoice-number'>
          <Input
            id='expense-invoice-number'
            value={invoiceNumber}
            onChange={(event) => touch(setInvoiceNumber)(event.target.value)}
          />
        </AdminField>
        <AdminField label='Status' htmlFor='expense-status'>
          <Select
            id='expense-status'
            value={status}
            onChange={(event) => touch(setStatus)(event.target.value as ExpenseStatus)}
          >
            {EXPENSE_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {formatEnumLabel(entry)}
              </option>
            ))}
          </Select>
        </AdminField>
      </AdminFieldGrid>
      <AdminFieldGrid columns={4}>
        <AdminField label='Invoice date' htmlFor='expense-invoice-date'>
          <Input
            id='expense-invoice-date'
            type='date'
            value={invoiceDate}
            onChange={(event) => touch(setInvoiceDate)(event.target.value)}
          />
        </AdminField>
        <AdminField label='Due date' htmlFor='expense-due-date'>
          <Input
            id='expense-due-date'
            type='date'
            value={dueDate}
            onChange={(event) => touch(setDueDate)(event.target.value)}
          />
        </AdminField>
        <AdminField label='Currency' htmlFor='expense-currency'>
          <Select
            id='expense-currency'
            value={currency}
            onChange={(event) => touch(setCurrency)(event.target.value)}
          >
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </AdminField>
        <AdminField label='Total' htmlFor='expense-total'>
          <Input
            id='expense-total'
            inputMode='decimal'
            value={total}
            onChange={(event) => touch(setTotal)(event.target.value)}
          />
        </AdminField>
      </AdminFieldGrid>
      <AdminFieldGrid columns={4}>
        <AdminField label='Subtotal' htmlFor='expense-subtotal'>
          <Input
            id='expense-subtotal'
            inputMode='decimal'
            value={subtotal}
            onChange={(event) => touch(setSubtotal)(event.target.value)}
          />
        </AdminField>
        <AdminField label='Tax' htmlFor='expense-tax'>
          <Input
            id='expense-tax'
            inputMode='decimal'
            value={tax}
            onChange={(event) => touch(setTax)(event.target.value)}
          />
        </AdminField>
        {selectedExpense ? (
          <AdminField label='Parse status' htmlFor='expense-parse-status' span={2}>
            <Input
              id='expense-parse-status'
              readOnly
              value={`${formatEnumLabel(selectedExpense.parseStatus)}${
                selectedExpense.parseConfidence ? ` (confidence ${selectedExpense.parseConfidence})` : ''
              }`}
            />
          </AdminField>
        ) : null}
      </AdminFieldGrid>
      <AdminFieldGrid columns={1}>
        <AdminField label='Notes' htmlFor='expense-notes'>
          <Textarea
            id='expense-notes'
            value={notes}
            onChange={(event) => touch(setNotes)(event.target.value)}
            rows={3}
          />
        </AdminField>
      </AdminFieldGrid>

      <AdminDisclosure
        id='expense-line-items'
        title='Line items'
        summary={lineItemCount === null ? 'Invalid JSON' : `${lineItemCount} line${lineItemCount === 1 ? '' : 's'}`}
        open={lineItemsOpen}
        onOpenChange={setLineItemsOpen}
      >
        <AdminFieldGrid columns={1}>
          <AdminField
            label='Line items JSON'
            htmlFor='expense-line-items-json'
            error={lineItemsError || undefined}
            errorId='expense-line-items-error'
          >
            <Textarea
              id='expense-line-items-json'
              aria-invalid={lineItemsError ? true : undefined}
              aria-describedby={lineItemsError ? 'expense-line-items-error' : undefined}
              value={lineItemsJson}
              onChange={(event) => touch(setLineItemsJson)(event.target.value)}
              rows={6}
              className='font-mono text-xs'
            />
          </AdminField>
        </AdminFieldGrid>
      </AdminDisclosure>

      <AdminDisclosure
        id='expense-attachments'
        title='Attachments'
        summary={attachmentsSummary || 'None'}
        defaultOpen={!isEditMode}
      >
        <div className='space-y-3'>
          <AdminFieldGrid columns={1}>
            <AdminField label='Add files (PDF, PNG, JPG, WEBP; max 15MB each)' htmlFor='expense-files'>
              <FileUploadButton
                id='expense-files'
                accept='application/pdf,image/png,image/jpeg,image/webp'
                multiple
                selectedFileName={files.length > 0 ? `${files.length} file(s) selected` : null}
                emptyLabel='No files selected'
                buttonLabel='Choose files'
                onChange={(event) => {
                  const selectedFiles = event.target.files ? Array.from(event.target.files) : [];
                  touch(setFiles)(selectedFiles);
                }}
              />
            </AdminField>
          </AdminFieldGrid>
          {selectedExpense?.attachments.length ? (
            <p className='text-sm text-slate-600'>
              Existing attachments:{' '}
              {selectedExpense.attachments
                .map((attachment) => attachment.fileName ?? attachment.assetTitle ?? attachment.assetId)
                .join(', ')}
            </p>
          ) : null}
          {isEditMode ? (
            <label className='flex items-center gap-2 text-sm text-slate-700'>
              <input
                type='checkbox'
                checked={carryExistingAttachments}
                onChange={(event) => touch(setCarryExistingAttachments)(event.target.checked)}
              />
              Include existing attachments
            </label>
          ) : null}
        </div>
      </AdminDisclosure>

      <label className='flex items-center gap-2 text-sm text-slate-700'>
        <input
          type='checkbox'
          checked={parseRequested}
          onChange={(event) => touch(setParseRequested)(event.target.checked)}
        />
        Queue parse after save
      </label>
    </AdminEditorPanel>
  );
}
