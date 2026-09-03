'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { WarningTriangleIcon } from '@/components/icons/action-icons';
import { Button } from '@/components/ui/button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { Select } from '@/components/ui/select';
import { toErrorMessage } from '@/hooks/hook-errors';
import { useFxMultipliersForCurrencies } from '@/hooks/use-fx-multipliers-for-currencies';
import {
  ADMIN_TAX_FISCAL_YEAR_EMPTY_MESSAGE,
  MIN_ADMIN_TAX_FISCAL_YEAR_START,
  enumerateAdminTaxFiscalYearStartYears,
} from '@/lib/admin-tax-fiscal-year';
import { listAllCustomerInvoices, type CustomerInvoiceSummary } from '@/lib/billing-api';
import { getAdminDefaultCurrencyCode } from '@/lib/config';
import { listAllAdminExpenses } from '@/lib/expenses-api';
import { getFiscalYearRangeInclusive } from '@/lib/fiscal-year';
import { formatDateOnly, formatEnumLabel } from '@/lib/format';
import {
  DEFAULT_TAX_FISCAL_YEAR_STATUS_FILTER,
  TAX_FISCAL_YEAR_STATUS_FILTERS,
  buildTaxFiscalYearRows,
  defaultFiscalYearStartYear,
  taxFiscalYearRowsToCsv,
  type TaxFiscalYearRow,
  type TaxFiscalYearStatusFilter,
} from '@/lib/tax-fiscal-year-report';
import { formatMoneyLineWithFxToDefault } from '@/lib/vendor-spend';
import type { Expense } from '@/types/expenses';

const COLUMN_COUNT = 6;

function isTaxDisplayedAsDash(tax: string | undefined): boolean {
  const t = tax?.trim() ?? '';
  if (t === '') {
    return true;
  }
  const n = Number.parseFloat(t.replace(/,/g, ''));
  return Number.isFinite(n) && n === 0;
}

