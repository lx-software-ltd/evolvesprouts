'use client';

import type { FormEvent } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { DeleteIcon } from '@/components/icons/action-icons';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminIconButton } from '@/components/ui/admin-icon-button';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import {
  BillToPartySearchOrCreateField,
} from '@/components/admin/finance/bill-to-party-search-or-create-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toErrorMessage } from '@/hooks/hook-errors';
import {
  createBillToParty,
  isBillToPartyReady,
  type BillToPartyKind,
  type BillToPartyValue,
} from '@/lib/bill-to-party-api';
import { createDraftInvoice } from '@/lib/billing-api';
import { BILL_TO_PARTY_SEARCH_MIN_CHARS } from '@/lib/parse-contact-search-query';

export const CUSTOMIZED_DRAFT_INVOICE_FORM_ID = 'client-billing-customized-draft-form';
const CUSTOMIZED_FORM_ID = CUSTOMIZED_DRAFT_INVOICE_FORM_ID;
const MAX_CUSTOMIZED_LINES = 50;

type CustomizedLineDraftRow = {
  id: string;
  description: string;
  quantity: string;
  unitAmount: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
};

type CustomizedLineField = Exclude<keyof CustomizedLineDraftRow, 'id'>;

function makeCustomizedLineRow(seq: number): CustomizedLineDraftRow {
  return {
    id: `custom-line-${seq}`,
    description: '',
    quantity: '1',
    unitAmount: '',
    discountAmount: '',
    taxRate: '',
    taxAmount: '',
  };
}

function lineHasInput(line: CustomizedLineDraftRow): boolean {
  return (
    line.description.trim() !== '' ||
    line.unitAmount.trim() !== '' ||
    line.discountAmount.trim() !== '' ||
    line.taxRate.trim() !== '' ||
    line.taxAmount.trim() !== '' ||
    line.quantity.trim() !== '1'
  );
}

function currencySelectValue(
  code: string,
  options: readonly { value: string }[],
  fallback: string,
): string {
  const normalized = code.trim().toUpperCase() || fallback;
  return options.some((o) => o.value === normalized) ? normalized : fallback;
}

