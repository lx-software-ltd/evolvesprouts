'use client';

import { useId, useMemo, useState } from 'react';

import { getAdminDefaultCurrencyCode } from '@/lib/config';
import { getCurrencyOptions } from '@/lib/format';

import type { ClientInvoicesPanelShared } from '@/hooks/client-invoices-panel-types';

export function useClientInvoicesPanelShared(): ClientInvoicesPanelShared {
  const draftFilterId = useId();
  const draftModeId = useId();
  const invoiceSearchFilterId = useId();
  const invoiceSettlementFilterId = useId();
  const draftInvoiceDateId = useId();
  const currencyOptions = useMemo(() => getCurrencyOptions(), []);
  const defaultCurrency = useMemo(() => getAdminDefaultCurrencyCode(), []);

  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const setBusy = (key: string | null) => {
    setBusyAction(key);
  };

  return {
    draftFilterId,
    draftModeId,
    invoiceSearchFilterId,
    invoiceSettlementFilterId,
    draftInvoiceDateId,
    currencyOptions,
    defaultCurrency,
    actionMessage,
    setActionMessage,
    actionError,
    setActionError,
    busyAction,
    setBusyAction,
    exportBusy,
    setExportBusy,
    setBusy,
  };
}
