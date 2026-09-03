'use client';

import { useCallback, useEffect, useState } from 'react';

import { toErrorMessage } from '@/hooks/hook-errors';
import { useExpenses } from '@/hooks/use-expenses';
import { useQueryTabState } from '@/hooks/use-query-tab-state';
import { useVendorSpendDefaultCurrency } from '@/hooks/use-vendor-spend-default-currency';
import { useVendors } from '@/hooks/use-vendors';
import { listAllAdminExpenses } from '@/lib/expenses-api';
import type { Expense } from '@/types/expenses';

import { ExpensesEditorPanel } from './expenses-editor-panel';
import { BulkExpensePdfImportPanel } from './bulk-expense-pdf-import-panel';
import { ExpensesListPanel } from './expenses-list-panel';
import {
  DEFAULT_FINANCE_VIEW,
  FINANCE_TAB_KEYS,
  FinanceHeader,
  type FinanceView,
} from './finance-header';
import { ClientInvoicesPanel } from './client-invoices-panel';
import { TaxFiscalYearPanel } from './tax-fiscal-year-panel';
import { VendorsPanel } from './vendors-panel';

export function FinancePage() {
  const [activeView, setActiveView] = useQueryTabState<FinanceView>(
    FINANCE_TAB_KEYS,
    DEFAULT_FINANCE_VIEW
  );
  const expenses = useExpenses();
  const vendors = useVendors();
  const [vendorSpendExpenses, setVendorSpendExpenses] = useState<Expense[] | null>(null);
  const [vendorSpendFetchError, setVendorSpendFetchError] = useState('');
  const vendorSpend = useVendorSpendDefaultCurrency(activeView === 'vendors' ? vendorSpendExpenses : null);

  const setFinanceView = useCallback(
    (view: FinanceView) => {
      setActiveView(view);
      if (view !== 'vendors') {
        setVendorSpendExpenses(null);
        setVendorSpendFetchError('');
        return;
      }
      setVendorSpendExpenses(null);
      setVendorSpendFetchError('');
    },
    [setActiveView]
  );

  useEffect(() => {
    if (activeView !== 'vendors') {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const all = await listAllAdminExpenses();
        if (!cancelled) {
          setVendorSpendExpenses(all);
        }
      } catch (error) {
        if (!cancelled) {
          setVendorSpendFetchError(toErrorMessage(error, 'Failed to load expenses for spend totals.'));
          setVendorSpendExpenses([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeView]);

  if (activeView === 'client-invoices') {
    return (
      <div className='space-y-6'>
        <FinanceHeader activeView={activeView} onSetView={setFinanceView} />
        <ClientInvoicesPanel />
      </div>
    );
  }

  if (activeView === 'tax') {
    return (
      <div className='space-y-6'>
        <FinanceHeader activeView={activeView} onSetView={setFinanceView} />
        <TaxFiscalYearPanel />
      </div>
    );
  }

  if (activeView === 'vendors') {
    return (
      <div className='space-y-6'>
        <FinanceHeader activeView={activeView} onSetView={setFinanceView} />
        <VendorsPanel
          vendors={vendors.vendors}
          filters={vendors.filters}
          isLoading={vendors.isLoading}
          isLoadingMore={vendors.isLoadingMore}
          isSaving={vendors.isSaving}
          hasMore={vendors.hasMore}
          error={vendors.error}
          onFilterChange={vendors.setFilter}
          onLoadMore={vendors.loadMore}
          onCreate={vendors.createVendor}
          onUpdate={vendors.updateVendor}
          vendorSpendByVendorId={vendorSpend.byVendorId}
          isVendorSpendLoading={vendorSpendExpenses === null || vendorSpend.isLoading}
          vendorSpendError={[vendorSpendFetchError, vendorSpend.error].filter(Boolean).join(' ') || undefined}
        />
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <FinanceHeader activeView={activeView} onSetView={setFinanceView} />
      <ExpensesListPanel
        expenses={expenses.items}
        expanded={expenses.expanded}
        importSection={
          <BulkExpensePdfImportPanel
            className='mb-3'
            vendorOptions={vendors.vendors}
            isLoadingVendors={vendors.isLoading}
            isBusy={expenses.isBulkImporting || expenses.isUploadingFiles}
            error={expenses.bulkImportError}
            onImport={expenses.bulkImportFromPdf}
            onCancelBusy={expenses.cancelBulkImport}
            onAfterJobMutation={() => void expenses.refetch()}
          />
        }
        renderDetail={(expense) => (
          <ExpensesEditorPanel
            key={expense?.id ?? 'new-expense'}
            selectedExpense={expense}
            isSaving={expenses.isSaving}
            isUploadingFiles={expenses.isUploadingFiles}
            mutationError={expenses.mutationError}
            vendorOptions={vendors.vendors}
            isLoadingVendors={vendors.isLoading}
            onCreate={expenses.createExpenseEntry}
            onUpdate={expenses.updateExpenseEntry}
            onAmend={expenses.amendExpenseEntry}
            onDirtyChange={expenses.setEditorDirty}
          />
        )}
        query={expenses.filters.query}
        status={expenses.filters.status}
        parseStatus={expenses.filters.parseStatus}
        isLoading={expenses.isLoading}
        isLoadingMore={expenses.isLoadingMore}
        hasMore={expenses.hasMore}
        error={expenses.error}
        isVoidingId={expenses.isDeletingId}
        isMarkingPaidId={expenses.isMarkingPaidId}
        isReparsingId={expenses.isReparsingId}
        isDeletingDraftId={expenses.isDeletingDraftId}
        onLoadMore={expenses.loadMore}
        onQueryChange={(value) => expenses.setFilter('query', value)}
        onStatusChange={(value) => expenses.setFilter('status', value)}
        onParseStatusChange={(value) => expenses.setFilter('parseStatus', value)}
        onReparse={expenses.reparseExpenseEntry}
        onMarkPaid={expenses.markPaidExpenseEntry}
        onVoidExpense={expenses.cancelExpenseEntry}
        onDeleteDraft={expenses.deleteDraftExpenseEntry}
      />
    </div>
  );
}
