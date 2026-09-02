import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateAdminExpense,
  mockUpdateAdminExpense,
  mockAmendAdminExpense,
  mockCancelAdminExpense,
  mockMarkAdminExpensePaid,
  mockReparseAdminExpense,
  mockQueueAdminBulkExpenseImportJob,
  mockPollAdminBulkExpenseImportJob,
  mockCreateAdminAsset,
  mockDeleteAdminAsset,
  mockUploadFileToPresignedUrl,
  mockRefetch,
  paginatedState,
} = vi.hoisted(() => {
  const mockRefetch = vi.fn().mockResolvedValue(undefined);
  const paginatedState = {
    items: [] as unknown[],
    filters: { query: '', status: '', parseStatus: '' },
    setFilter: vi.fn(),
    clearFilters: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    error: '',
    refetch: mockRefetch,
    loadMore: vi.fn(),
    hasMore: false,
    totalCount: 0,
  };

  return {
    mockCreateAdminExpense: vi.fn(),
    mockUpdateAdminExpense: vi.fn(),
    mockAmendAdminExpense: vi.fn(),
    mockCancelAdminExpense: vi.fn(),
    mockMarkAdminExpensePaid: vi.fn(),
    mockReparseAdminExpense: vi.fn(),
    mockQueueAdminBulkExpenseImportJob: vi.fn(),
    mockPollAdminBulkExpenseImportJob: vi.fn(),
    mockCreateAdminAsset: vi.fn(),
    mockDeleteAdminAsset: vi.fn(),
    mockUploadFileToPresignedUrl: vi.fn(),
    mockRefetch,
    paginatedState,
  };
});

vi.mock('@/hooks/use-paginated-list', () => ({
  usePaginatedList: vi.fn(() => paginatedState),
}));

vi.mock('@/lib/expenses-api', () => ({
  listAdminExpenses: vi.fn(),
  createAdminExpense: mockCreateAdminExpense,
  updateAdminExpense: mockUpdateAdminExpense,
  amendAdminExpense: mockAmendAdminExpense,
  cancelAdminExpense: mockCancelAdminExpense,
  markAdminExpensePaid: mockMarkAdminExpensePaid,
  reparseAdminExpense: mockReparseAdminExpense,
  queueAdminBulkExpenseImportJob: mockQueueAdminBulkExpenseImportJob,
  pollAdminBulkExpenseImportJob: mockPollAdminBulkExpenseImportJob,
}));

vi.mock('@/lib/assets-api', () => ({
  createAdminAsset: mockCreateAdminAsset,
  deleteAdminAsset: mockDeleteAdminAsset,
  uploadFileToPresignedUrl: mockUploadFileToPresignedUrl,
}));

import { useExpenses } from '@/hooks/use-expenses';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { listAdminExpenses } from '@/lib/expenses-api';
import type { Expense } from '@/types/expenses';

const SAMPLE_EXPENSE: Expense = {
  id: 'exp-1',
  amendsExpenseId: null,
  status: 'submitted',
  parseStatus: 'succeeded',
  vendorId: 'vendor-1',
  vendorName: 'Acme Corp',
  invoiceNumber: 'INV-100',
  invoiceDate: '2026-03-01',
  dueDate: '2026-03-15',
  currency: 'HKD',
  subtotal: '100.00',
  tax: '0.00',
  total: '100.00',
  lineItems: [],
  parseConfidence: '0.95',
  notes: null,
  voidReason: null,
  createdBy: 'admin-sub',
  updatedBy: null,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  submittedAt: null,
  paidAt: null,
  voidedAt: null,
  attachments: [],
};

