'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClientInvoicesSelectionState } from '@/hooks/client-invoices-panel-types';
import { useClientInvoicesAllocateRefund } from '@/hooks/use-client-invoices-allocate-refund';
import { useClientInvoicesBillingRefresh } from '@/hooks/use-client-invoices-billing-refresh';
import { useClientInvoicesDraft } from '@/hooks/use-client-invoices-draft';
import { useClientInvoicesInvoiceList } from '@/hooks/use-client-invoices-invoice-list';
import { useClientInvoicesPayments } from '@/hooks/use-client-invoices-payments';
import { useClientInvoicesPanelShared } from '@/hooks/use-client-invoices-panel-shared';
import { DRAFT_RECORD_ID, useExpandedRecord } from '@/hooks/use-expanded-record';

export const ADMIN_INVOICE_QUERY_PARAM = 'invoice';
export const ADMIN_PAYMENT_QUERY_PARAM = 'payment';

function recordIdOrNull(expandedId: string | null): string | null {
  return expandedId === DRAFT_RECORD_ID ? null : expandedId;
}

export function useClientInvoicesPanel() {
  const shared = useClientInvoicesPanelShared();

  // Each table keeps one open row (draft or record). The open row *is* the
  // selection the billing flows act on; unsaved edits guard row switches.
  const invoiceDirtyRef = useRef(false);
  const paymentDirtyRef = useRef(false);
  const invoiceExpanded = useExpandedRecord({
    paramName: ADMIN_INVOICE_QUERY_PARAM,
    isDirty: () => invoiceDirtyRef.current,
    onChange: () => {
      invoiceDirtyRef.current = false;
    },
  });
  const paymentExpanded = useExpandedRecord({
    paramName: ADMIN_PAYMENT_QUERY_PARAM,
    isDirty: () => paymentDirtyRef.current,
    onChange: () => {
      paymentDirtyRef.current = false;
    },
  });

  const selectedInvoiceId = recordIdOrNull(invoiceExpanded.expandedId);
  const selectedPaymentId = recordIdOrNull(paymentExpanded.expandedId);

  const { expand: expandInvoice, collapse: collapseInvoice } = invoiceExpanded;
  const { expand: expandPayment, collapse: collapsePayment } = paymentExpanded;
  const setSelectedInvoiceId = useCallback(
    (id: string | null) => {
      if (id) {
        expandInvoice(id);
      } else {
        collapseInvoice();
      }
    },
    [expandInvoice, collapseInvoice],
  );
  const setSelectedPaymentId = useCallback(
    (id: string | null) => {
      if (id) {
        expandPayment(id);
      } else {
        collapsePayment();
      }
    },
    [expandPayment, collapsePayment],
  );
  const setInvoiceEditorDirty = useCallback((dirty: boolean) => {
    invoiceDirtyRef.current = dirty;
  }, []);
  const setPaymentEditorDirty = useCallback((dirty: boolean) => {
    paymentDirtyRef.current = dirty;
  }, []);

  const [allocateInvoiceId, setAllocateInvoiceId] = useState('');
  const [allocateLineId, setAllocateLineId] = useState('');

  const selection: ClientInvoicesSelectionState = {
    selectedInvoiceId,
    setSelectedInvoiceId,
    setInvoiceEditorDirty,
    selectedPaymentId,
    setSelectedPaymentId,
    setPaymentEditorDirty,
    allocateInvoiceId,
    setAllocateInvoiceId,
    allocateLineId,
    setAllocateLineId,
  };

  const {
    billingRefresh,
    registerPaymentsLoader,
    registerInvoicesLoader,
    registerEnrollmentPickerLoader,
  } = useClientInvoicesBillingRefresh();

  const draft = useClientInvoicesDraft({
    shared,
    selection,
    billingRefresh,
  });

  const payments = useClientInvoicesPayments({
    shared,
    selection,
    enrollmentPickerRows: draft.enrollmentPickerRows,
  });

  const invoiceList = useClientInvoicesInvoiceList({
    shared,
    selection,
    billingRefresh,
    loadEnrollmentPicker: draft.loadEnrollmentPicker,
    enrollmentFilter: draft.enrollmentFilter,
  });

  useEffect(() => {
    registerPaymentsLoader(payments.loadPayments);
    registerInvoicesLoader(invoiceList.loadInvoicesFirstPage);
    registerEnrollmentPickerLoader(draft.loadEnrollmentPicker);
  }, [
    payments.loadPayments,
    invoiceList.loadInvoicesFirstPage,
    draft.loadEnrollmentPicker,
    registerPaymentsLoader,
    registerInvoicesLoader,
    registerEnrollmentPickerLoader,
  ]);

  const allocateRefund = useClientInvoicesAllocateRefund({
    shared,
    selection,
    invoices: invoiceList.invoices,
    selectedId: payments.selectedId,
    detail: payments.detail,
    billingRefresh,
    loadDetail: payments.loadDetail,
  });

  const editorBusy = shared.busyAction !== null;

  const ids = {
    draftFilterId: shared.draftFilterId,
    draftModeId: shared.draftModeId,
    invoiceSearchFilterId: shared.invoiceSearchFilterId,
    invoiceSettlementFilterId: shared.invoiceSettlementFilterId,
    draftInvoiceDateId: shared.draftInvoiceDateId,
  };

  const currency = {
    currencyOptions: shared.currencyOptions,
    defaultCurrency: shared.defaultCurrency,
  };

  const busy = {
    busyAction: shared.busyAction,
    editorBusy,
    exportBusy: shared.exportBusy,
  };

  const draftSlice = {
    draftCreationMode: draft.draftCreationMode,
    setDraftCreationMode: draft.setDraftCreationMode,
    customizedFormSubmitEnabled: draft.customizedFormSubmitEnabled,
    setCustomizedFormSubmitEnabled: draft.setCustomizedFormSubmitEnabled,
    enrollmentFilter: draft.enrollmentFilter,
    setEnrollmentFilter: draft.setEnrollmentFilter,
    enrollmentPickerRows: draft.enrollmentPickerRows,
    enrollmentPickerTruncated: draft.enrollmentPickerTruncated,
    enrollmentPickerLoading: draft.enrollmentPickerLoading,
    enrollmentPickerError: draft.enrollmentPickerError,
    selectedEnrollmentIds: draft.selectedEnrollmentIds,
    setSelectedEnrollmentIds: draft.setSelectedEnrollmentIds,
    lineOverrideByEnrollmentId: draft.lineOverrideByEnrollmentId,
    setLineOverrideByEnrollmentId: draft.setLineOverrideByEnrollmentId,
    draftInvoiceDateMin: draft.draftInvoiceDateMin,
    draftInvoiceDateMax: draft.draftInvoiceDateMax,
    draftInvoiceDate: draft.draftInvoiceDate,
    setDraftInvoiceDate: draft.setDraftInvoiceDate,
    selectableFilteredRows: draft.selectableFilteredRows,
    selectedEnrollmentRows: draft.selectedEnrollmentRows,
    draftSelectionIssue: draft.draftSelectionIssue,
    draftAmountIssue: draft.draftAmountIssue,
    handleCreateDraft: draft.handleCreateDraft,
    handleCustomizedCreated: draft.handleCustomizedCreated,
    setInvoiceEditorDirty,
    setBusy: shared.setBusy,
    setActionError: shared.setActionError,
  };

  const invoicesSlice = {
    expanded: invoiceExpanded,
    invoices: invoiceList.invoices,
    invoiceListLoading: invoiceList.invoiceListLoading,
    invoiceListLoadingMore: invoiceList.invoiceListLoadingMore,
    invoiceListError: invoiceList.invoiceListError,
    invoiceListHasMore: invoiceList.invoiceListHasMore,
    invoiceStatusFilter: invoiceList.invoiceStatusFilter,
    setInvoiceStatusFilter: invoiceList.setInvoiceStatusFilter,
    invoiceSettlementFilter: invoiceList.invoiceSettlementFilter,
    setInvoiceSettlementFilter: invoiceList.setInvoiceSettlementFilter,
    invoiceCurrencyFilter: invoiceList.invoiceCurrencyFilter,
    setInvoiceCurrencyFilter: invoiceList.setInvoiceCurrencyFilter,
    invoiceSearchInput: invoiceList.invoiceSearchInput,
    setInvoiceSearchInput: invoiceList.setInvoiceSearchInput,
    selectedInvoiceId,
    selectedIssuedInvoice: invoiceList.selectedIssuedInvoice,
    issuedInvoiceEmailCsv: invoiceList.issuedInvoiceEmailCsv,
    setIssuedInvoiceEmailCsv: invoiceList.setIssuedInvoiceEmailCsv,
    issuedInvoiceEmailError: invoiceList.issuedInvoiceEmailError,
    setIssuedInvoiceEmailError: invoiceList.setIssuedInvoiceEmailError,
    issuedInvoiceEmailDirtyRef: invoiceList.issuedInvoiceEmailDirtyRef,
    setInvoiceEditorDirty,
    handleEmailIssuedInvoice: invoiceList.handleEmailIssuedInvoice,
    loadMoreInvoices: invoiceList.loadMoreInvoices,
    handleOpenInvoicePdfPreview: invoiceList.handleOpenInvoicePdfPreview,
    handleIssueRow: invoiceList.handleIssueRow,
    openVoidInvoiceDialog: invoiceList.openVoidInvoiceDialog,
    openDeleteDraftInvoiceDialog: invoiceList.openDeleteDraftInvoiceDialog,
    deleteDraftDialogOpen: invoiceList.deleteDraftDialogOpen,
    voidDialogOpen: invoiceList.voidDialogOpen,
  };

  const manualPaymentSlice = {
    createPaymentEnrollmentId: payments.createPaymentEnrollmentId,
    setCreatePaymentEnrollmentId: payments.setCreatePaymentEnrollmentId,
    createPaymentEnrollmentPickerValue:
      payments.createPaymentEnrollmentPickerValue,
    createPaymentAmount: payments.createPaymentAmount,
    setCreatePaymentAmount: payments.setCreatePaymentAmount,
    createPaymentCurrency: payments.createPaymentCurrency,
    setCreatePaymentCurrency: payments.setCreatePaymentCurrency,
    createPaymentMethod: payments.createPaymentMethod,
    setCreatePaymentMethod: payments.setCreatePaymentMethod,
    createPaymentStatus: payments.createPaymentStatus,
    setCreatePaymentStatus: payments.setCreatePaymentStatus,
    createPaymentExternalRef: payments.createPaymentExternalRef,
    setCreatePaymentExternalRef: payments.setCreatePaymentExternalRef,
    manualPaymentIsUpdate: payments.manualPaymentIsUpdate,
    manualPaymentSucceededReadOnly: payments.manualPaymentSucceededReadOnly,
    manualPaymentEnrollmentEditLabel: payments.manualPaymentEnrollmentEditLabel,
    handleManualPaymentFormSubmit: payments.handleManualPaymentFormSubmit,
    setPaymentEditorDirty,
    enrollmentPickerRows: draft.enrollmentPickerRows,
  };

  const paymentsSlice = {
    expanded: paymentExpanded,
    payments: payments.payments,
    listLoading: payments.listLoading,
    listLoadingMore: payments.listLoadingMore,
    listHasMore: payments.listHasMore,
    listError: payments.listError,
    loadMorePayments: payments.loadMorePayments,
    selectedId: payments.selectedId,
    detail: payments.detail,
    detailError: payments.detailError,
    exportBusy: shared.exportBusy,
    handleExport: invoiceList.handleExport,
    openConfirmPaymentDialog: payments.openConfirmPaymentDialog,
    openDeletePaymentDialog: payments.openDeletePaymentDialog,
    confirmPaymentId: payments.confirmPaymentId,
    deletePaymentDialogOpen: payments.deletePaymentDialogOpen,
    confirmPaymentDialogOpen: payments.confirmPaymentDialogOpen,
  };

  const allocateSlice = {
    allocateInvoiceId,
    setAllocateInvoiceId,
    allocateLineId,
    setAllocateLineId,
    allocateAmount: allocateRefund.allocateAmount,
    setAllocateAmount: allocateRefund.setAllocateAmount,
    allocateCurrency: allocateRefund.allocateCurrency,
    setAllocateCurrency: allocateRefund.setAllocateCurrency,
    allocateInvoiceLinesLoading: allocateRefund.allocateInvoiceLinesLoading,
    allocateInvoiceLinesError: allocateRefund.allocateInvoiceLinesError,
    allocateLinesOrdered: allocateRefund.allocateLinesOrdered,
    allocateLineDescriptionCounts: allocateRefund.allocateLineDescriptionCounts,
    issuedInvoicesForAllocate: invoiceList.issuedInvoicesForAllocate,
    handleAllocate: allocateRefund.handleAllocate,
    invoices: invoiceList.invoices,
  };

  const refundSlice = {
    refundInvoiceId: allocateRefund.refundInvoiceId,
    refundPaymentSelectId: allocateRefund.refundPaymentSelectId,
    setRefundPaymentSelectId: allocateRefund.setRefundPaymentSelectId,
    refundPaymentsLoading: allocateRefund.refundPaymentsLoading,
    refundPaymentsError: allocateRefund.refundPaymentsError,
    refundEligiblePayments: allocateRefund.refundEligiblePayments,
    refundAmount: allocateRefund.refundAmount,
    setRefundAmount: allocateRefund.setRefundAmount,
    refundCurrency: allocateRefund.refundCurrency,
    setRefundCurrency: allocateRefund.setRefundCurrency,
    refundMethod: allocateRefund.refundMethod,
    setRefundMethod: allocateRefund.setRefundMethod,
    refundStripeId: allocateRefund.refundStripeId,
    setRefundStripeId: allocateRefund.setRefundStripeId,
    handleRefund: allocateRefund.handleRefund,
  };

  const dialogsSlice = {
    voidDialogOpen: invoiceList.voidDialogOpen,
    voidReason: invoiceList.voidReason,
    setVoidReason: invoiceList.setVoidReason,
    voidError: invoiceList.voidError,
    setVoidError: invoiceList.setVoidError,
    closeVoidInvoiceDialog: invoiceList.closeVoidInvoiceDialog,
    confirmVoidInvoice: invoiceList.confirmVoidInvoice,
    deleteDraftDialogOpen: invoiceList.deleteDraftDialogOpen,
    deleteDraftError: invoiceList.deleteDraftError,
    closeDeleteDraftInvoiceDialog: invoiceList.closeDeleteDraftInvoiceDialog,
    confirmDeleteDraftInvoice: invoiceList.confirmDeleteDraftInvoice,
    confirmPaymentDialogOpen: payments.confirmPaymentDialogOpen,
    confirmPaymentExternalRef: payments.confirmPaymentExternalRef,
    setConfirmPaymentExternalRef: payments.setConfirmPaymentExternalRef,
    confirmPaymentError: payments.confirmPaymentError,
    setConfirmPaymentError: payments.setConfirmPaymentError,
    closeConfirmPaymentDialog: payments.closeConfirmPaymentDialog,
    submitConfirmPayment: payments.submitConfirmPayment,
    deletePaymentDialogOpen: payments.deletePaymentDialogOpen,
    deletePaymentError: payments.deletePaymentError,
    closeDeletePaymentDialog: payments.closeDeletePaymentDialog,
    submitDeletePayment: payments.submitDeletePayment,
  };

  return {
    ids,
    currency,
    banners: {
      actionMessage: shared.actionMessage,
      actionError: shared.actionError,
    },
    busy,
    draft: draftSlice,
    invoices: invoicesSlice,
    manualPayment: manualPaymentSlice,
    payments: paymentsSlice,
    allocate: allocateSlice,
    refund: refundSlice,
    dialogs: dialogsSlice,
  };
}
