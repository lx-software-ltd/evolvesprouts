'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClientInvoicesInvoiceListInput } from '@/hooks/client-invoices-panel-types';
import { toErrorMessage } from '@/hooks/hook-errors';
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
import {
  INVOICE_LIST_SEARCH_DEBOUNCE_MS,
  normalizeInvoiceRecipientList,
} from '@/components/admin/finance/client-invoices-utils';
import { useRelatedPartySearchParams } from '@/hooks/use-related-party-search-params';

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

  const [invoices, setInvoices] = useState<CustomerInvoiceSummary[]>([]);
  const [invoiceListLoading, setInvoiceListLoading] = useState(true);
  const [invoiceListLoadingMore, setInvoiceListLoadingMore] = useState(false);
  const [invoiceListError, setInvoiceListError] = useState('');
  const [invoiceListCursor, setInvoiceListCursor] = useState<string | null>(
    null,
  );
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<
    'draft' | 'issued' | 'void' | ''
  >('');
  const {
    contactId: contactFilterId,
    familyId: familyFilterId,
    organizationId: organizationFilterId,
    partyFilterKey,
  } = useRelatedPartySearchParams();
  const [invoiceSettlementFilter, setInvoiceSettlementFilter] = useState<
    'not_completed' | 'open' | 'partially_paid' | 'paid' | 'no_charge' | ''
  >('not_completed');
  useEffect(() => {
    if (partyFilterKey) {
      setInvoiceSettlementFilter('');
    }
  }, [partyFilterKey]);
  const [invoiceCurrencyFilter, setInvoiceCurrencyFilter] = useState('');
  const [invoiceSearchInput, setInvoiceSearchInput] = useState('');
  const [invoiceSearchDebounced, setInvoiceSearchDebounced] = useState('');
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

  useEffect(() => {
    const id = window.setTimeout(() => {
      setInvoiceSearchDebounced(invoiceSearchInput.trim());
    }, INVOICE_LIST_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [invoiceSearchInput]);

  const loadInvoicesFirstPage = useCallback(
    async (signal?: AbortSignal) => {
      setInvoiceListLoading(true);
      setInvoiceListError('');
      setInvoiceListCursor(null);
      try {
        const { items, next_cursor } = await listCustomerInvoices(
          {
            status:
              invoiceStatusFilter === '' ? undefined : invoiceStatusFilter,
            settlement:
              invoiceSettlementFilter === ''
                ? undefined
                : invoiceSettlementFilter,
            currency:
              invoiceCurrencyFilter === '' ? undefined : invoiceCurrencyFilter,
            q:
              invoiceSearchDebounced === ''
                ? undefined
                : invoiceSearchDebounced,
            contactId: contactFilterId === '' ? undefined : contactFilterId,
            familyId: familyFilterId === '' ? undefined : familyFilterId,
            organizationId:
              organizationFilterId === '' ? undefined : organizationFilterId,
            limit: 25,
          },
          signal,
        );
        setInvoices(items);
        setInvoiceListCursor(next_cursor);
      } catch (caught) {
        if (caught instanceof Error && caught.name === 'AbortError') {
          return;
        }
        const message = toErrorMessage(caught, 'Failed to load invoices.', {
          honorBackendMessage: true,
        });
        setInvoiceListError(message);
        setInvoices([]);
      } finally {
        setInvoiceListLoading(false);
      }
    },
    [
      invoiceCurrencyFilter,
      invoiceSearchDebounced,
      invoiceStatusFilter,
      invoiceSettlementFilter,
      contactFilterId,
      familyFilterId,
      organizationFilterId,
    ],
  );

  useEffect(() => {
    const ac = new AbortController();
    void loadInvoicesFirstPage(ac.signal);
    return () => ac.abort();
  }, [loadInvoicesFirstPage]);

  const loadMoreInvoices = useCallback(async () => {
    if (!invoiceListCursor) {
      return;
    }
    setInvoiceListLoadingMore(true);
    setInvoiceListError('');
    try {
      const { items, next_cursor } = await listCustomerInvoices({
        status: invoiceStatusFilter === '' ? undefined : invoiceStatusFilter,
        settlement:
          invoiceSettlementFilter === '' ? undefined : invoiceSettlementFilter,
        currency:
          invoiceCurrencyFilter === '' ? undefined : invoiceCurrencyFilter,
        q: invoiceSearchDebounced === '' ? undefined : invoiceSearchDebounced,
        contactId: contactFilterId === '' ? undefined : contactFilterId,
        familyId: familyFilterId === '' ? undefined : familyFilterId,
        organizationId:
          organizationFilterId === '' ? undefined : organizationFilterId,
        cursor: invoiceListCursor,
        limit: 25,
      });
      setInvoices((prev) => [...prev, ...items]);
      setInvoiceListCursor(next_cursor);
    } catch (caught) {
      const message = toErrorMessage(caught, 'Failed to load more invoices.', {
        honorBackendMessage: true,
      });
      setInvoiceListError(message);
    } finally {
      setInvoiceListLoadingMore(false);
    }
  }, [
    invoiceListCursor,
    invoiceCurrencyFilter,
    invoiceSearchDebounced,
    invoiceStatusFilter,
    invoiceSettlementFilter,
    contactFilterId,
    familyFilterId,
    organizationFilterId,
  ]);

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
    invoiceListLoading,
    invoiceListLoadingMore,
    invoiceListError,
    invoiceListCursor,
    invoiceStatusFilter,
    setInvoiceStatusFilter,
    invoiceSettlementFilter,
    setInvoiceSettlementFilter,
    invoiceCurrencyFilter,
    setInvoiceCurrencyFilter,
    invoiceSearchInput,
    setInvoiceSearchInput,
    selectedIssuedInvoice,
    issuedInvoicesForAllocate,
    issuedInvoiceEmailCsv,
    setIssuedInvoiceEmailCsv,
    issuedInvoiceEmailError,
    setIssuedInvoiceEmailError,
    issuedInvoiceEmailDirtyRef,
    loadInvoicesFirstPage,
    loadMoreInvoices,
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
