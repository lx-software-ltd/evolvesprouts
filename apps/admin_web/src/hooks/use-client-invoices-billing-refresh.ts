'use client';

import { useCallback, useRef } from 'react';

import type { ClientInvoicesBillingRefresh } from '@/hooks/client-invoices-panel-types';

type PaymentsLoader = (signal?: AbortSignal) => Promise<void>;
type InvoicesLoader = (signal?: AbortSignal) => Promise<void>;
type EnrollmentPickerLoader = (
  signal?: AbortSignal,
  overrideServerQuery?: string,
) => Promise<void>;

export function useClientInvoicesBillingRefresh() {
  const paymentsLoaderRef = useRef<PaymentsLoader>(async () => {});
  const invoicesLoaderRef = useRef<InvoicesLoader>(async () => {});
  const enrollmentPickerLoaderRef = useRef<EnrollmentPickerLoader>(
    async () => {},
  );

  const refreshPayments = useCallback(
    (signal?: AbortSignal) => paymentsLoaderRef.current(signal),
    [],
  );
  const refreshInvoices = useCallback(
    (signal?: AbortSignal) => invoicesLoaderRef.current(signal),
    [],
  );
  const refreshEnrollmentPicker = useCallback(
    (signal?: AbortSignal, overrideServerQuery?: string) =>
      enrollmentPickerLoaderRef.current(signal, overrideServerQuery),
    [],
  );
  const refreshBillingLists = useCallback(
    async (signal?: AbortSignal) => {
      await refreshPayments(signal);
      await refreshInvoices(signal);
    },
    [refreshPayments, refreshInvoices],
  );

  const billingRefresh: ClientInvoicesBillingRefresh = {
    refreshPayments,
    refreshInvoices,
    refreshEnrollmentPicker,
    refreshBillingLists,
  };

  const registerPaymentsLoader = useCallback((loader: PaymentsLoader) => {
    paymentsLoaderRef.current = loader;
  }, []);

  const registerInvoicesLoader = useCallback((loader: InvoicesLoader) => {
    invoicesLoaderRef.current = loader;
  }, []);

  const registerEnrollmentPickerLoader = useCallback(
    (loader: EnrollmentPickerLoader) => {
      enrollmentPickerLoaderRef.current = loader;
    },
    [],
  );

  return {
    billingRefresh,
    registerPaymentsLoader,
    registerInvoicesLoader,
    registerEnrollmentPickerLoader,
  };
}
