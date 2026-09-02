'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClientInvoicesInvoiceListInput } from '@/hooks/client-invoices-panel-types';
import { toErrorMessage } from '@/hooks/hook-errors';
import {
  usePaginatedList,
  type PaginatedFetcherParams,
} from '@/hooks/use-paginated-list';
import {
  deleteDraftCustomerInvoice,
  emailInvoice,
  exportBillingCsv,
  getCustomerInvoicePdfDownload,
  issueInvoice,
  listCustomerInvoices,
  voidInvoice,
  type CustomerInvoiceSummary,
} from '@/lib/billing-api';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import {
  INVOICE_LIST_SEARCH_DEBOUNCE_MS,
  normalizeInvoiceRecipientList,
} from '@/components/admin/finance/client-invoices-utils';
import { useRelatedPartySearchParams } from '@/hooks/use-related-party-search-params';

export type InvoiceStatusFilter = 'draft' | 'issued' | 'void' | '';
export type InvoiceSettlementFilter =
  'not_completed' | 'open' | 'partially_paid' | 'paid' | 'no_charge' | '';

export interface InvoiceListFilters {
  status: InvoiceStatusFilter;
  settlement: InvoiceSettlementFilter;
  currency: string;
  search: string;
}

const DEFAULT_INVOICE_LIST_FILTERS: InvoiceListFilters = {
  status: '',
  settlement: 'not_completed',
  currency: '',
  search: '',
};