describe('useExpenses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paginatedState.items = [];
    mockRefetch.mockResolvedValue(undefined);
  });

  it('starts with empty state and no selection', () => {
    const { result } = renderHook(() => useExpenses());

    expect(result.current.selectedExpenseId).toBeNull();
    expect(result.current.selectedExpense).toBeNull();
    expect(result.current.isSaving).toBe(false);
    expect(result.current.isUploadingFiles).toBe(false);
    expect(result.current.mutationError).toBe('');
  });

  it('passes a stable fetcher to usePaginatedList across rerenders', async () => {
    const mockedUsePaginatedList = vi.mocked(usePaginatedList);
    const mockedListAdminExpenses = vi.mocked(listAdminExpenses);
    mockedListAdminExpenses.mockResolvedValue({
      items: [],
      nextCursor: null,
      totalCount: 0,
    });

    const { rerender } = renderHook(() => useExpenses());

    const firstCallArgs = mockedUsePaginatedList.mock.calls[0]?.[0];
    expect(firstCallArgs).toBeDefined();

    rerender();

    const secondCallArgs = mockedUsePaginatedList.mock.calls[1]?.[0];
    expect(secondCallArgs).toBeDefined();
    expect(secondCallArgs?.fetcher).toBe(firstCallArgs?.fetcher);

    const controller = new AbortController();
    const fetcherParams = {
      query: '',
      status: '',
      parseStatus: '',
      cursor: null,
      limit: 25,
      signal: controller.signal,
    };
    await firstCallArgs!.fetcher(fetcherParams);

    expect(mockedListAdminExpenses).toHaveBeenCalledWith(
      {
        query: '',
        status: '',
        parseStatus: '',
        cursor: null,
        limit: 25,
      },
      controller.signal
    );
  });

  it('selects and clears expense', () => {
    paginatedState.items = [SAMPLE_EXPENSE];
    const { result } = renderHook(() => useExpenses());

    act(() => {
      result.current.selectExpense('exp-1');
    });

    expect(result.current.selectedExpenseId).toBe('exp-1');
    expect(result.current.selectedExpense).toMatchObject({ id: 'exp-1' });

    act(() => {
      result.current.clearSelectedExpense();
    });

    expect(result.current.selectedExpenseId).toBeNull();
    expect(result.current.selectedExpense).toBeNull();
  });

  it('creates expense, uploads files, and refetches', async () => {
    mockCreateAdminExpense.mockResolvedValue({ id: 'exp-new' });
    mockCreateAdminAsset.mockResolvedValue({
      asset: { id: 'asset-1' },
      upload: { uploadUrl: 'https://s3.example.com/put', uploadMethod: 'PUT', uploadHeaders: {} },
    });
    mockUploadFileToPresignedUrl.mockResolvedValue(undefined);

    const { result } = renderHook(() => useExpenses());

    const file = new File(['invoice'], 'invoice.pdf', { type: 'application/pdf' });

    await act(async () => {
      await result.current.createExpenseEntry({
        input: {
          status: 'submitted',
          vendorId: 'vendor-1',
          invoiceNumber: null,
          invoiceDate: null,
          dueDate: null,
          currency: 'HKD',
          subtotal: null,
          tax: null,
          total: null,
          notes: null,
          lineItems: [],
          parseRequested: false,
        },
        files: [file],
      });
    });

    expect(mockCreateAdminAsset).toHaveBeenCalledTimes(1);
    expect(mockUploadFileToPresignedUrl).toHaveBeenCalledTimes(1);
    expect(mockCreateAdminExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentAssetIds: ['asset-1'],
        status: 'submitted',
        vendorId: 'vendor-1',
      })
    );
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('updates expense and refetches', async () => {
    paginatedState.items = [SAMPLE_EXPENSE];
    mockUpdateAdminExpense.mockResolvedValue(SAMPLE_EXPENSE);
    const { result } = renderHook(() => useExpenses());

    await act(async () => {
      await result.current.updateExpenseEntry({
        expenseId: 'exp-1',
        input: {
          status: 'submitted',
          vendorId: 'vendor-2',
          invoiceNumber: null,
          invoiceDate: null,
          dueDate: null,
          currency: 'HKD',
          subtotal: null,
          tax: null,
          total: null,
          notes: null,
          lineItems: [],
          parseRequested: false,
        },
        newFiles: [],
        existingAttachmentAssetIds: [],
      });
    });

    expect(mockUpdateAdminExpense).toHaveBeenCalledWith(
      'exp-1',
      expect.objectContaining({ vendorId: 'vendor-2' })
    );
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('marks expense as paid and refetches', async () => {
    mockMarkAdminExpensePaid.mockResolvedValue(SAMPLE_EXPENSE);
    const { result } = renderHook(() => useExpenses());

    await act(async () => {
      await result.current.markPaidExpenseEntry('exp-1');
    });

    expect(mockMarkAdminExpensePaid).toHaveBeenCalledWith('exp-1');
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('voids expense with reason and refetches', async () => {
    mockCancelAdminExpense.mockResolvedValue(SAMPLE_EXPENSE);
    const { result } = renderHook(() => useExpenses());

    await act(async () => {
      await result.current.cancelExpenseEntry('exp-1', 'Duplicate invoice');
    });

    expect(mockCancelAdminExpense).toHaveBeenCalledWith('exp-1', 'Duplicate invoice');
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('amends expense and refetches', async () => {
    paginatedState.items = [SAMPLE_EXPENSE];
    mockAmendAdminExpense.mockResolvedValue({ ...SAMPLE_EXPENSE, id: 'exp-amended' });
    const { result } = renderHook(() => useExpenses());

    await act(async () => {
      await result.current.amendExpenseEntry({
        expenseId: 'exp-1',
        input: {
          status: 'submitted',
          vendorId: 'vendor-1',
          invoiceNumber: null,
          invoiceDate: null,
          dueDate: null,
          currency: 'HKD',
          subtotal: null,
          tax: null,
          total: null,
          notes: 'Amendment',
          lineItems: [],
          parseRequested: false,
        },
        newFiles: [],
        existingAttachmentAssetIds: [],
      });
    });

    expect(mockAmendAdminExpense).toHaveBeenCalledWith(
      'exp-1',
      expect.objectContaining({ notes: 'Amendment' })
    );
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('reparse queues and refetches', async () => {
    mockReparseAdminExpense.mockResolvedValue(undefined);
    const { result } = renderHook(() => useExpenses());

    await act(async () => {
      await result.current.reparseExpenseEntry('exp-1');
    });

    expect(mockReparseAdminExpense).toHaveBeenCalledWith('exp-1');
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('sets mutation error on create failure', async () => {
    mockCreateAdminExpense.mockRejectedValue(new Error('Server error'));
    const { result } = renderHook(() => useExpenses());

    await act(async () => {
      try {
        await result.current.createExpenseEntry({
          input: {
            status: 'submitted',
            vendorId: null,
            invoiceNumber: null,
            invoiceDate: null,
            dueDate: null,
            currency: null,
            subtotal: null,
            tax: null,
            total: null,
            notes: null,
            lineItems: [],
            parseRequested: false,
          },
          files: [],
        });
      } catch {
        // expected
      }
    });

    expect(result.current.mutationError).toBe('Server error');
  });

  it('cleans up uploaded assets when create fails after upload', async () => {
    mockCreateAdminAsset.mockResolvedValue({
      asset: { id: 'asset-orphan' },
      upload: { uploadUrl: 'https://s3.example.com/put', uploadMethod: 'PUT', uploadHeaders: {} },
    });
    mockUploadFileToPresignedUrl.mockResolvedValue(undefined);
    mockCreateAdminExpense.mockRejectedValue(new Error('vendor_id is required'));
    mockDeleteAdminAsset.mockResolvedValue(undefined);

    const { result } = renderHook(() => useExpenses());
    const file = new File(['invoice'], 'invoice.pdf', { type: 'application/pdf' });

    await act(async () => {
      try {
        await result.current.createExpenseEntry({
          input: {
            status: 'submitted',
            vendorId: null,
            invoiceNumber: null,
            invoiceDate: null,
            dueDate: null,
            currency: null,
            subtotal: null,
            tax: null,
            total: null,
            notes: null,
            lineItems: [],
            parseRequested: false,
          },
          files: [file],
        });
      } catch {
        // expected
      }
    });

    expect(mockDeleteAdminAsset).toHaveBeenCalledWith('asset-orphan');
    expect(result.current.mutationError).toBe('vendor_id is required');
  });

  it('cleans up newly uploaded assets when update fails without touching existing ones', async () => {
    mockCreateAdminAsset.mockResolvedValue({
      asset: { id: 'asset-new' },
      upload: { uploadUrl: 'https://s3.example.com/put', uploadMethod: 'PUT', uploadHeaders: {} },
    });
    mockUploadFileToPresignedUrl.mockResolvedValue(undefined);
    mockUpdateAdminExpense.mockRejectedValue(new Error('Server error'));
    mockDeleteAdminAsset.mockResolvedValue(undefined);

    const { result } = renderHook(() => useExpenses());
    const file = new File(['invoice'], 'invoice.pdf', { type: 'application/pdf' });

    await act(async () => {
      try {
        await result.current.updateExpenseEntry({
          expenseId: 'exp-1',
          input: {
            status: 'submitted',
            vendorId: 'vendor-1',
            invoiceNumber: null,
            invoiceDate: null,
            dueDate: null,
            currency: 'HKD',
            subtotal: null,
            tax: null,
            total: null,
            notes: null,
            lineItems: [],
            parseRequested: false,
          },
          newFiles: [file],
          existingAttachmentAssetIds: ['asset-existing'],
        });
      } catch {
        // expected
      }
    });

    expect(mockDeleteAdminAsset).toHaveBeenCalledTimes(1);
    expect(mockDeleteAdminAsset).toHaveBeenCalledWith('asset-new');
    expect(mockDeleteAdminAsset).not.toHaveBeenCalledWith('asset-existing');
  });

  it('does not call delete when create succeeds', async () => {
    mockCreateAdminAsset.mockResolvedValue({
      asset: { id: 'asset-1' },
      upload: { uploadUrl: 'https://s3.example.com/put', uploadMethod: 'PUT', uploadHeaders: {} },
    });
    mockUploadFileToPresignedUrl.mockResolvedValue(undefined);
    mockCreateAdminExpense.mockResolvedValue({ id: 'exp-new' });

    const { result } = renderHook(() => useExpenses());
    const file = new File(['invoice'], 'invoice.pdf', { type: 'application/pdf' });

    await act(async () => {
      await result.current.createExpenseEntry({
        input: {
          status: 'submitted',
          vendorId: 'vendor-1',
          invoiceNumber: null,
          invoiceDate: null,
          dueDate: null,
          currency: 'HKD',
          subtotal: null,
          tax: null,
          total: null,
          notes: null,
          lineItems: [],
          parseRequested: false,
        },
        files: [file],
      });
    });

    expect(mockDeleteAdminAsset).not.toHaveBeenCalled();
  });

  it('swallows delete cleanup errors and preserves mutation error', async () => {
    mockCreateAdminAsset.mockResolvedValue({
      asset: { id: 'asset-orphan' },
      upload: { uploadUrl: 'https://s3.example.com/put', uploadMethod: 'PUT', uploadHeaders: {} },
    });
    mockUploadFileToPresignedUrl.mockResolvedValue(undefined);
    mockCreateAdminExpense.mockRejectedValue(new Error('Server error'));
    mockDeleteAdminAsset.mockRejectedValue(new Error('cleanup failed'));

    const { result } = renderHook(() => useExpenses());
    const file = new File(['invoice'], 'invoice.pdf', { type: 'application/pdf' });

    await act(async () => {
      try {
        await result.current.createExpenseEntry({
          input: {
            status: 'submitted',
            vendorId: null,
            invoiceNumber: null,
            invoiceDate: null,
            dueDate: null,
            currency: null,
            subtotal: null,
            tax: null,
            total: null,
            notes: null,
            lineItems: [],
            parseRequested: false,
          },
          files: [file],
        });
      } catch {
        // expected
      }
    });

    expect(mockDeleteAdminAsset).toHaveBeenCalledWith('asset-orphan');
    expect(result.current.mutationError).toBe('Server error');
  });

  it('rejects files exceeding size limit', async () => {
    const oversizedFile = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversizedFile, 'size', { value: 16 * 1024 * 1024 });

    const { result } = renderHook(() => useExpenses());

    await act(async () => {
      try {
        await result.current.createExpenseEntry({
          input: {
            status: 'submitted',
            vendorId: null,
            invoiceNumber: null,
            invoiceDate: null,
            dueDate: null,
            currency: null,
            subtotal: null,
            tax: null,
            total: null,
            notes: null,
            lineItems: [],
            parseRequested: false,
          },
          files: [oversizedFile],
        });
      } catch {
        // expected
      }
    });

    expect(result.current.mutationError).toContain('15MB');
  });

  it('rejects unsupported file types', async () => {
    const unsupportedFile = new File(['data'], 'file.exe', { type: 'application/x-msdownload' });

    const { result } = renderHook(() => useExpenses());

    await act(async () => {
      try {
        await result.current.createExpenseEntry({
          input: {
            status: 'submitted',
            vendorId: null,
            invoiceNumber: null,
            invoiceDate: null,
            dueDate: null,
            currency: null,
            subtotal: null,
            tax: null,
            total: null,
            notes: null,
            lineItems: [],
            parseRequested: false,
          },
          files: [unsupportedFile],
        });
      } catch {
        // expected
      }
    });

    expect(result.current.mutationError).toContain('Unsupported file type');
  });

  it('clears mutation error on selectExpense', async () => {
    mockMarkAdminExpensePaid.mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useExpenses());

    await act(async () => {
      try {
        await result.current.markPaidExpenseEntry('exp-1');
      } catch {
        // expected
      }
    });

    expect(result.current.mutationError).not.toBe('');

    act(() => {
      result.current.selectExpense('exp-2');
    });

    expect(result.current.mutationError).toBe('');
  });

  it('bulk imports from a PDF asset and refetches expenses', async () => {
    mockCreateAdminAsset.mockResolvedValue({
      asset: { id: 'asset-bulk-1' },
      upload: {
        uploadUrl: 'https://example.com/up',
        uploadMethod: 'PUT',
        uploadHeaders: {} as Record<string, string>,
      },
    });
    mockUploadFileToPresignedUrl.mockResolvedValue(undefined);
    mockQueueAdminBulkExpenseImportJob.mockResolvedValue({ jobId: 'job-1' });
    mockPollAdminBulkExpenseImportJob.mockResolvedValue({
      expenses: [],
      createdCount: 2,
    });

    const file = new File([new Uint8Array([1])], 'combined.pdf', { type: 'application/pdf' });
    const { result } = renderHook(() => useExpenses());

    await act(async () => {
      await result.current.bulkImportFromPdf({
        file,
        defaultVendorId: 'vendor-1',
      });
    });

    expect(mockQueueAdminBulkExpenseImportJob).toHaveBeenCalledWith({
      attachmentAssetId: 'asset-bulk-1',
      defaultVendorId: 'vendor-1',
    });
    expect(mockPollAdminBulkExpenseImportJob).toHaveBeenCalledWith('job-1', expect.any(AbortSignal));
    expect(mockRefetch).toHaveBeenCalled();
    expect(result.current.bulkImportError).toBe('');
  });

  it('does not delete uploaded assets when polling fails after enqueue', async () => {
    mockCreateAdminAsset.mockResolvedValue({
      asset: { id: 'asset-bulk-2' },
      upload: {
        uploadUrl: 'https://example.com/up',
        uploadMethod: 'PUT',
        uploadHeaders: {} as Record<string, string>,
      },
    });
    mockUploadFileToPresignedUrl.mockResolvedValue(undefined);
    mockQueueAdminBulkExpenseImportJob.mockResolvedValue({ jobId: 'job-2' });
    mockPollAdminBulkExpenseImportJob.mockRejectedValue(new Error('poll failed'));

    const file = new File([new Uint8Array([1])], 'combined.pdf', { type: 'application/pdf' });
    const { result } = renderHook(() => useExpenses());

    await act(async () => {
      try {
        await result.current.bulkImportFromPdf({
          file,
          defaultVendorId: 'vendor-1',
        });
      } catch {
        // expected
      }
    });

    expect(mockDeleteAdminAsset).not.toHaveBeenCalled();
  });
});