function parseAmountInput(raw: string): number | null {
  const t = raw.trim();
  if (t === '') {
    return null;
  }
  const n = Number.parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

export interface CustomizedDraftInvoiceCardProps {
  defaultCurrency: string;
  currencyOptions: readonly { value: string; label: string }[];
  editorBusy: boolean;
  /** When false, the bill-to search field stays idle until customized mode is selected. */
  loadParents: boolean;
  /** Invoice date YMD from parent (shared with enrollment draft row). */
  draftInvoiceDate: string;
  onRequestBusy?: (busy: boolean) => void;
  onDraftError?: (message: string) => void;
  onValidityChange?: (valid: boolean) => void;
  /** Reports whether the operator has typed anything worth guarding. */
  onDirtyChange?: (dirty: boolean) => void;
  onCreated: (invoiceId: string) => void | Promise<void>;
}

/**
 * Customized (manual lines) draft form. Bill-to, party, and currency sit in
 * one field row; each line is its own field grid inside the Line items
 * disclosure so the form stays usable without horizontal scrolling.
 */
export function CustomizedDraftInvoiceCard({
  defaultCurrency,
  currencyOptions,
  editorBusy,
  loadParents,
  draftInvoiceDate,
  onRequestBusy,
  onDraftError,
  onValidityChange,
  onDirtyChange,
  onCreated,
}: CustomizedDraftInvoiceCardProps) {
  const customizedBillKindId = useId();
  const customizedBillEntityInputId = useId();
  const customizedCurrencyId = useId();

  const customizedLineIdSeq = useRef(1);

  const [customizedBillKind, setCustomizedBillKind] = useState<BillToPartyKind>('contact');
  const [billToParty, setBillToParty] = useState<BillToPartyValue>({ status: 'empty' });
  const [customizedCurrency, setCustomizedCurrency] = useState(() =>
    currencySelectValue(defaultCurrency, currencyOptions, defaultCurrency),
  );
  const [customizedLines, setCustomizedLines] = useState<CustomizedLineDraftRow[]>(() => [
    makeCustomizedLineRow(1),
  ]);

  const customizedIssue = useMemo(() => {
    if (!loadParents) {
      return '';
    }
    if (!isBillToPartyReady(billToParty, BILL_TO_PARTY_SEARCH_MIN_CHARS)) {
      return 'Search for an existing bill-to party or enter at least 2 characters to create one.';
    }
    if (customizedLines.length === 0) {
      return 'Add at least one line.';
    }
    if (customizedLines.length > MAX_CUSTOMIZED_LINES) {
      return `At most ${MAX_CUSTOMIZED_LINES} lines are allowed.`;
    }
    for (let i = 0; i < customizedLines.length; i += 1) {
      const ln = customizedLines[i];
      if (ln.description.trim() === '') {
        return `Line ${i + 1}: description is required.`;
      }
      if (ln.description.trim().length > 500) {
        return `Line ${i + 1}: description must be at most 500 characters.`;
      }
      const qty = parseAmountInput(ln.quantity);
      if (qty === null || qty <= 0) {
        return `Line ${i + 1}: quantity must be a positive number.`;
      }
      const unit = parseAmountInput(ln.unitAmount);
      if (unit === null) {
        return `Line ${i + 1}: unit price must be a valid number.`;
      }
      const discRaw = ln.discountAmount.trim();
      if (discRaw !== '') {
        const disc = parseAmountInput(ln.discountAmount);
        if (disc === null || disc < 0) {
          return `Line ${i + 1}: discount must be a valid non-negative number.`;
        }
        if (disc > qty * unit + 1e-9) {
          return `Line ${i + 1}: discount cannot exceed quantity × unit price.`;
        }
      }
      const taxAmtRaw = ln.taxAmount.trim();
      const taxRateRaw = ln.taxRate.trim();
      if (taxAmtRaw !== '' && taxRateRaw !== '') {
        return `Line ${i + 1}: provide either tax amount or tax rate, not both.`;
      }
      if (taxAmtRaw !== '') {
        const ta = parseAmountInput(ln.taxAmount);
        if (ta === null || ta < 0) {
          return `Line ${i + 1}: tax amount must be a valid non-negative number.`;
        }
      }
      if (taxRateRaw !== '') {
        const tr = parseAmountInput(ln.taxRate);
        if (tr === null || tr < 0) {
          return `Line ${i + 1}: tax rate must be a valid non-negative number.`;
        }
      }
    }
    return '';
  }, [
    billToParty,
    customizedLines,
    loadParents,
  ]);

  useEffect(() => {
    if (!loadParents) {
      onValidityChange?.(false);
      return;
    }
    onValidityChange?.(customizedIssue === '');
  }, [customizedIssue, loadParents, onValidityChange]);

  const hasInput = billToParty.status !== 'empty' || customizedLines.some(lineHasInput);
  useEffect(() => {
    onDirtyChange?.(hasInput);
  }, [hasInput, onDirtyChange]);

  const updateLine = (lineId: string, field: CustomizedLineField, value: string) => {
    setCustomizedLines((prev) =>
      prev.map((row) => (row.id === lineId ? { ...row, [field]: value } : row)),
    );
  };

  const handleCreateCustomizedDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (customizedIssue) {
      onDraftError?.(customizedIssue);
      return;
    }
    onRequestBusy?.(true);
    try {
      let partyId = '';
      if (billToParty.status === 'existing') {
        partyId = billToParty.id;
      } else if (billToParty.status === 'create') {
        const created = await createBillToParty(customizedBillKind, billToParty.query);
        partyId = created.id;
        setBillToParty({ status: 'existing', id: created.id, label: created.label });
      } else {
        onDraftError?.('Search for an existing bill-to party or enter at least 2 characters to create one.');
        return;
      }
      const billTo =
        customizedBillKind === 'contact'
          ? { kind: 'contact' as const, contactId: partyId }
          : customizedBillKind === 'family'
            ? { kind: 'family' as const, familyId: partyId }
            : { kind: 'organization' as const, organizationId: partyId };
      const lines = customizedLines.map((ln) => {
        const row: {
          description: string;
          quantity: string;
          unitAmount: string;
          discountAmount?: string;
          taxRate?: string;
          taxAmount?: string;
        } = {
          description: ln.description.trim(),
          quantity: ln.quantity.trim(),
          unitAmount: ln.unitAmount.trim(),
        };
        if (ln.discountAmount.trim() !== '') {
          row.discountAmount = ln.discountAmount.trim();
        }
        if (ln.taxRate.trim() !== '') {
          row.taxRate = ln.taxRate.trim();
        }
        if (ln.taxAmount.trim() !== '') {
          row.taxAmount = ln.taxAmount.trim();
        }
        return row;
      });
      const result = await createDraftInvoice({
        draftKind: 'customized_manual',
        billTo,
        currency: customizedCurrency.trim().toUpperCase(),
        lines,
        invoiceDate: draftInvoiceDate.trim() || undefined,
      });
      await onCreated(result.invoiceId);
      customizedLineIdSeq.current += 1;
      setCustomizedLines([makeCustomizedLineRow(customizedLineIdSeq.current)]);
      setBillToParty({ status: 'empty' });
    } catch (caught) {
      onDraftError?.(
        toErrorMessage(caught, 'Create draft failed.', { honorBackendMessage: true }),
      );
    } finally {
      onRequestBusy?.(false);
    }
  };

  return (
    <form id={CUSTOMIZED_FORM_ID} className='space-y-4' onSubmit={(e) => void handleCreateCustomizedDraft(e)}>
      <AdminFieldGrid columns={4}>
        <AdminField label='Bill to' htmlFor={customizedBillKindId}>
          <Select
            id={customizedBillKindId}
            className='mt-1 w-full'
            value={customizedBillKind}
            onChange={(e) => {
              setCustomizedBillKind(e.target.value as BillToPartyKind);
              setBillToParty({ status: 'empty' });
            }}
            disabled={editorBusy}
          >
            <option value='contact'>Contact</option>
            <option value='family'>Family</option>
            <option value='organization'>Organization</option>
            <option value='partner'>Partner</option>
          </Select>
        </AdminField>
        <BillToPartySearchOrCreateField
          key={customizedBillKind}
          kind={customizedBillKind}
          inputId={customizedBillEntityInputId}
          disabled={editorBusy}
          enabled={loadParents}
          value={billToParty}
          onChange={setBillToParty}
          className='sm:col-span-2'
        />
        <AdminField label='Currency' htmlFor={customizedCurrencyId}>
          <Select
            id={customizedCurrencyId}
            className='mt-1 w-full'
            value={customizedCurrency}
            onChange={(e) => setCustomizedCurrency(e.target.value)}
            disabled={editorBusy}
          >
            {currencyOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </AdminField>
      </AdminFieldGrid>
      <AdminDisclosure
        id='customized-draft-invoice-lines'
        title='Line items'
        summary={`${customizedLines.length} of ${MAX_CUSTOMIZED_LINES}`}
        defaultOpen
        disabled={editorBusy}
      >
        <div className='space-y-3'>
          {customizedLines.map((ln, index) => (
            <div key={ln.id} className='rounded-md border border-slate-200 bg-white p-3' data-testid='customized-line'>
              <div className='mb-2 flex items-center justify-between gap-2'>
                <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                  Line {index + 1}
                </span>
                <AdminIconButton
                  label='Delete line'
                  icon={<DeleteIcon className='h-4 w-4' />}
                  tone='danger'
                  disabled={editorBusy || customizedLines.length <= 1}
                  onClick={() => setCustomizedLines((prev) => prev.filter((row) => row.id !== ln.id))}
                />
              </div>
              <AdminFieldGrid columns={4}>
                <AdminField label='Description' htmlFor={`${CUSTOMIZED_FORM_ID}-desc-${ln.id}`} span={2}>
                  <Input
                    id={`${CUSTOMIZED_FORM_ID}-desc-${ln.id}`}
                    className='mt-1 w-full min-w-0'
                    disabled={editorBusy}
                    value={ln.description}
                    onChange={(e) => updateLine(ln.id, 'description', e.target.value)}
                  />
                </AdminField>
                <AdminField label='Quantity' htmlFor={`${CUSTOMIZED_FORM_ID}-qty-${ln.id}`}>
                  <Input
                    id={`${CUSTOMIZED_FORM_ID}-qty-${ln.id}`}
                    className='mt-1 w-full min-w-0 font-mono tabular-nums'
                    inputMode='decimal'
                    disabled={editorBusy}
                    value={ln.quantity}
                    onChange={(e) => updateLine(ln.id, 'quantity', e.target.value)}
                  />
                </AdminField>
                <AdminField label='Unit price' htmlFor={`${CUSTOMIZED_FORM_ID}-unit-${ln.id}`}>
                  <Input
                    id={`${CUSTOMIZED_FORM_ID}-unit-${ln.id}`}
                    className='mt-1 w-full min-w-0 font-mono tabular-nums'
                    inputMode='decimal'
                    disabled={editorBusy}
                    value={ln.unitAmount}
                    onChange={(e) => updateLine(ln.id, 'unitAmount', e.target.value)}
                  />
                </AdminField>
                <AdminField label='Discount' htmlFor={`${CUSTOMIZED_FORM_ID}-disc-${ln.id}`}>
                  <Input
                    id={`${CUSTOMIZED_FORM_ID}-disc-${ln.id}`}
                    className='mt-1 w-full min-w-0 font-mono tabular-nums'
                    inputMode='decimal'
                    disabled={editorBusy}
                    value={ln.discountAmount}
                    onChange={(e) => updateLine(ln.id, 'discountAmount', e.target.value)}
                    placeholder='0'
                  />
                </AdminField>
                <AdminField label='Tax rate' htmlFor={`${CUSTOMIZED_FORM_ID}-tr-${ln.id}`}>
                  <Input
                    id={`${CUSTOMIZED_FORM_ID}-tr-${ln.id}`}
                    className='mt-1 w-full min-w-0 font-mono tabular-nums'
                    inputMode='decimal'
                    disabled={editorBusy}
                    value={ln.taxRate}
                    onChange={(e) => updateLine(ln.id, 'taxRate', e.target.value)}
                    placeholder='—'
                  />
                </AdminField>
                <AdminField label='Tax amount' htmlFor={`${CUSTOMIZED_FORM_ID}-ta-${ln.id}`}>
                  <Input
                    id={`${CUSTOMIZED_FORM_ID}-ta-${ln.id}`}
                    className='mt-1 w-full min-w-0 font-mono tabular-nums'
                    inputMode='decimal'
                    disabled={editorBusy}
                    value={ln.taxAmount}
                    onChange={(e) => updateLine(ln.id, 'taxAmount', e.target.value)}
                    placeholder='—'
                  />
                </AdminField>
              </AdminFieldGrid>
            </div>
          ))}
          <div className='flex justify-start'>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              disabled={editorBusy || customizedLines.length >= MAX_CUSTOMIZED_LINES}
              onClick={() => {
                customizedLineIdSeq.current += 1;
                setCustomizedLines((prev) => [...prev, makeCustomizedLineRow(customizedLineIdSeq.current)]);
              }}
            >
              Add line
            </Button>
          </div>
        </div>
      </AdminDisclosure>
      {customizedIssue && loadParents ? <AdminInlineError>{customizedIssue}</AdminInlineError> : null}
    </form>
  );
}