export function useClientInvoicesInvoiceList({
  shared,
  selection,
  billingRefresh,
  loadEnrollmentPicker,
  enrollmentFilter,
}: ClientInvoicesInvoiceListInput) {
  const { setActionMessage, setActionError, setBusy, setExportBusy } = shared;
  const {
    selectedInvoiceId,
    setSelectedInvoiceId,
    allocateInvoiceId,
    setAllocateInvoiceId,
    setAllocateLineId,
  } = selection;

  const {
    contactId: contactFilterId,
    familyId: familyFilterId,
    organizationId: organizationFilterId,
    partyFilterKey,
  } = useRelatedPartySearchParams();

  const fetchInvoices = useCallback(
    async ({
      status,
      settlement,
      currency,
      search,
      cursor,
      limit,
      signal,
    }: PaginatedFetcherParams<InvoiceListFilters>) => {
      const { items, next_cursor } = await listCustomerInvoices(
        {
          status: status || undefined,
          settlement: settlement || undefined,
          currency: currency || undefined,
          q: search.trim() || undefined,
          contactId: contactFilterId || undefined,
          familyId: familyFilterId || undefined,
          organizationId: organizationFilterId || undefined,
          cursor,
          limit,
        },
        signal,
      );
      return { items, nextCursor: next_cursor };
    },
    [contactFilterId, familyFilterId, organizationFilterId],
  );

  const list = usePaginatedList<CustomerInvoiceSummary, InvoiceListFilters>({
    fetcher: fetchInvoices,
    defaultFilters: DEFAULT_INVOICE_LIST_FILTERS,
    errorPrefix: 'Failed to load invoices',
    queryKey: [...adminQueryKeys.customerInvoices.lists(), contactFilterId, familyFilterId, organizationFilterId],
    debounceKeys: ['search'],
    debounceMs: INVOICE_LIST_SEARCH_DEBOUNCE_MS,
  });
  const {
    items: invoices,
    filters: invoiceFilters,
    setFilter: setInvoiceFilter,
    refetch: refetchInvoices,
  } = list;
  // The billing-refresh registry passes an AbortSignal; usePaginatedList owns
  // its own abort controller, so the loader deliberately ignores that argument.
  const loadInvoicesFirstPage = useCallback(
    () => refetchInvoices(),
    [refetchInvoices],
  );

  useEffect(() => {
    if (partyFilterKey) {
      setInvoiceFilter('settlement', '');
    }
  }, [partyFilterKey, setInvoiceFilter]);

  const [issuedInvoiceEmailCsv, setIssuedInvoiceEmailCsv] = useState('');
  const [issuedInvoiceEmailError, setIssuedInvoiceEmailError] = useState('');

  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidInvoiceTargetId, setVoidInvoiceTargetId] = useState<string | null>(
    null,
  );
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');

  const [deleteDraftDialogOpen, setDeleteDraftDialogOpen] = useState(false);
  const [deleteDraftInvoiceId, setDeleteDraftInvoiceId] = useState<
    string | null
  >(null);
  const [deleteDraftError, setDeleteDraftError] = useState('');

  const prevIssuedInvoiceSelectionRef = useRef<string | null>(null);
  const issuedInvoiceEmailDirtyRef = useRef(false);

  const selectedIssuedInvoice = useMemo(() => {
    if (!selectedInvoiceId) {
      return null;
    }
    return invoices.find((inv) => inv.id === selectedInvoiceId) ?? null;
  }, [invoices, selectedInvoiceId]);

  const issuedInvoicesForAllocate = useMemo(
    () =>
      invoices.filter(
        (inv) => inv.status === 'issued' && (inv.id?.trim() ?? '') !== '',
      ),
    [invoices],
  );

  useEffect(() => {
    setIssuedInvoiceEmailError('');
    const inv = selectedIssuedInvoice;

    if (!inv || inv.status !== 'issued') {
      prevIssuedInvoiceSelectionRef.current = null;
      issuedInvoiceEmailDirtyRef.current = false;
      setIssuedInvoiceEmailCsv('');
      return;
    }

    const id = inv.id ?? '';
    const bill = inv.billToEmail?.trim() ?? '';

    if (prevIssuedInvoiceSelectionRef.current !== id) {
      prevIssuedInvoiceSelectionRef.current = id;
      issuedInvoiceEmailDirtyRef.current = false;
      setIssuedInvoiceEmailCsv(bill);
      return;
    }

    if (!issuedInvoiceEmailDirtyRef.current) {
      setIssuedInvoiceEmailCsv(bill);
    }
  }, [selectedIssuedInvoice]);

  const openVoidInvoiceDialog = (invoiceId: string) => {
    setVoidInvoiceTargetId(invoiceId);
    setVoidReason('');
    setVoidError('');
    setVoidDialogOpen(true);
  };

  const closeVoidInvoiceDialog = () => {
    setVoidDialogOpen(false);
    setVoidInvoiceTargetId(null);
    setVoidReason('');
    setVoidError('');
  };

  const confirmVoidInvoice = async () => {
    const id = voidInvoiceTargetId?.trim();
    if (!id) {
      return;
    }
    if (!voidReason.trim()) {
      setVoidError('Void reason is required.');
      return;
    }
    setVoidError('');
    setBusy('void');
    try {
      await voidInvoice(id, voidReason.trim());
      setActionMessage(`Invoice voided: ${id}`);
      closeVoidInvoiceDialog();
      await billingRefresh.refreshBillingLists();
    } catch (caught) {
      setVoidError(
        toErrorMessage(caught, 'Void failed.', { honorBackendMessage: true }),
      );
    } finally {
      setBusy(null);
    }
  };

  const openDeleteDraftInvoiceDialog = (invoiceId: string) => {
    setDeleteDraftInvoiceId(invoiceId);
    setDeleteDraftError('');
    setDeleteDraftDialogOpen(true);
  };

  const closeDeleteDraftInvoiceDialog = () => {
    setDeleteDraftDialogOpen(false);
    setDeleteDraftInvoiceId(null);
    setDeleteDraftError('');
  };

  const confirmDeleteDraftInvoice = async () => {
    const id = deleteDraftInvoiceId?.trim();
    if (!id) {
      return;
    }
    setDeleteDraftError('');
    setBusy('delete-draft');
    try {
      await deleteDraftCustomerInvoice(id);
      setActionMessage(`Draft invoice deleted: ${id}`);
      closeDeleteDraftInvoiceDialog();
      if (selectedInvoiceId === id) {
        setSelectedInvoiceId(null);
      }
      if (allocateInvoiceId === id) {
        setAllocateInvoiceId('');
        setAllocateLineId('');
      }
      await billingRefresh.refreshBillingLists();
      await billingRefresh.refreshEnrollmentPicker(
        undefined,
        enrollmentFilter.trim(),
      );
    } catch (caught) {
      setDeleteDraftError(
        toErrorMessage(caught, 'Delete failed.', { honorBackendMessage: true }),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleEmailIssuedInvoice = async () => {
    const id = selectedInvoiceId?.trim();
    if (!id || selectedIssuedInvoice?.status !== 'issued') {
      return;
    }
    const normalized = normalizeInvoiceRecipientList(issuedInvoiceEmailCsv);
    if (normalized === '') {
      setIssuedInvoiceEmailError(
        'Enter at least one recipient email (comma-separated).',
      );
      return;
    }
    setIssuedInvoiceEmailError('');
    setBusy('email');
    try {
      const out = await emailInvoice(id, normalized);
      setActionMessage(
        out.sent ? 'Email send accepted.' : 'Email was not confirmed sent.',
      );
      await billingRefresh.refreshInvoices();
    } catch (caught) {
      setIssuedInvoiceEmailError(
        toErrorMessage(caught, 'Email failed.', { honorBackendMessage: true }),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleIssueRow = async (invoiceId: string) => {
    setActionError('');
    setActionMessage('');
    setBusy('issue');
    try {
      const out = await issueInvoice(invoiceId);
      setActionMessage(
        `Issued invoice ${out.invoiceNumber ?? out.invoiceId ?? invoiceId}` +
          (out.issuedPdfSha256
            ? ` (SHA-256: ${out.issuedPdfSha256.slice(0, 16)}…)`
            : ''),
      );
      await billingRefresh.refreshBillingLists();
    } catch (caught) {
      setActionError(
        toErrorMessage(caught, 'Issue failed.', { honorBackendMessage: true }),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleOpenInvoicePdfPreview = async (invoiceId: string) => {
    setActionError('');
    setBusy('pdf');
    try {
      const { downloadUrl } = await getCustomerInvoicePdfDownload(invoiceId);
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setActionError(
        toErrorMessage(caught, 'Could not open invoice preview.', {
          honorBackendMessage: true,
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleExport = async () => {
    setExportBusy(true);
    setActionError('');
    try {
      const csv = await exportBillingCsv('2');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `billing-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setActionMessage('Export downloaded (v2 CSV).');
    } catch (caught) {
      setActionError(
        toErrorMessage(caught, 'Export failed.', { honorBackendMessage: true }),
      );
    } finally {
      setExportBusy(false);
    }
  };

  return {
    invoices,
    invoiceListLoading: list.isLoading,
    invoiceListLoadingMore: list.isLoadingMore,
    invoiceListError: list.error,
    invoiceListHasMore: list.hasMore,
    invoiceStatusFilter: invoiceFilters.status,
    setInvoiceStatusFilter: (value: InvoiceStatusFilter) =>
      setInvoiceFilter('status', value),
    invoiceSettlementFilter: invoiceFilters.settlement,
    setInvoiceSettlementFilter: (value: InvoiceSettlementFilter) =>
      setInvoiceFilter('settlement', value),
    invoiceCurrencyFilter: invoiceFilters.currency,
    setInvoiceCurrencyFilter: (value: string) =>
      setInvoiceFilter('currency', value),
    invoiceSearchInput: invoiceFilters.search,
    setInvoiceSearchInput: (value: string) => setInvoiceFilter('search', value),
    selectedIssuedInvoice,
    issuedInvoicesForAllocate,
    issuedInvoiceEmailCsv,
    setIssuedInvoiceEmailCsv,
    issuedInvoiceEmailError,
    setIssuedInvoiceEmailError,
    issuedInvoiceEmailDirtyRef,
    loadInvoicesFirstPage,
    loadMoreInvoices: list.loadMore,
    handleEmailIssuedInvoice,
    handleOpenInvoicePdfPreview,
    handleIssueRow,
    handleExport,
    openVoidInvoiceDialog,
    openDeleteDraftInvoiceDialog,
    voidDialogOpen,
    voidReason,
    setVoidReason,
    voidError,
    setVoidError,
    closeVoidInvoiceDialog,
    confirmVoidInvoice,
    deleteDraftDialogOpen,
    deleteDraftError,
    closeDeleteDraftInvoiceDialog,
    confirmDeleteDraftInvoice,
  };
}

export type ClientInvoicesInvoiceListVm = ReturnType<
  typeof useClientInvoicesInvoiceList
>;
