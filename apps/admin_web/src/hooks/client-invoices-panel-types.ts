import type {
  Dispatch,
  FormEvent,
  MutableRefObject,
  SetStateAction,
} from 'react';

import type {
  BillingEnrollmentPickerRow,
  CustomerInvoiceSummary,
  CustomerPaymentDetail,
  CustomerPaymentSummary,
} from '@/lib/billing-api';
import type { CustomerInvoiceLineRow } from '@/components/admin/finance/client-invoices-utils';
import type {
  InvoiceSettlementFilter,
  InvoiceStatusFilter,
} from '@/hooks/use-client-invoices-invoice-list';
import type { UseExpandedRecordReturn } from '@/hooks/use-expanded-record';

export interface ClientInvoicesPanelShared {
  draftFilterId: string;
  draftModeId: string;
  invoiceSearchFilterId: string;
  invoiceSettlementFilterId: string;
  draftInvoiceDateId: string;
  currencyOptions: ReturnType<typeof import('@/lib/format').getCurrencyOptions>;
  defaultCurrency: string;
  actionMessage: string;
  setActionMessage: Dispatch<SetStateAction<string>>;
  actionError: string;
  setActionError: Dispatch<SetStateAction<string>>;
  busyAction: string | null;
  setBusyAction: Dispatch<SetStateAction<string | null>>;
  exportBusy: boolean;
  setExportBusy: Dispatch<SetStateAction<boolean>>;
  setBusy: (key: string | null) => void;
}

/**
 * Row selection for both record tables. The selected invoice/payment is the
 * expanded row (mirrored in `?invoice=` / `?payment=`); the dirty setters feed
 * the discard-changes guard of the corresponding table.
 */
export interface ClientInvoicesSelectionState {
  selectedInvoiceId: string | null;
  setSelectedInvoiceId: (id: string | null) => void;
  setInvoiceEditorDirty: (dirty: boolean) => void;
  selectedPaymentId: string | null;
  setSelectedPaymentId: (id: string | null) => void;
  setPaymentEditorDirty: (dirty: boolean) => void;
  allocateInvoiceId: string;
  setAllocateInvoiceId: Dispatch<SetStateAction<string>>;
  allocateLineId: string;
  setAllocateLineId: Dispatch<SetStateAction<string>>;
}

export interface ClientInvoicesPaymentsInput {
  shared: ClientInvoicesPanelShared;
  selection: ClientInvoicesSelectionState;
}

export interface ClientInvoicesBillingRefresh {
  refreshPayments: (signal?: AbortSignal) => Promise<void>;
  refreshInvoices: (signal?: AbortSignal) => Promise<void>;
  refreshEnrollmentPicker: (
    signal?: AbortSignal,
    overrideServerQuery?: string,
  ) => Promise<void>;
  refreshBillingLists: (signal?: AbortSignal) => Promise<void>;
}

export interface ClientInvoicesInvoiceListInput {
  shared: ClientInvoicesPanelShared;
  selection: ClientInvoicesSelectionState;
  billingRefresh: ClientInvoicesBillingRefresh;
  loadEnrollmentPicker: (
    signal?: AbortSignal,
    overrideServerQuery?: string,
  ) => Promise<void>;
  enrollmentFilter: string;
}

export interface ClientInvoicesDraftInput {
  shared: ClientInvoicesPanelShared;
  selection: ClientInvoicesSelectionState;
  billingRefresh: ClientInvoicesBillingRefresh;
}

export interface ClientInvoicesAllocateRefundInput {
  shared: ClientInvoicesPanelShared;
  selection: ClientInvoicesSelectionState;
  invoices: CustomerInvoiceSummary[];
  selectedId: string | null;
  detail: CustomerPaymentDetail | null;
  billingRefresh: ClientInvoicesBillingRefresh;
  loadDetail: (id: string, signal?: AbortSignal) => Promise<void>;
}

export interface ClientInvoicesPanelIds {
  draftFilterId: string;
  draftModeId: string;
  invoiceSearchFilterId: string;
  invoiceSettlementFilterId: string;
  draftInvoiceDateId: string;
}

export interface ClientInvoicesPanelCurrency {
  currencyOptions: ClientInvoicesPanelShared['currencyOptions'];
  defaultCurrency: string;
}

export interface ClientInvoicesPanelBusy {
  busyAction: string | null;
  editorBusy: boolean;
  exportBusy: boolean;
}

