'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ClientInvoicesDraftInput } from '@/hooks/client-invoices-panel-types';
import { toErrorMessage } from '@/hooks/hook-errors';
import {
  createDraftInvoice,
  listRecentEnrollmentsForInvoicing,
  compareBillingEnrollmentPickerRowsByEnrolledAtDesc,
  type BillingEnrollmentPickerRow,
} from '@/lib/billing-api';
import { localTodayYmd } from '@/lib/format';
import {
  defaultLineAmount,
  lineAmountsDiffer,
  parseAmountInput,
} from '@/components/admin/finance/client-invoices-utils';

export function useClientInvoicesDraft({
  shared,
  selection,
  billingRefresh,
}: ClientInvoicesDraftInput) {
  const { setActionMessage, setActionError, setBusy } = shared;
  const { setSelectedInvoiceId, setAllocateInvoiceId, setAllocateLineId } =
    selection;

  const [draftCreationMode, setDraftCreationMode] = useState<
    'enrollment' | 'customized'
  >('enrollment');
  const [customizedFormSubmitEnabled, setCustomizedFormSubmitEnabled] =
    useState(false);

  const [enrollmentPickerRows, setEnrollmentPickerRows] = useState<
    BillingEnrollmentPickerRow[]
  >([]);
  const [enrollmentPickerTruncated, setEnrollmentPickerTruncated] =
    useState(false);
  const [enrollmentPickerLoading, setEnrollmentPickerLoading] = useState(true);
  const [enrollmentPickerError, setEnrollmentPickerError] = useState('');
  const [enrollmentFilter, setEnrollmentFilter] = useState('');
  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState<
    Set<string>
  >(() => new Set());
  const [lineOverrideByEnrollmentId, setLineOverrideByEnrollmentId] = useState<
    Record<string, string>
  >({});
  const draftInvoiceDateMin = '2000-01-01';
  const draftInvoiceDateMax = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 365);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);
  const [draftInvoiceDate, setDraftInvoiceDate] = useState<string>(() =>
    localTodayYmd(),
  );

  const [debouncedEnrollmentFilter, setDebouncedEnrollmentFilter] =
    useState('');

  useEffect(() => {
    const t = window.setTimeout(
      () => setDebouncedEnrollmentFilter(enrollmentFilter.trim()),
      350,
    );
    return () => window.clearTimeout(t);
  }, [enrollmentFilter]);

  const loadEnrollmentPicker = useCallback(
    async (signal?: AbortSignal, overrideServerQuery?: string) => {
      setEnrollmentPickerLoading(true);
      setEnrollmentPickerError('');
      const serverQuery =
        overrideServerQuery !== undefined
          ? overrideServerQuery
          : debouncedEnrollmentFilter;
      try {
        const { items, truncated } = await listRecentEnrollmentsForInvoicing(
          signal,
          serverQuery === '' ? undefined : { q: serverQuery },
        );
        setEnrollmentPickerRows(items);
        setEnrollmentPickerTruncated(truncated);
        setSelectedEnrollmentIds((prev) => {
          const allowed = new Set(
            items.filter((r) => !r.invoiceLinked).map((r) => r.enrollmentId),
          );
          const next = new Set<string>();
          for (const id of prev) {
            if (allowed.has(id)) {
              next.add(id);
            }
          }
          return next;
        });
      } catch (caught) {
        if (caught instanceof Error && caught.name === 'AbortError') {
          return;
        }
        const message = toErrorMessage(
          caught,
          'Failed to load enrollments for invoicing.',
          { honorBackendMessage: true },
        );
        setEnrollmentPickerError(message);
        setEnrollmentPickerRows([]);
        setEnrollmentPickerTruncated(false);
      } finally {
        setEnrollmentPickerLoading(false);
      }
    },
    [debouncedEnrollmentFilter],
  );

  useEffect(() => {
    const ac = new AbortController();
    void loadEnrollmentPicker(ac.signal);
    return () => ac.abort();
  }, [loadEnrollmentPicker]);

  const selectableFilteredRows = useMemo(
    () => enrollmentPickerRows.filter((row) => !row.invoiceLinked),
    [enrollmentPickerRows],
  );

  const selectedEnrollmentRows = useMemo(() => {
    const map = new Map(enrollmentPickerRows.map((r) => [r.enrollmentId, r]));
    const out: BillingEnrollmentPickerRow[] = [];
    for (const id of selectedEnrollmentIds) {
      const row = map.get(id);
      if (row) {
        out.push(row);
      }
    }
    out.sort(compareBillingEnrollmentPickerRowsByEnrolledAtDesc);
    return out;
  }, [enrollmentPickerRows, selectedEnrollmentIds]);

  const draftSelectionIssue = useMemo(() => {
    if (selectedEnrollmentRows.length === 0) {
      return '';
    }
    const currencies = new Set(selectedEnrollmentRows.map((r) => r.currency));
    if (currencies.size > 1) {
      return 'Selected enrollments must share one currency.';
    }
    const billKeys = new Set(
      selectedEnrollmentRows.map((r) => r.billToMergeKey),
    );
    if (billKeys.size > 1) {
      return 'Selected enrollments must share the same bill-to (contact/family/organization).';
    }
    return '';
  }, [selectedEnrollmentRows]);

  const draftAmountIssue = useMemo(() => {
    for (const row of selectedEnrollmentRows) {
      const raw =
        lineOverrideByEnrollmentId[row.enrollmentId] ?? defaultLineAmount(row);
      const amt = parseAmountInput(raw);
      if (amt === null) {
        return 'Enter a valid number for every line total (0 is allowed).';
      }
    }
    return '';
  }, [selectedEnrollmentRows, lineOverrideByEnrollmentId]);

  const handleCreateDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError('');
    setActionMessage('');
    const ids = [...selectedEnrollmentIds];
    if (ids.length === 0) {
      setActionError('Select at least one enrollment.');
      return;
    }
    const rowsById = new Map(
      enrollmentPickerRows.map((r) => [r.enrollmentId, r]),
    );
    for (const id of ids) {
      const row = rowsById.get(id);
      if (!row || row.invoiceLinked) {
        setActionError(
          'The enrollment list changed; update your selection and try again.',
        );
        return;
      }
    }
    const overrides: Record<string, string> = {};
    for (const id of ids) {
      const row = rowsById.get(id);
      if (!row) {
        continue;
      }
      const raw = lineOverrideByEnrollmentId[id] ?? defaultLineAmount(row);
      const trimmed = raw.trim();
      const normalized = trimmed === '' ? defaultLineAmount(row) : trimmed;
      if (lineAmountsDiffer(normalized, row)) {
        overrides[id] = normalized;
      }
    }
    if (draftSelectionIssue) {
      setActionError(draftSelectionIssue);
      return;
    }
    if (draftAmountIssue) {
      setActionError(draftAmountIssue);
      return;
    }
    setBusy('draft');
    try {
      const body: Parameters<typeof createDraftInvoice>[0] = {
        draftKind: 'enrollment_merge',
        enrollmentIds: ids,
      };
      if (Object.keys(overrides).length > 0) {
        body.lineTotalsByEnrollmentId = overrides;
      }
      if (draftInvoiceDate.trim() !== '') {
        body.invoiceDate = draftInvoiceDate.trim();
      }
      const result = await createDraftInvoice(body);
      setSelectedInvoiceId(result.invoiceId);
      setAllocateInvoiceId('');
      setAllocateLineId('');
      setActionMessage(`Draft invoice created: ${result.invoiceId}`);
      setDraftInvoiceDate(localTodayYmd());
      await billingRefresh.refreshBillingLists();
      await billingRefresh.refreshEnrollmentPicker(
        undefined,
        enrollmentFilter.trim(),
      );
    } catch (caught) {
      setActionError(
        toErrorMessage(caught, 'Create draft failed.', {
          honorBackendMessage: true,
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  return {
    draftCreationMode,
    setDraftCreationMode,
    customizedFormSubmitEnabled,
    setCustomizedFormSubmitEnabled,
    enrollmentFilter,
    setEnrollmentFilter,
    enrollmentPickerRows,
    enrollmentPickerTruncated,
    enrollmentPickerLoading,
    enrollmentPickerError,
    selectedEnrollmentIds,
    setSelectedEnrollmentIds,
    lineOverrideByEnrollmentId,
    setLineOverrideByEnrollmentId,
    draftInvoiceDateMin,
    draftInvoiceDateMax,
    draftInvoiceDate,
    setDraftInvoiceDate,
    selectableFilteredRows,
    selectedEnrollmentRows,
    draftSelectionIssue,
    draftAmountIssue,
    handleCreateDraft,
    loadEnrollmentPicker,
  };
}

export type ClientInvoicesDraftVm = ReturnType<typeof useClientInvoicesDraft>;
