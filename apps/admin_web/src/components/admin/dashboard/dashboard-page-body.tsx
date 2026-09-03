'use client';

import { useEffect, useState } from 'react';

import { SalePlanOfTheDayCard } from '@/components/admin/dashboard/cards/sale-plan-of-the-day-card';
import { TaxPositionCard } from '@/components/admin/dashboard/cards/tax-position-card';
import { TopContactSpendersCard } from '@/components/admin/dashboard/cards/top-contact-spenders-card';
import { toErrorMessage } from '@/hooks/hook-errors';
import { listAllCustomerInvoices, type CustomerInvoiceSummary } from '@/lib/billing-api';
import { listAllAdminExpenses } from '@/lib/expenses-api';
import type { Expense } from '@/types/expenses';

export function DashboardPageBody() {
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [invoices, setInvoices] = useState<CustomerInvoiceSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const [expenseRows, invoiceRows] = await Promise.all([
          listAllAdminExpenses(),
          listAllCustomerInvoices({ status: 'issued' }),
        ]);
        if (!cancelled) {
          setExpenses(expenseRows);
          setInvoices(invoiceRows);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(toErrorMessage(error, 'Could not load dashboard finance data.'));
          setExpenses([]);
          setInvoices([]);
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

  return (
    <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
      <SalePlanOfTheDayCard />
      <TaxPositionCard
        expenses={expenses}
        issuedInvoices={invoices}
        loadError={loadError}
        isLoading={isLoading}
      />
      <TopContactSpendersCard issuedInvoices={invoices} loadError={loadError} isLoading={isLoading} />
    </div>
  );
}