export interface ClientInvoicesDraftEditorSlice {
  draftCreationMode: 'enrollment' | 'customized';
  setDraftCreationMode: Dispatch<SetStateAction<'enrollment' | 'customized'>>;
  customizedFormSubmitEnabled: boolean;
  setCustomizedFormSubmitEnabled: Dispatch<SetStateAction<boolean>>;
  enrollmentFilter: string;
  setEnrollmentFilter: Dispatch<SetStateAction<string>>;
  enrollmentPickerRows: BillingEnrollmentPickerRow[];
  enrollmentPickerTruncated: boolean;
  enrollmentPickerLoading: boolean;
  enrollmentPickerError: string;
  selectedEnrollmentIds: Set<string>;
  setSelectedEnrollmentIds: Dispatch<SetStateAction<Set<string>>>;
  lineOverrideByEnrollmentId: Record<string, string>;
  setLineOverrideByEnrollmentId: Dispatch<
    SetStateAction<Record<string, string>>
  >;
  draftInvoiceDateMin: string;
  draftInvoiceDateMax: string;
  draftInvoiceDate: string;
  setDraftInvoiceDate: Dispatch<SetStateAction<string>>;
  selectableFilteredRows: BillingEnrollmentPickerRow[];
  selectedEnrollmentRows: BillingEnrollmentPickerRow[];
  draftSelectionIssue: string;
  draftAmountIssue: string;
  handleCreateDraft: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  /** Runs after the customized (manual lines) draft has been created. */
  handleCustomizedCreated: (invoiceId: string) => Promise<void>;
  /** Flags unsaved draft input so switching rows asks before discarding. */
  setInvoiceEditorDirty: (dirty: boolean) => void;
  setBusy: (key: string | null) => void;
  setActionError: Dispatch<SetStateAction<string>>;
}

export interface ClientInvoicesInvoicesTableSlice {
  /** Single-open row state for the invoices table (`?invoice=`). */
  expanded: UseExpandedRecordReturn;
  invoices: CustomerInvoiceSummary[];
  invoiceListLoading: boolean;
  invoiceListLoadingMore: boolean;
  invoiceListError: string;
  invoiceListHasMore: boolean;
  invoiceStatusFilter: InvoiceStatusFilter;
  setInvoiceStatusFilter: (value: InvoiceStatusFilter) => void;
  invoiceSettlementFilter: InvoiceSettlementFilter;
  setInvoiceSettlementFilter: (value: InvoiceSettlementFilter) => void;
  invoiceCurrencyFilter: string;
  setInvoiceCurrencyFilter: (value: string) => void;
  invoiceSearchInput: string;
  setInvoiceSearchInput: (value: string) => void;
  selectedInvoiceId: string | null;
  selectedIssuedInvoice: CustomerInvoiceSummary | null;
  issuedInvoiceEmailCsv: string;
  setIssuedInvoiceEmailCsv: Dispatch<SetStateAction<string>>;
  issuedInvoiceEmailError: string;
  setIssuedInvoiceEmailError: Dispatch<SetStateAction<string>>;
  issuedInvoiceEmailDirtyRef: MutableRefObject<boolean>;
  setInvoiceEditorDirty: (dirty: boolean) => void;
  handleEmailIssuedInvoice: () => Promise<void>;
  loadMoreInvoices: () => Promise<void>;
  handleOpenInvoicePdfPreview: (invoiceId: string) => Promise<void>;
  handleIssueRow: (invoiceId: string) => Promise<void>;
  openVoidInvoiceDialog: (invoiceId: string) => void;
  openDeleteDraftInvoiceDialog: (invoiceId: string) => void;
  deleteDraftDialogOpen: boolean;
  voidDialogOpen: boolean;
}

export interface ClientInvoicesManualPaymentEditorSlice {
  createPaymentEnrollmentId: string;
  setCreatePaymentEnrollmentId: Dispatch<SetStateAction<string>>;
  createPaymentEnrollmentPickerValue: string;
  createPaymentAmount: string;
  setCreatePaymentAmount: Dispatch<SetStateAction<string>>;
  createPaymentCurrency: string;
  setCreatePaymentCurrency: Dispatch<SetStateAction<string>>;
  createPaymentMethod: string;
  setCreatePaymentMethod: Dispatch<SetStateAction<string>>;
  createPaymentStatus: 'pending' | 'succeeded';
  setCreatePaymentStatus: Dispatch<SetStateAction<'pending' | 'succeeded'>>;
  createPaymentExternalRef: string;
  setCreatePaymentExternalRef: Dispatch<SetStateAction<string>>;
  manualPaymentIsUpdate: boolean;
  manualPaymentSucceededReadOnly: boolean;
  manualPaymentEnrollmentEditLabel: string;
  handleManualPaymentFormSubmit: (
    event: FormEvent<HTMLFormElement>,
  ) => Promise<void>;
  /** Flags unsaved payment input so switching rows asks before discarding. */
  setPaymentEditorDirty: (dirty: boolean) => void;
  enrollmentPickerRows: BillingEnrollmentPickerRow[];
}