export function TaxFiscalYearPanel() {
  const fySelectId = useId();
  const statusSelectId = useId();
  const [fyStartYear, setFyStartYear] = useState(
    () => Math.max(MIN_ADMIN_TAX_FISCAL_YEAR_START, defaultFiscalYearStartYear()),
  );
  const [statusFilter, setStatusFilter] = useState<TaxFiscalYearStatusFilter>(
    DEFAULT_TAX_FISCAL_YEAR_STATUS_FILTER,
  );
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [expensesPayload, setExpensesPayload] = useState<Expense[] | null>(null);
  const [invoicesPayload, setInvoicesPayload] = useState<CustomerInvoiceSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const [expenses, invoices] = await Promise.all([
          listAllAdminExpenses(),
          listAllCustomerInvoices(),
        ]);
        if (!cancelled) {
          setExpensesPayload(expenses);
          setInvoicesPayload(invoices);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(toErrorMessage(error, 'Could not load tax fiscal-year data.'));
          setExpensesPayload([]);
          setInvoicesPayload([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo<TaxFiscalYearRow[]>(() => {
    if (!expensesPayload || !invoicesPayload) {
      return [];
    }
    return buildTaxFiscalYearRows(expensesPayload, invoicesPayload, fyStartYear, statusFilter);
  }, [expensesPayload, invoicesPayload, fyStartYear, statusFilter]);

  const rowsNeedForeignFx = useMemo(() => {
    const defaultCurrency = getAdminDefaultCurrencyCode();
    return rows.some((row) => (row.currency?.trim().toUpperCase() || defaultCurrency) !== defaultCurrency);
  }, [rows]);

  const taxFxCurrencyCodes = useMemo(
    () => rows.map((row) => row.currency?.trim().toUpperCase()).filter((c): c is string => Boolean(c)),
    [rows]
  );
  const taxFxEnabled = rowsNeedForeignFx && Boolean(expensesPayload && invoicesPayload);
  const { fxMultipliers, fxError } = useFxMultipliersForCurrencies(taxFxCurrencyCodes, taxFxEnabled);

  const fyMeta = useMemo(() => getFiscalYearRangeInclusive(fyStartYear), [fyStartYear]);

  const fyYearOptions = useMemo(() => enumerateAdminTaxFiscalYearStartYears(), []);

  const downloadCsv = useCallback(() => {
    const csv = taxFiscalYearRowsToCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tax-fiscal-year-${fyStartYear}-${fyStartYear + 1}-${statusFilter}.csv`;
    anchor.rel = 'noopener';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [rows, fyStartYear, statusFilter]);

  const tableError = [loadError, fxError].filter(Boolean).join(' • ');
  const controlsDisabled = isLoading || Boolean(tableError);

  function formatAmount(value: string | undefined, currency: string | undefined): string {
    if (fxMultipliers === null && rowsNeedForeignFx) {
      return '…';
    }
    return formatMoneyLineWithFxToDefault(value ?? '', currency, fxMultipliers ?? new Map());
  }

  return (
    <AdminRecordTable
      aria-label='Tax fiscal year'
      columnCount={COLUMN_COUNT}
      rowCount={rows.length}
      isLoading={isLoading}
      error={tableError}
      errorTitle='Tax'
      emptyLabel={ADMIN_TAX_FISCAL_YEAR_EMPTY_MESSAGE}
      filters={
        <AdminFilterBar
          summary={`Hong Kong fiscal year ${fyMeta.start} to ${fyMeta.end}. Expenses use invoice date when set; otherwise paid date. Revenue uses invoice totals by the invoice date (issue timestamp if missing).`}
          trailing={
            <Button
              type='button'
              variant='outline'
              className='h-10 w-full sm:h-9 sm:w-auto'
              onClick={() => downloadCsv()}
              disabled={controlsDisabled || rows.length === 0}
            >
              Download CSV
            </Button>
          }
        >
          <AdminFilterField label='Fiscal year' htmlFor={fySelectId} className='sm:basis-44'>
            <Select
              id={fySelectId}
              value={String(fyStartYear)}
              onChange={(event) => setFyStartYear(Number.parseInt(event.target.value, 10))}
              disabled={controlsDisabled}
            >
              {fyYearOptions.map((y) => {
                const range = getFiscalYearRangeInclusive(y);
                const label = `${range.start.slice(0, 4)} - ${range.end.slice(0, 4)}`;
                return (
                  <option key={y} value={y}>
                    {label}
                  </option>
                );
              })}
            </Select>
          </AdminFilterField>
          <AdminFilterField label='Status' htmlFor={statusSelectId} className='sm:basis-44'>
            <Select
              id={statusSelectId}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as TaxFiscalYearStatusFilter)}
              disabled={controlsDisabled}
            >
              {TAX_FISCAL_YEAR_STATUS_FILTERS.map((entry) => (
                <option key={entry} value={entry}>
                  {formatEnumLabel(entry)}
                </option>
              ))}
            </Select>
          </AdminFilterField>
        </AdminFilterBar>
      }
      head={
        <tr>
          <AdminDataTableHeadCell>Description</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='secondary'>Type</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='secondary'>Date</AdminDataTableHeadCell>
          <AdminDataTableHeadCell className='text-right'>Amount</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='tertiary' className='text-right'>
            Tax
          </AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='tertiary'>Status</AdminDataTableHeadCell>
        </tr>
      }
    >
      {rows.map((row) => {
        const kindLabel = row.kind === 'revenue' ? 'Revenue' : 'Expense';
        const dateLabel = formatDateOnly(row.classificationDate);
        const statusLabel = row.status !== '' ? row.status : '—';
        return (
          <tr key={`${row.kind}:${row.referenceId}`}>
            <AdminDataTableCell>
              <p className='font-medium text-slate-900'>{row.description}</p>
              <AdminDataTableCellMeta>
                {kindLabel} · {dateLabel} · {statusLabel}
              </AdminDataTableCellMeta>
            </AdminDataTableCell>
            <AdminDataTableCell priority='secondary'>{kindLabel}</AdminDataTableCell>
            <AdminDataTableCell priority='secondary'>
              <div className='flex flex-wrap items-center gap-2'>
                <span>{dateLabel}</span>
                {row.needsInvoiceDateWarning ? (
                  <span
                    className='inline-flex items-center gap-1 text-xs font-medium text-amber-700'
                    title={
                      row.kind === 'revenue'
                        ? 'Invoice date missing — classified using issue timestamp'
                        : 'Vendor invoice date missing — classified using paid date'
                    }
                  >
                    <WarningTriangleIcon className='h-4 w-4 shrink-0 text-amber-600' aria-hidden />
                    Needs date
                  </span>
                ) : null}
              </div>
            </AdminDataTableCell>
            <AdminDataTableCell className='text-right tabular-nums'>
              {formatAmount(row.amount, row.currency)}
            </AdminDataTableCell>
            <AdminDataTableCell priority='tertiary' className='text-right tabular-nums'>
              {isTaxDisplayedAsDash(row.tax) ? '—' : formatAmount(row.tax, row.currency)}
            </AdminDataTableCell>
            <AdminDataTableCell priority='tertiary'>{statusLabel}</AdminDataTableCell>
          </tr>
        );
      })}
    </AdminRecordTable>
  );
}
