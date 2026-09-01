'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { WarningTriangleIcon } from '@/components/icons/action-icons';
import { Button } from '@/components/ui/button';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { Label } from '@/components/ui/label';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
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

  return (
    <PaginatedTableCard
      title='Tax'
      description={`Hong Kong fiscal year ${fyMeta.start} to ${fyMeta.end}. Expenses use invoice date when set; otherwise paid date. Revenue uses invoice totals by the invoice date (issue timestamp if missing).`}
      isLoading={isLoading}
      isLoadingMore={false}
      hasMore={false}
      error={tableError}
      loadingLabel='Loading expenses and invoices…'
      onLoadMore={() => {}}
      toolbar={
        <AdminTableToolbar>
          <div className='min-w-[220px]'>
            <Label htmlFor={fySelectId}>Fiscal year</Label>
            <Select
              id={fySelectId}
              value={String(fyStartYear)}
              onChange={(event) => setFyStartYear(Number.parseInt(event.target.value, 10))}
              disabled={isLoading || Boolean(tableError)}
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
          </div>
          <div className='min-w-[180px]'>
            <Label htmlFor={statusSelectId}>Status</Label>
            <Select
              id={statusSelectId}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as TaxFiscalYearStatusFilter)}
              disabled={isLoading || Boolean(tableError)}
            >
              {TAX_FISCAL_YEAR_STATUS_FILTERS.map((entry) => (
                <option key={entry} value={entry}>
                  {formatEnumLabel(entry)}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type='button'
            variant='outline'
            onClick={() => downloadCsv()}
            disabled={isLoading || Boolean(tableError) || rows.length === 0}
          >
            Download CSV
          </Button>
        </AdminTableToolbar>
      }
    >
      <AdminDataTable tableClassName='min-w-[920px]'>
        <AdminDataTableHead>
          <tr>
            <AdminDataTableHeadCell>Type</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Date</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Description</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Amount</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Tax</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Status</AdminDataTableHeadCell>
          </tr>
        </AdminDataTableHead>
        <AdminDataTableBody>
          {!isLoading && !tableError && rows.length === 0 ? (
            <tr>
              <AdminDataTableCell colSpan={6} className='py-6 text-slate-600'>
                {ADMIN_TAX_FISCAL_YEAR_EMPTY_MESSAGE}
              </AdminDataTableCell>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={`${row.kind}:${row.referenceId}`}>
              <AdminDataTableCell>{row.kind === 'revenue' ? 'Revenue' : 'Expense'}</AdminDataTableCell>
              <AdminDataTableCell>
                <div className='flex flex-wrap items-center gap-2'>
                  <span>{formatDateOnly(row.classificationDate)}</span>
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
              <AdminDataTableCell>
                <p className='font-medium text-slate-900'>{row.description}</p>
              </AdminDataTableCell>
              <AdminDataTableCell>
                <span className='tabular-nums'>
                  {fxMultipliers === null && rowsNeedForeignFx
                    ? '…'
                    : formatMoneyLineWithFxToDefault(row.amount, row.currency, fxMultipliers ?? new Map())}
                </span>
              </AdminDataTableCell>
              <AdminDataTableCell>
                <span className='tabular-nums'>
                  {isTaxDisplayedAsDash(row.tax)
                    ? '—'
                    : fxMultipliers === null && rowsNeedForeignFx
                      ? '…'
                      : formatMoneyLineWithFxToDefault(row.tax, row.currency, fxMultipliers ?? new Map())}
                </span>
              </AdminDataTableCell>
              <AdminDataTableCell>{row.status !== '' ? row.status : '—'}</AdminDataTableCell>
            </tr>
          ))}
        </AdminDataTableBody>
      </AdminDataTable>
    </PaginatedTableCard>
  );
}
