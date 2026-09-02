'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { adminQueryKeys } from '@/lib/admin-query-keys';
import { createAdminAsset, deleteAdminAsset, uploadFileToPresignedUrl } from '@/lib/assets-api';
import {
  amendAdminExpense,
  cancelAdminExpense,
  createAdminExpense,
  deleteAdminDraftExpense,
  listAdminExpenses,
  markAdminExpensePaid,
  pollAdminBulkExpenseImportJob,
  queueAdminBulkExpenseImportJob,
  reparseAdminExpense,
  updateAdminExpense,
} from '@/lib/expenses-api';
import type { Expense, ExpenseParseStatus, ExpenseStatus, UpsertExpenseInput } from '@/types/expenses';

import { toErrorMessage } from './hook-errors';
import { usePaginatedList } from './use-paginated-list';

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

type Filters = {
  query: string;
  status: ExpenseStatus | '';
  parseStatus: ExpenseParseStatus | '';
};

const DEFAULT_FILTERS: Filters = {
  query: '',
  status: '',
  parseStatus: '',
};

export function useExpenses() {
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [isDeletingDraftId, setIsDeletingDraftId] = useState<string | null>(null);
  const [isMarkingPaidId, setIsMarkingPaidId] = useState<string | null>(null);
  const [isReparsingId, setIsReparsingId] = useState<string | null>(null);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [bulkImportError, setBulkImportError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const bulkImportAbortRef = useRef<AbortController | null>(null);

  const fetchExpenses = useCallback(
    async ({
      query,
      status,
      parseStatus,
      cursor,
      limit,
      signal,
    }: Filters & { cursor: string | null; limit: number; signal: AbortSignal }) => {
      const response = await listAdminExpenses(
        {
          query,
          status,
          parseStatus,
          cursor,
          limit,
        },
        signal
      );
      return {
        items: response.items,
        nextCursor: response.nextCursor,
        totalCount: response.totalCount,
      };
    },
    []
  );

  const list = usePaginatedList<Expense, Filters>({
    defaultFilters: DEFAULT_FILTERS,
    debounceKeys: ['query'],
    debounceMs: 350,
    fetcher: fetchExpenses,
    errorPrefix: 'Failed to load expenses',
    queryKey: adminQueryKeys.expenses.lists(),
  });

  const selectedExpense = useMemo(
    () => list.items.find((item) => item.id === selectedExpenseId) ?? null,
    [list.items, selectedExpenseId]
  );

  const clearMutationError = useCallback(() => {
    setMutationError('');
  }, []);

  const selectExpense = useCallback((expenseId: string) => {
    setSelectedExpenseId(expenseId);
    setMutationError('');
  }, []);

  const clearSelectedExpense = useCallback(() => {
    setSelectedExpenseId(null);
    setMutationError('');
  }, []);

  const cleanupUploadedAssets = useCallback(async (assetIds: string[]): Promise<void> => {
    for (const assetId of assetIds) {
      try {
        await deleteAdminAsset(assetId);
      } catch {
        // Swallow cleanup errors so the original mutation error surfaces to the user.
      }
    }
  }, []);

  const uploadExpenseFiles = useCallback(async (files: File[]): Promise<string[]> => {
    if (files.length === 0) {
      return [];
    }
    setIsUploadingFiles(true);
    try {
      const assetIds: string[] = [];
      for (const file of files) {
        const normalizedType = file.type.trim().toLowerCase();
        if (!ALLOWED_FILE_TYPES.has(normalizedType)) {
          throw new Error(`Unsupported file type: ${file.type || 'unknown'}.`);
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          throw new Error(`"${file.name}" exceeds 15MB size limit.`);
        }
        const createdAsset = await createAdminAsset({
          title: file.name,
          description: 'Expense attachment',
          assetType: 'document',
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          visibility: 'restricted',
        });
        if (!createdAsset.asset?.id || !createdAsset.upload.uploadUrl) {
          throw new Error(`Could not prepare upload for "${file.name}".`);
        }
        await uploadFileToPresignedUrl({
          uploadUrl: createdAsset.upload.uploadUrl,
          uploadMethod: createdAsset.upload.uploadMethod,
          uploadHeaders: createdAsset.upload.uploadHeaders,
          file,
        });
        assetIds.push(createdAsset.asset.id);
      }
      return assetIds;
    } finally {
      setIsUploadingFiles(false);
    }
  }, []);

  const createExpenseEntry = useCallback(
    async ({
      input,
      files,
    }: {
      input: UpsertExpenseInput;
      files: File[];
    }) => {
      setIsSaving(true);
      setMutationError('');
      let uploadedAssetIds: string[] = [];
      try {
        uploadedAssetIds = await uploadExpenseFiles(files);
        const created = await createAdminExpense({
          ...input,
          attachmentAssetIds: uploadedAssetIds,
        });
        await list.refetch();
        setSelectedExpenseId(created?.id ?? null);
      } catch (error) {
        await cleanupUploadedAssets(uploadedAssetIds);
        setMutationError(toErrorMessage(error, 'Failed to create expense.'));
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    [cleanupUploadedAssets, list, uploadExpenseFiles]
  );

  const updateExpenseEntry = useCallback(
    async ({
      expenseId,
      input,
      newFiles,
      existingAttachmentAssetIds,
    }: {
      expenseId: string;
      input: UpsertExpenseInput;
      newFiles: File[];
      existingAttachmentAssetIds: string[];
    }) => {
      setIsSaving(true);
      setMutationError('');
      let uploadedAssetIds: string[] = [];
      try {
        uploadedAssetIds = await uploadExpenseFiles(newFiles);
        const updated = await updateAdminExpense(expenseId, {
          ...input,
          attachmentAssetIds: [...existingAttachmentAssetIds, ...uploadedAssetIds],
        });
        await list.refetch();
        setSelectedExpenseId(updated?.id ?? expenseId);
      } catch (error) {
        await cleanupUploadedAssets(uploadedAssetIds);
        setMutationError(toErrorMessage(error, 'Failed to update expense.'));
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    [cleanupUploadedAssets, list, uploadExpenseFiles]
  );

  const amendExpenseEntry = useCallback(
    async ({
      expenseId,
      input,
      newFiles,
      existingAttachmentAssetIds,
    }: {
      expenseId: string;
      input: UpsertExpenseInput;
      newFiles: File[];
      existingAttachmentAssetIds: string[];
    }) => {
      setIsSaving(true);
      setMutationError('');
      let uploadedAssetIds: string[] = [];
      try {
        uploadedAssetIds = await uploadExpenseFiles(newFiles);
        const amended = await amendAdminExpense(expenseId, {
          ...input,
          attachmentAssetIds: [...existingAttachmentAssetIds, ...uploadedAssetIds],
        });
        await list.refetch();
        setSelectedExpenseId(amended?.id ?? null);
      } catch (error) {
        await cleanupUploadedAssets(uploadedAssetIds);
        setMutationError(toErrorMessage(error, 'Failed to create amendment.'));
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    [cleanupUploadedAssets, list, uploadExpenseFiles]
  );

  const deleteDraftExpenseEntry = useCallback(
    async (expenseId: string) => {
      setIsDeletingDraftId(expenseId);
      setMutationError('');
      try {
        await deleteAdminDraftExpense(expenseId);
        await list.refetch();
        setSelectedExpenseId((current) => (current === expenseId ? null : current));
      } catch (error) {
        setMutationError(toErrorMessage(error, 'Failed to delete draft expense.'));
        throw error;
      } finally {
        setIsDeletingDraftId(null);
      }
    },
    [list]
  );

  const cancelExpenseEntry = useCallback(
    async (expenseId: string, reason: string) => {
      setIsDeletingId(expenseId);
      setMutationError('');
      try {
        await cancelAdminExpense(expenseId, reason);
        await list.refetch();
      } catch (error) {
        setMutationError(toErrorMessage(error, 'Failed to void expense.'));
        throw error;
      } finally {
        setIsDeletingId(null);
      }
    },
    [list]
  );

  const markPaidExpenseEntry = useCallback(
    async (expenseId: string) => {
      setIsMarkingPaidId(expenseId);
      setMutationError('');
      try {
        await markAdminExpensePaid(expenseId);
        await list.refetch();
      } catch (error) {
        setMutationError(toErrorMessage(error, 'Failed to mark expense as paid.'));
        throw error;
      } finally {
        setIsMarkingPaidId(null);
      }
    },
    [list]
  );

  const reparseExpenseEntry = useCallback(
    async (expenseId: string) => {
      setIsReparsingId(expenseId);
      setMutationError('');
      try {
        await reparseAdminExpense(expenseId);
        await list.refetch();
      } catch (error) {
        setMutationError(toErrorMessage(error, 'Failed to queue parse request.'));
        throw error;
      } finally {
        setIsReparsingId(null);
      }
    },
    [list]
  );

  const cancelBulkImport = useCallback(() => {
    bulkImportAbortRef.current?.abort();
  }, []);

  const bulkImportFromPdf = useCallback(
    async ({ file, defaultVendorId }: { file: File; defaultVendorId: string }) => {
      setIsBulkImporting(true);
      setBulkImportError('');
      let uploadedAssetIds: string[] = [];
      let didEnqueue = false;
      bulkImportAbortRef.current?.abort();
      const controller = new AbortController();
      bulkImportAbortRef.current = controller;
      const signal = controller.signal;
      try {
        uploadedAssetIds = await uploadExpenseFiles([file]);
        const attachmentAssetId = uploadedAssetIds[0];
        if (!attachmentAssetId) {
          throw new Error('Upload did not return an asset id.');
        }
        const { jobId } = await queueAdminBulkExpenseImportJob({
          attachmentAssetId,
          defaultVendorId,
        });
        didEnqueue = true;
        await pollAdminBulkExpenseImportJob(jobId, signal);
        await list.refetch();
        setSelectedExpenseId(null);
      } catch (error) {
        if (!didEnqueue && uploadedAssetIds.length > 0) {
          await cleanupUploadedAssets(uploadedAssetIds);
        }
        setBulkImportError(toErrorMessage(error, 'Failed to import expenses from PDF.'));
        throw error;
      } finally {
        bulkImportAbortRef.current = null;
        setIsBulkImporting(false);
      }
    },
    [cleanupUploadedAssets, list, uploadExpenseFiles]
  );

  return {
    ...list,
    selectedExpenseId,
    selectedExpense,
    isSaving,
    isUploadingFiles,
    isDeletingId,
    isDeletingDraftId,
    isMarkingPaidId,
    isReparsingId,
    isBulkImporting,
    bulkImportError,
    mutationError,
    selectExpense,
    clearSelectedExpense,
    clearMutationError,
    createExpenseEntry,
    updateExpenseEntry,
    amendExpenseEntry,
    cancelExpenseEntry,
    deleteDraftExpenseEntry,
    markPaidExpenseEntry,
    reparseExpenseEntry,
    bulkImportFromPdf,
    cancelBulkImport,
  };
}
