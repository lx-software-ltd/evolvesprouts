'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ClientInvoicesPaymentsInput } from '@/hooks/client-invoices-panel-types';
import { toErrorMessage } from '@/hooks/hook-errors';
import {
  usePaginatedList,
  type PaginatedFetcherParams,
} from '@/hooks/use-paginated-list';
import {
  confirmCustomerPayment,
  createManualInboundCustomerPayment,
  deleteCustomerPayment,
  getCustomerPayment,
  listCustomerPayments,
  updateManualInboundCustomerPayment,
  type BillingEnrollmentPickerRow,
  type CustomerPaymentDetail,
  type CustomerPaymentSummary,
} from '@/lib/billing-api';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import {
  currencySelectValue,
  formatAmountSeedTwoDecimals,
  formatManualPaymentEnrollmentEditLabel,
  isManualInboundPaymentEditable,
  NO_ENROLLMENT_OPTION_VALUE,
} from '@/components/admin/finance/client-invoices-utils';

export interface ClientInvoicesPaymentsExtendedInput
  extends ClientInvoicesPaymentsInput {
  enrollmentPickerRows: BillingEnrollmentPickerRow[];
}

export function useClientInvoicesPayments({
  shared,
  selection,
  enrollmentPickerRows,
}: ClientInvoicesPaymentsExtendedInput) {
  const {
    currencyOptions,
    defaultCurrency,
    setActionMessage,
    setActionError,
    setBusy,
  } = shared;
  const { selectedInvoiceId } = selection;

  const fetchPayments = useCallback(
    async ({ cursor, limit, signal }: PaginatedFetcherParams<object>) => {
      const { items, next_cursor } = await listCustomerPayments(
        { cursor, limit },
        signal,
      );
      return { items, nextCursor: next_cursor };
    },
    [],
  );
  const {
    items: payments,
    isLoading: listLoading,
    isLoadingMore: listLoadingMore,
    hasMore: listHasMore,
    error: listError,
    refetch: refetchPayments,
    loadMore: loadMorePayments,
  } = usePaginatedList<CustomerPaymentSummary, object>({
    fetcher: fetchPayments,
    defaultFilters: {},
    errorPrefix: 'Failed to load payments',
    queryKey: adminQueryKeys.customerPayments.lists(),
  });
  // The billing-refresh registry passes an AbortSignal; usePaginatedList owns
  // its own abort controller, so the loader deliberately ignores that argument.
  const loadPayments = useCallback(() => refetchPayments(), [refetchPayments]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualPaymentPreferCreateForm, setManualPaymentPreferCreateForm] =
    useState(false);
  const [detail, setDetail] = useState<CustomerPaymentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [confirmPaymentDialogOpen, setConfirmPaymentDialogOpen] =
    useState(false);
  const [confirmPaymentId, setConfirmPaymentId] = useState<string | null>(null);
  const [confirmPaymentExternalRef, setConfirmPaymentExternalRef] =
    useState('');
  const [confirmPaymentError, setConfirmPaymentError] = useState('');

  const [deletePaymentDialogOpen, setDeletePaymentDialogOpen] = useState(false);
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [deletePaymentError, setDeletePaymentError] = useState('');

  const [createPaymentEnrollmentId, setCreatePaymentEnrollmentId] =
    useState('');
  const [createPaymentAmount, setCreatePaymentAmount] = useState('');
  const [createPaymentCurrency, setCreatePaymentCurrency] =
    useState(defaultCurrency);
  const [createPaymentMethod, setCreatePaymentMethod] =
    useState('bank_transfer');
  const [createPaymentStatus, setCreatePaymentStatus] = useState<
    'pending' | 'succeeded'
  >('pending');
  const [createPaymentExternalRef, setCreatePaymentExternalRef] = useState('');

  const resetManualPaymentCreateFields = useCallback(() => {
    setCreatePaymentEnrollmentId('');
    setCreatePaymentAmount('');
    setCreatePaymentCurrency(defaultCurrency);
    setCreatePaymentMethod('bank_transfer');
    setCreatePaymentStatus('pending');
    setCreatePaymentExternalRef('');
  }, [defaultCurrency]);

  const createPaymentEnrollmentPickerValue = useMemo(() => {
    const tid = createPaymentEnrollmentId.trim();
    if (tid === '') {
      return '';
    }
    if (tid === NO_ENROLLMENT_OPTION_VALUE) {
      return NO_ENROLLMENT_OPTION_VALUE;
    }
    return enrollmentPickerRows.some((r) => r.enrollmentId === tid) ? tid : '';
  }, [createPaymentEnrollmentId, enrollmentPickerRows]);

  const loadDetail = useCallback(async (id: string, signal?: AbortSignal) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      const row = await getCustomerPayment(id, signal);
      if (signal?.aborted) {
        return;
      }
      setDetail(row);
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') {
        return;
      }
      const message = toErrorMessage(caught, 'Failed to load payment.', {
        honorBackendMessage: true,
      });
      setDetailError(message);
      setDetail(null);
    } finally {
      if (!signal?.aborted) {
        setDetailLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    setActionMessage('');
    setActionError('');
  }, [selectedId, selectedInvoiceId, setActionMessage, setActionError]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError('');
      return;
    }
    const ac = new AbortController();
    void loadDetail(selectedId, ac.signal);
    return () => ac.abort();
  }, [selectedId, loadDetail]);

  useEffect(() => {
    setManualPaymentPreferCreateForm(false);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      resetManualPaymentCreateFields();
      return;
    }
    if (manualPaymentPreferCreateForm) {
      return;
    }
    const row = payments.find((p) => p.id === selectedId) ?? null;
    if (row === null || !isManualInboundPaymentEditable(row)) {
      resetManualPaymentCreateFields();
      return;
    }
    const curRow = row;
    const seedFromList = () => {
      setCreatePaymentEnrollmentId(curRow.enrollmentId?.trim() ?? '');
      setCreatePaymentAmount(
        formatAmountSeedTwoDecimals(curRow.amount?.trim() ?? ''),
      );
      const cur =
        (curRow.currency ?? defaultCurrency).trim().toUpperCase() ||
        defaultCurrency;
      setCreatePaymentCurrency(
        currencySelectValue(cur, currencyOptions, defaultCurrency),
      );
      setCreatePaymentMethod(curRow.method?.trim() || 'bank_transfer');
      setCreatePaymentStatus(
        curRow.status === 'succeeded' ? 'succeeded' : 'pending',
      );
      setCreatePaymentExternalRef(curRow.externalReference?.trim() ?? '');
    };
    if (!detail || detail.id !== selectedId) {
      seedFromList();
      return;
    }
    setCreatePaymentEnrollmentId(detail.enrollmentId?.trim() ?? '');
    setCreatePaymentAmount(
      formatAmountSeedTwoDecimals(detail.amount?.trim() ?? ''),
    );
    const cur =
      (detail.currency ?? defaultCurrency).trim().toUpperCase() ||
      defaultCurrency;
    setCreatePaymentCurrency(
      currencySelectValue(cur, currencyOptions, defaultCurrency),
    );
    setCreatePaymentMethod(detail.method?.trim() || 'bank_transfer');
    setCreatePaymentStatus(
      detail.status === 'succeeded' ? 'succeeded' : 'pending',
    );
    setCreatePaymentExternalRef(detail.externalReference?.trim() ?? '');
  }, [
    selectedId,
    detail,
    payments,
    defaultCurrency,
    currencyOptions,
    resetManualPaymentCreateFields,
    manualPaymentPreferCreateForm,
  ]);

  const openConfirmPaymentDialog = (paymentId: string) => {
    setConfirmPaymentId(paymentId);
    setConfirmPaymentExternalRef('');
    setConfirmPaymentError('');
    setConfirmPaymentDialogOpen(true);
  };

  const closeConfirmPaymentDialog = () => {
    setConfirmPaymentDialogOpen(false);
    setConfirmPaymentId(null);
    setConfirmPaymentExternalRef('');
    setConfirmPaymentError('');
  };

  const submitConfirmPayment = async () => {
    if (!confirmPaymentId) {
      return;
    }
    setConfirmPaymentError('');
    setBusy('confirm');
    try {
      const ext = confirmPaymentExternalRef.trim();
      await confirmCustomerPayment(
        confirmPaymentId,
        ext === '' ? undefined : { externalReference: ext },
      );
      setActionMessage('Payment confirmed.');
      closeConfirmPaymentDialog();
      await loadPayments();
      if (selectedId === confirmPaymentId) {
        const ac = new AbortController();
        await loadDetail(confirmPaymentId, ac.signal);
      }
    } catch (caught) {
      setConfirmPaymentError(
        toErrorMessage(caught, 'Confirm failed.', {
          honorBackendMessage: true,
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  const openDeletePaymentDialog = (paymentId: string) => {
    setDeletePaymentId(paymentId);
    setDeletePaymentError('');
    setDeletePaymentDialogOpen(true);
  };

  const closeDeletePaymentDialog = () => {
    setDeletePaymentDialogOpen(false);
    setDeletePaymentId(null);
    setDeletePaymentError('');
  };

  const submitDeletePayment = async () => {
    const id = deletePaymentId?.trim();
    if (!id) {
      return;
    }
    setDeletePaymentError('');
    setBusy('delete-payment');
    try {
      await deleteCustomerPayment(id);
      setActionMessage(`Payment deleted: ${id}`);
      closeDeletePaymentDialog();
      await loadPayments();
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch (caught) {
      setDeletePaymentError(
        toErrorMessage(caught, 'Delete failed.', { honorBackendMessage: true }),
      );
    } finally {
      setBusy(null);
    }
  };

  const manualPaymentIsUpdate = useMemo(() => {
    if (!selectedId || manualPaymentPreferCreateForm) {
      return false;
    }
    const row = payments.find((p) => p.id === selectedId);
    return isManualInboundPaymentEditable(row);
  }, [payments, selectedId, manualPaymentPreferCreateForm]);

  const manualPaymentSucceededReadOnly = Boolean(
    manualPaymentIsUpdate &&
      detail?.id === selectedId &&
      detail.status === 'succeeded',
  );

  const manualPaymentEnrollmentEditLabel = useMemo(() => {
    if (!manualPaymentIsUpdate || !selectedId) {
      return '';
    }
    const enrollmentId =
      detail?.id === selectedId && (detail.enrollmentId?.trim() ?? '') !== ''
        ? detail.enrollmentId!.trim()
        : createPaymentEnrollmentId.trim();
    const partyFallback = (
      (detail?.id === selectedId ? detail.party : undefined) ??
      payments.find((x) => x.id === selectedId)?.party ??
      ''
    ).trim();
    if (enrollmentId === '') {
      return partyFallback !== '' ? partyFallback : '—';
    }
    const row = enrollmentPickerRows.find(
      (r) => r.enrollmentId === enrollmentId,
    );
    return formatManualPaymentEnrollmentEditLabel(row, partyFallback);
  }, [
    manualPaymentIsUpdate,
    selectedId,
    detail,
    payments,
    createPaymentEnrollmentId,
    enrollmentPickerRows,
  ]);

  const handleCancelManualPayment = () => {
    setActionError('');
    setManualPaymentPreferCreateForm(true);
    resetManualPaymentCreateFields();
  };

  const handleManualPaymentFormSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setActionError('');
    setActionMessage('');
    const amt = createPaymentAmount.trim();
    if (!amt) {
      setActionError('Amount is required.');
      return;
    }
    if (manualPaymentIsUpdate) {
      const id = selectedId?.trim();
      if (!id) {
        return;
      }
      setBusy('update-payment');
      try {
        await updateManualInboundCustomerPayment(id, {
          amount: amt,
          currency:
            createPaymentCurrency.trim().toUpperCase() || defaultCurrency,
          method: createPaymentMethod.trim(),
          status: createPaymentStatus,
          externalReference:
            createPaymentExternalRef.trim() === ''
              ? null
              : createPaymentExternalRef.trim(),
        });
        setActionMessage('Customer payment updated.');
        await loadPayments();
        const ac = new AbortController();
        await loadDetail(id, ac.signal);
      } catch (caught) {
        setActionError(
          toErrorMessage(caught, 'Update payment failed.', {
            honorBackendMessage: true,
          }),
        );
      } finally {
        setBusy(null);
      }
      return;
    }
    const rawEnrollment = createPaymentEnrollmentId.trim();
    if (rawEnrollment === '') {
      setActionError(
        'Select a recent enrollment or choose none to record without an enrollment.',
      );
      return;
    }
    const enrollmentId =
      rawEnrollment === NO_ENROLLMENT_OPTION_VALUE ? null : rawEnrollment;
    setBusy('create-payment');
    try {
      const pay = await createManualInboundCustomerPayment({
        direction: 'inbound',
        enrollmentId,
        amount: amt,
        currency: createPaymentCurrency.trim().toUpperCase() || defaultCurrency,
        method: createPaymentMethod.trim(),
        status: createPaymentStatus,
        externalReference:
          createPaymentExternalRef.trim() === ''
            ? null
            : createPaymentExternalRef.trim(),
      });
      setActionMessage('Customer payment recorded.');
      resetManualPaymentCreateFields();
      await loadPayments();
      const pid = pay.id?.trim() ?? '';
      if (pid) {
        setSelectedId(pid);
        const ac = new AbortController();
        await loadDetail(pid, ac.signal);
      }
    } catch (caught) {
      setActionError(
        toErrorMessage(caught, 'Create payment failed.', {
          honorBackendMessage: true,
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  return {
    payments,
    listLoading,
    listLoadingMore,
    listHasMore,
    listError,
    loadMorePayments,
    selectedId,
    setSelectedId,
    setManualPaymentPreferCreateForm,
    detail,
    detailLoading,
    detailError,
    loadPayments,
    loadDetail,
    createPaymentEnrollmentId,
    setCreatePaymentEnrollmentId,
    createPaymentEnrollmentPickerValue,
    createPaymentAmount,
    setCreatePaymentAmount,
    createPaymentCurrency,
    setCreatePaymentCurrency,
    createPaymentMethod,
    setCreatePaymentMethod,
    createPaymentStatus,
    setCreatePaymentStatus,
    createPaymentExternalRef,
    setCreatePaymentExternalRef,
    manualPaymentIsUpdate,
    manualPaymentSucceededReadOnly,
    manualPaymentEnrollmentEditLabel,
    handleCancelManualPayment,
    handleManualPaymentFormSubmit,
    openConfirmPaymentDialog,
    openDeletePaymentDialog,
    confirmPaymentId,
    confirmPaymentDialogOpen,
    confirmPaymentExternalRef,
    setConfirmPaymentExternalRef,
    confirmPaymentError,
    setConfirmPaymentError,
    closeConfirmPaymentDialog,
    submitConfirmPayment,
    deletePaymentDialogOpen,
    deletePaymentError,
    closeDeletePaymentDialog,
    submitDeletePayment,
  };
}

export type ClientInvoicesPaymentsVm = ReturnType<
  typeof useClientInvoicesPayments
>;