export interface ClientInvoicesPaymentsTableSlice {
  /** Single-open row state for the payments table (`?payment=`). */
  expanded: UseExpandedRecordReturn;
  payments: CustomerPaymentSummary[];
  listLoading: boolean;
  listLoadingMore: boolean;
  listHasMore: boolean;
  listError: string;
  loadMorePayments: () => Promise<void>;
  selectedId: string | null;
  /** Full record of the expanded payment (allocations); `null` until loaded. */
  detail: CustomerPaymentDetail | null;
  detailError: string;
  exportBusy: boolean;
  handleExport: () => Promise<void>;
  openConfirmPaymentDialog: (paymentId: string) => void;
  openDeletePaymentDialog: (paymentId: string) => void;
  confirmPaymentId: string | null;
  deletePaymentDialogOpen: boolean;
  confirmPaymentDialogOpen: boolean;
}

export interface ClientInvoicesAllocateEditorSlice {
  allocateInvoiceId: string;
  setAllocateInvoiceId: Dispatch<SetStateAction<string>>;
  allocateLineId: string;
  setAllocateLineId: Dispatch<SetStateAction<string>>;
  allocateAmount: string;
  setAllocateAmount: Dispatch<SetStateAction<string>>;
  allocateCurrency: string;
  setAllocateCurrency: Dispatch<SetStateAction<string>>;
  allocateInvoiceLinesLoading: boolean;
  allocateInvoiceLinesError: string;
  allocateLinesOrdered: CustomerInvoiceLineRow[];
  allocateLineDescriptionCounts: Map<string, number>;
  issuedInvoicesForAllocate: CustomerInvoiceSummary[];
  handleAllocate: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  invoices: CustomerInvoiceSummary[];
}

export interface ClientInvoicesRefundEditorSlice {
  /** The expanded issued invoice; refunds always target one of its payments. */
  refundInvoiceId: string;
  refundPaymentSelectId: string;
  setRefundPaymentSelectId: Dispatch<SetStateAction<string>>;
  refundPaymentsLoading: boolean;
  refundPaymentsError: string;
  refundEligiblePayments: CustomerPaymentSummary[];
  refundAmount: string;
  setRefundAmount: Dispatch<SetStateAction<string>>;
  refundCurrency: string;
  setRefundCurrency: Dispatch<SetStateAction<string>>;
  refundMethod: string;
  setRefundMethod: Dispatch<SetStateAction<string>>;
  refundStripeId: string;
  setRefundStripeId: Dispatch<SetStateAction<string>>;
  handleRefund: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

export interface ClientInvoicesBillingDialogsSlice {
  voidDialogOpen: boolean;
  voidReason: string;
  setVoidReason: Dispatch<SetStateAction<string>>;
  voidError: string;
  setVoidError: Dispatch<SetStateAction<string>>;
  closeVoidInvoiceDialog: () => void;
  confirmVoidInvoice: () => Promise<void>;
  deleteDraftDialogOpen: boolean;
  deleteDraftError: string;
  closeDeleteDraftInvoiceDialog: () => void;
  confirmDeleteDraftInvoice: () => Promise<void>;
  confirmPaymentDialogOpen: boolean;
  confirmPaymentExternalRef: string;
  setConfirmPaymentExternalRef: Dispatch<SetStateAction<string>>;
  confirmPaymentError: string;
  setConfirmPaymentError: Dispatch<SetStateAction<string>>;
  closeConfirmPaymentDialog: () => void;
  submitConfirmPayment: () => Promise<void>;
  deletePaymentDialogOpen: boolean;
  deletePaymentError: string;
  closeDeletePaymentDialog: () => void;
  submitDeletePayment: () => Promise<void>;
}

export type ClientInvoicesEnrollmentPickerRows = BillingEnrollmentPickerRow[];

export type ClientInvoicesPaymentSummaries = CustomerPaymentSummary[];
