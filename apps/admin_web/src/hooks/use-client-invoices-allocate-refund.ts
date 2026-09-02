'use client';

import type { FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ClientInvoicesAllocateRefundInput } from '@/hooks/client-invoices-panel-types';
import { toErrorMessage } from '@/hooks/hook-errors';
import { ADMIN_API_MAX_LIST_LIMIT } from '@/lib/admin-list-query';
import {
  createCustomerRefund,
  createPaymentAllocation,
  getCustomerInvoice,
  listCustomerPayments,
  type CustomerPaymentSummary,
} from '@/lib/billing-api';
import {
  currencySelectValue,
  invoiceLineSortKey,
  type CustomerInvoiceLineRow,
} from '@/components/admin/finance/client-invoices-utils';

export function useClientInvoicesAllocateRefund({
  shared,
  selection,
  invoices,
  selectedId,
  detail,
  billingRefresh,
  loadDetail,
}: ClientInvoicesAllocateRefundInput) {
  const {
    currencyOptions,
    defaultCurrency,
    setActionMessage,
    setActionError,
    setBusy,
  } = shared;
  const {
    selectedInvoiceId,
    allocateInvoiceId,
    setAllocateInvoiceId,
    allocateLineId,
    setAllocateLineId,
  } = selection;

  const [allocateAmount, setAllocateAmount] = useState('');
  const [allocateCurrency, setAllocateCurrency] = useState(defaultCurrency);
  const [allocateInvoiceLines, setAllocateInvoiceLines] = useState<
    CustomerInvoiceLineRow[]
  >([]);
  const [allocateInvoiceLinesLoading, setAllocateInvoiceLinesLoading] =
    useState(false);
  const [allocateInvoiceLinesError, setAllocateInvoiceLinesError] =
    useState('');

  const [refundInvoiceId, setRefundInvoiceId] = useState('');
  const [refundPaymentSelectId, setRefundPaymentSelectId] = useState('');
  const [refundPaymentsForInvoice, setRefundPaymentsForInvoice] = useState<
    CustomerPaymentSummary[]
  >([]);
  const [refundPaymentsLoading, setRefundPaymentsLoading] = useState(false);
  const [refundPaymentsError, setRefundPaymentsError] = useState('');
  const [refundInvoicePaymentsRefresh, setRefundInvoicePaymentsRefresh] =
    useState(0);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundCurrency, setRefundCurrency] = useState(defaultCurrency);
  const [refundMethod, setRefundMethod] = useState('');
  const [refundStripeId, setRefundStripeId] = useState('');

  const lastPaymentSeedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedInvoiceId) {
      return;
    }
    const inv = invoices.find((i) => i.id === selectedInvoiceId);
    if (inv?.status === 'issued') {
      setRefundInvoiceId(selectedInvoiceId);
    }
  }, [selectedInvoiceId, invoices]);

  const allocateLinesOrdered = useMemo(
    () =>
      [...allocateInvoiceLines].sort(
        (a, b) => invoiceLineSortKey(a) - invoiceLineSortKey(b),
      ),
    [allocateInvoiceLines],
  );

  const allocateLineDescriptionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of allocateLinesOrdered) {
      const d = line.description?.trim() ?? '';
      if (d !== '') {
        counts.set(d, (counts.get(d) ?? 0) + 1);
      }
    }
    return counts;
  }, [allocateLinesOrdered]);

  const refundEligiblePayments = useMemo(
    () =>
      refundPaymentsForInvoice.filter(
        (p) => p.direction === 'inbound' && p.status === 'succeeded',
      ),
    [refundPaymentsForInvoice],
  );

  useEffect(() => {
    const trimmed = allocateInvoiceId.trim();
    if (trimmed === '') {
      setAllocateInvoiceLines([]);
      setAllocateInvoiceLinesError('');
      setAllocateInvoiceLinesLoading(false);
      setAllocateLineId('');
      return;
    }
    const invRow = invoices.find((i) => i.id === trimmed);
    if (invRow?.status !== 'issued') {
      setAllocateInvoiceLines([]);
      setAllocateInvoiceLinesError('');
      setAllocateInvoiceLinesLoading(false);
      setAllocateLineId('');
      return;
    }
    const ac = new AbortController();
    setAllocateInvoiceLinesLoading(true);
    setAllocateInvoiceLinesError('');
    void (async () => {
      try {
        const invoiceDetail = await getCustomerInvoice(trimmed, ac.signal);
        if (ac.signal.aborted) {
          return;
        }
        const lines = Array.isArray(invoiceDetail.lines)
          ? invoiceDetail.lines
          : [];
        setAllocateInvoiceLines(lines);
        setAllocateLineId((prev) => {
          const ok = lines.some((l) => l.id === prev);
          return ok ? prev : '';
        });
      } catch (caught) {
        if (caught instanceof Error && caught.name === 'AbortError') {
          return;
        }
        if (!ac.signal.aborted) {
          setAllocateInvoiceLines([]);
          setAllocateLineId('');
          setAllocateInvoiceLinesError(
            toErrorMessage(caught, 'Failed to load invoice lines.', {
              honorBackendMessage: true,
            }),
          );
        }
      } finally {
        if (!ac.signal.aborted) {
          setAllocateInvoiceLinesLoading(false);
        }
      }
    })();
    return () => ac.abort();
  }, [allocateInvoiceId, invoices, setAllocateLineId]);

  useEffect(() => {
    if (!selectedId) {
      lastPaymentSeedIdRef.current = null;
      return;
    }
    if (!detail || detail.id !== selectedId) {
      return;
    }
    if (lastPaymentSeedIdRef.current === selectedId) {
      return;
    }
    lastPaymentSeedIdRef.current = selectedId;
    const cur = detail.currency ?? defaultCurrency;
    setAllocateCurrency(
      currencySelectValue(cur, currencyOptions, defaultCurrency),
    );
    setRefundPaymentSelectId(detail.id ?? '');
    setRefundCurrency(
      currencySelectValue(cur, currencyOptions, defaultCurrency),
    );
  }, [selectedId, detail, currencyOptions, defaultCurrency]);

  useEffect(() => {
    if (!selectedId || !detail) {
      return;
    }
    const refs = detail.allocationInvoices ?? [];
    if (refs.length === 0) {
      return;
    }
    const ids = new Set(refs.map((r) => r.invoiceId));
    setRefundInvoiceId((prev) => {
      if (prev && ids.has(prev)) {
        return prev;
      }
      const preferred = allocateInvoiceId.trim();
      if (preferred && ids.has(preferred)) {
        return preferred;
      }
      return refs[0]?.invoiceId ?? '';
    });
  }, [selectedId, detail, allocateInvoiceId]);

  useEffect(() => {
    const trimmed = refundInvoiceId.trim();
    if (trimmed === '') {
      setRefundPaymentsForInvoice([]);
      setRefundPaymentsLoading(false);
      setRefundPaymentsError('');
      return;
    }
    const ac = new AbortController();
    setRefundPaymentsLoading(true);
    setRefundPaymentsError('');
    void (async () => {
      try {
        // Refund sources are the payments allocated to one invoice; a single
        // max-size page covers that set.
        const { items } = await listCustomerPayments(
          { invoiceId: trimmed, limit: ADMIN_API_MAX_LIST_LIMIT },
          ac.signal,
        );
        if (ac.signal.aborted) {
          return;
        }
        setRefundPaymentsForInvoice(items);
        setRefundPaymentSelectId((prev) => {
          const inboundMatch = items.find(
            (p) =>
              p.id === prev &&
              p.direction === 'inbound' &&
              p.status === 'succeeded',
          );
          if (inboundMatch) {
            return prev;
          }
          const selectedMatch =
            selectedId &&
            items.find(
              (p) =>
                p.id === selectedId &&
                p.direction === 'inbound' &&
                p.status === 'succeeded',
            );
          if (selectedMatch) {
            return selectedId;
          }
          return (
            items.find(
              (p) => p.direction === 'inbound' && p.status === 'succeeded',
            )?.id ?? ''
          );
        });
      } catch (caught) {
        if (caught instanceof Error && caught.name === 'AbortError') {
          return;
        }
        if (!ac.signal.aborted) {
          setRefundPaymentsForInvoice([]);
          setRefundPaymentSelectId('');
          setRefundPaymentsError(
            toErrorMessage(caught, 'Failed to load payments for invoice.', {
              honorBackendMessage: true,
            }),
          );
        }
      } finally {
        if (!ac.signal.aborted) {
          setRefundPaymentsLoading(false);
        }
      }
    })();
    return () => ac.abort();
  }, [refundInvoiceId, selectedId, refundInvoicePaymentsRefresh]);

  const handleAllocate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError('');
    setActionMessage('');
    if (!selectedId) {
      setActionError('Select a payment row first.');
      return;
    }
    const invId = allocateInvoiceId.trim();
    if (!invId) {
      setActionError('Select an issued invoice for allocation.');
      return;
    }
    const allocateTarget = invoices.find((i) => i.id === invId);
    if (!allocateTarget || allocateTarget.status !== 'issued') {
      setActionError('Select an issued invoice for allocation.');
      return;
    }
    const amt = allocateAmount.trim();
    if (!amt) {
      setActionError('Allocated amount is required.');
      return;
    }
    setBusy('allocate');
    try {
      const out = await createPaymentAllocation({
        paymentId: selectedId,
        invoiceId: invId,
        invoiceLineId:
          allocateLineId.trim() === '' ? null : allocateLineId.trim(),
        allocatedAmount: amt,
        currency: allocateCurrency.trim().toUpperCase() || defaultCurrency,
      });
      setActionMessage(`Allocation created: ${out.allocationId}`);
      await billingRefresh.refreshPayments();
      const ac = new AbortController();
      await loadDetail(selectedId, ac.signal);
      await billingRefresh.refreshInvoices();
    } catch (caught) {
      setActionError(
        toErrorMessage(caught, 'Allocation failed.', {
          honorBackendMessage: true,
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleRefund = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError('');
    setActionMessage('');
    const orig = refundPaymentSelectId.trim();
    if (!orig) {
      setActionError('Select an inbound payment allocated to the invoice.');
      return;
    }
    const amt = refundAmount.trim();
    if (!amt) {
      setActionError('Refund amount is required.');
      return;
    }
    setBusy('refund');
    try {
      await createCustomerRefund({
        direction: 'refund',
        originalPaymentId: orig,
        amount: amt,
        currency: refundCurrency.trim().toUpperCase() || defaultCurrency,
        method: refundMethod.trim() === '' ? undefined : refundMethod.trim(),
        stripeRefundId:
          refundStripeId.trim() === '' ? null : refundStripeId.trim(),
      });
      setActionMessage('Refund payment row recorded.');
      await billingRefresh.refreshPayments();
      setRefundInvoicePaymentsRefresh((n) => n + 1);
    } catch (caught) {
      setActionError(
        toErrorMessage(caught, 'Refund failed.', { honorBackendMessage: true }),
      );
    } finally {
      setBusy(null);
    }
  };

  return {
    allocateInvoiceId,
    setAllocateInvoiceId,
    allocateLineId,
    setAllocateLineId,
    allocateAmount,
    setAllocateAmount,
    allocateCurrency,
    setAllocateCurrency,
    allocateInvoiceLines,
    allocateInvoiceLinesLoading,
    allocateInvoiceLinesError,
    allocateLinesOrdered,
    allocateLineDescriptionCounts,
    refundInvoiceId,
    setRefundInvoiceId,
    refundPaymentSelectId,
    setRefundPaymentSelectId,
    refundPaymentsLoading,
    refundPaymentsError,
    refundEligiblePayments,
    refundAmount,
    setRefundAmount,
    refundCurrency,
    setRefundCurrency,
    refundMethod,
    setRefundMethod,
    refundStripeId,
    setRefundStripeId,
    handleAllocate,
    handleRefund,
  };
}

export type ClientInvoicesAllocateRefundVm = ReturnType<
  typeof useClientInvoicesAllocateRefund
>;
