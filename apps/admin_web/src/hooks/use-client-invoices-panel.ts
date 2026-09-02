'use client';

import { useEffect, useState } from 'react';

import type { ClientInvoicesSelectionState } from '@/hooks/client-invoices-panel-types';
import { useClientInvoicesAllocateRefund } from '@/hooks/use-client-invoices-allocate-refund';
import { useClientInvoicesBillingRefresh } from '@/hooks/use-client-invoices-billing-refresh';
import { useClientInvoicesDraft } from '@/hooks/use-client-invoices-draft';
import { useClientInvoicesInvoiceList } from '@/hooks/use-client-invoices-invoice-list';
import { useClientInvoicesPayments } from '@/hooks/use-client-invoices-payments';
import { useClientInvoicesPanelShared } from '@/hooks/use-client-invoices-panel-shared';

export function useClientInvoicesPanel() {
  const shared = useClientInvoicesPanelShared();

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
    null,
  );
  const [allocateInvoiceId, setAllocateInvoiceId] = useState('');
  const [allocateLineId, setAllocateLineId] = useState('');

  const selection: ClientInvoicesSelectionState = {
    selectedInvoiceId,
    setSelectedInvoiceId,
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
    refreshBillingLists: billingRefresh.refreshBillingLists,
    setBusy: shared.setBusy,
    setActionError: shared.setActionError,
    setSelectedInvoiceId,
    setAllocateInvoiceId,
    setAllocateLineId,
    setActionMessage: shared.setActionMessage,
  };

  const invoicesSlice = {
    invoices: invoiceList.invoices,
    invoiceListLoading: invoiceList.invoiceListLoading,
    invoiceListLoadingMore: invoiceList.invoiceListLoadingMore,
    invoiceListError: invoiceList.invoiceListError,
    invoiceListCursor: invoiceList.invoiceListCursor,
    invoiceStatusFilter: invoiceList.invoiceStatusFilter,
    setInvoiceStatusFilter: invoiceList.setInvoiceStatusFilter,
    invoiceSettlementFilter: invoiceList.invoiceSettlementFilter,
    setInvoiceSettlementFilter: invoiceList.setInvoiceSettlementFilter,
    invoiceCurrencyFilter: invoiceList.invoiceCurrencyFilter,
    setInvoiceCurrencyFilter: invoiceList.setInvoiceCurrencyFilter,
    invoiceSearchInput: invoiceList.invoiceSearchInput,
    setInvoiceSearchInput: invoiceList.setInvoiceSearchInput,
    selectedInvoiceId,
    setSelectedInvoiceId,
    selectedIssuedInvoice: invoiceList.selectedIssuedInvoice,
    issuedInvoiceEmailCsv: invoiceList.issuedInvoiceEmailCsv,
    setIssuedInvoiceEmailCsv: invoiceList.setIssuedInvoiceEmailCsv,
    issuedInvoiceEmailError: invoiceList.issuedInvoiceEmailError,
    setIssuedInvoiceEmailError: invoiceList.setIssuedInvoiceEmailError,
    issuedInvoiceEmailDirtyRef: invoiceList.issuedInvoiceEmailDirtyRef,
    handleEmailIssuedInvoice: invoiceList.handleEmailIssuedInvoice,
    loadMoreInvoices: invoiceList.loadMoreInvoices,
    handleOpenInvoicePdfPreview: invoiceList.handleOpenInvoicePdfPreview,
    handleIssueRow: invoiceList.handleIssueRow,
    openVoidInvoiceDialog: invoiceList.openVoidInvoiceDialog,
    openDeleteDraftInvoiceDialog: invoiceList.openDeleteDraftInvoiceDialog,
    deleteDraftDialogOpen: invoiceList.deleteDraftDialogOpen,
    voidDialogOpen: invoiceList.voidDialogOpen,
    setAllocateInvoiceId,
    setAllocateLineId,
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
    handleCancelManualPayment: payments.handleCancelManualPayment,
    handleManualPaymentFormSubmit: payments.handleManualPaymentFormSubmit,
    enrollmentPickerRows: draft.enrollmentPickerRows,
  };

  const paymentsSlice = {
    payments: payments.payments,
    listLoading: payments.listLoading,
    listError: payments.listError,
    selectedId: payments.selectedId,
    setSelectedId: payments.setSelectedId,
    setManualPaymentPreferCreateForm: payments.setManualPaymentPreferCreateForm,
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
    setRefundInvoiceId: allocateRefund.setRefundInvoiceId,
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
    issuedInvoicesForAllocate: invoiceList.issuedInvoicesForAllocate,
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
