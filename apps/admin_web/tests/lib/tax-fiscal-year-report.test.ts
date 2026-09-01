import { describe, expect, it } from 'vitest';

import type { CustomerInvoiceSummary } from '@/lib/billing-api';
import {
  buildTaxFiscalYearRows,
  defaultFiscalYearStartYear,
  taxFiscalYearRowsToCsv,
} from '@/lib/tax-fiscal-year-report';
import type { Expense } from '@/types/expenses';

function expenseStub(partial: Partial<Expense> & Pick<Expense, 'id' | 'status'>): Expense {
  return {
    amendsExpenseId: null,
    parseStatus: 'not_requested',
    vendorId: null,
    vendorName: null,
    invoiceNumber: null,
    invoiceDate: null,
    dueDate: null,
    currency: 'HKD',
    subtotal: null,
    tax: '0',
    total: '100',
    lineItems: [],
    parseConfidence: null,
    notes: null,
    voidReason: null,
    createdBy: '',
    updatedBy: null,
    createdAt: '',
    updatedAt: '',
    submittedAt: null,
    paidAt: null,
    voidedAt: null,
    attachments: [],
    ...partial,
  } as Expense;
}

function invoiceStub(
  partial: Partial<CustomerInvoiceSummary> & Pick<CustomerInvoiceSummary, 'id'>,
): CustomerInvoiceSummary {
  return {
    status: 'issued',
    invoiceNumber: 'INV-1',
    currency: 'HKD',
    subtotal: '100',
    taxTotal: '0',
    total: '100',
    billToDisplayName: 'Client',
    invoiceDate: '2025-06-15',
    issuedAt: '2025-06-15T12:00:00.000Z',
    isPaid: false,
    amountAllocated: '0',
    balanceDue: '100',
    ...partial,
  } as CustomerInvoiceSummary;
}

describe('tax-fiscal-year-report', () => {
  it('defaultFiscalYearStartYear mirrors FY boundaries', () => {
    expect(defaultFiscalYearStartYear(new Date('2026-05-06T12:00:00.000Z'))).toBe(2026);
    expect(defaultFiscalYearStartYear(new Date('2026-03-20T12:00:00.000Z'))).toBe(2025);
  });

  it('sorts rows by classification date descending (newest first)', () => {
    const rows = buildTaxFiscalYearRows(
      [
        expenseStub({
          id: 'early',
          status: 'paid',
          invoiceDate: '2025-04-10',
          total: '1',
        }),
        expenseStub({
          id: 'late',
          status: 'paid',
          invoiceDate: '2025-06-20',
          total: '2',
        }),
      ],
      [],
      2025,
      'recognized',
    );
    expect(rows.map((r) => r.referenceId)).toEqual(['late', 'early']);
  });

  it('recognized includes paid expenses and issued invoices only', () => {
    const rows = buildTaxFiscalYearRows(
      [
        expenseStub({
          id: 'paid',
          status: 'paid',
          invoiceDate: '2025-06-01',
          total: '100',
        }),
        expenseStub({
          id: 'draft',
          status: 'draft',
          invoiceDate: '2025-06-01',
          total: '50',
        }),
        expenseStub({
          id: 'voided',
          status: 'voided',
          invoiceDate: '2025-06-01',
          total: '25',
        }),
      ],
      [
        invoiceStub({ id: 'issued', status: 'issued' }),
        invoiceStub({
          id: 'draft-inv',
          status: 'draft',
          invoiceNumber: 'DRAFT-1',
        }),
        invoiceStub({
          id: 'void-inv',
          status: 'void',
          invoiceNumber: 'VOID-1',
        }),
      ],
      2025,
      'recognized',
    );
    expect(rows.map((r) => r.referenceId)).toEqual(['issued', 'paid']);
  });

  it('in_progress includes draft and submitted expenses plus draft invoices', () => {
    const rows = buildTaxFiscalYearRows(
      [
        expenseStub({
          id: 'draft',
          status: 'draft',
          invoiceDate: '2025-06-01',
        }),
        expenseStub({
          id: 'submitted',
          status: 'submitted',
          invoiceDate: '2025-06-02',
        }),
        expenseStub({
          id: 'paid',
          status: 'paid',
          invoiceDate: '2025-06-03',
        }),
      ],
      [
        invoiceStub({
          id: 'draft-inv',
          status: 'draft',
          invoiceDate: '2025-06-04',
        }),
        invoiceStub({
          id: 'issued',
          status: 'issued',
          invoiceDate: '2025-06-05',
        }),
      ],
      2025,
      'in_progress',
    );
    expect(rows.map((r) => r.referenceId)).toEqual(['draft-inv', 'submitted', 'draft']);
  });

  it('voided includes voided expenses and void invoices', () => {
    const rows = buildTaxFiscalYearRows(
      [
        expenseStub({
          id: 'voided',
          status: 'voided',
          invoiceDate: '2025-06-01',
        }),
        expenseStub({
          id: 'paid',
          status: 'paid',
          invoiceDate: '2025-06-01',
        }),
      ],
      [
        invoiceStub({ id: 'void-inv', status: 'void' }),
        invoiceStub({ id: 'issued', status: 'issued' }),
      ],
      2025,
      'voided',
    );
    expect(rows.map((r) => r.referenceId)).toEqual(['void-inv', 'voided']);
  });

  it('amended includes only amended expenses', () => {
    const rows = buildTaxFiscalYearRows(
      [
        expenseStub({
          id: 'amended',
          status: 'amended',
          invoiceDate: '2025-06-01',
        }),
        expenseStub({
          id: 'paid',
          status: 'paid',
          invoiceDate: '2025-06-01',
        }),
      ],
      [invoiceStub({ id: 'issued', status: 'issued' })],
      2025,
      'amended',
    );
    expect(rows.map((r) => r.referenceId)).toEqual(['amended']);
  });

  it('labels expense status and issued-invoice settlement', () => {
    const rows = buildTaxFiscalYearRows(
      [
        expenseStub({
          id: 'e1',
          status: 'paid',
          vendorName: 'Paper Co',
          invoiceDate: '2025-06-10',
          total: '200',
          tax: '10',
        }),
      ],
      [
        invoiceStub({
          id: 'open',
          invoiceNumber: 'INV-OPEN',
          billToDisplayName: 'Family A',
          invoiceDate: '2025-08-01',
          issuedAt: '2025-08-01T08:00:00.000Z',
          total: '950',
          taxTotal: '50',
          isPaid: false,
          amountAllocated: '0',
          balanceDue: '950',
        }),
        invoiceStub({
          id: 'partial',
          invoiceNumber: 'INV-PART',
          billToDisplayName: 'Family B',
          invoiceDate: '2025-08-02',
          isPaid: false,
          amountAllocated: '40',
          balanceDue: '60',
          total: '100',
        }),
        invoiceStub({
          id: 'paid-inv',
          invoiceNumber: 'INV-PAID',
          billToDisplayName: 'Family C',
          invoiceDate: '2025-08-03',
          isPaid: true,
          amountAllocated: '100',
          balanceDue: '0',
          total: '100',
        }),
        invoiceStub({
          id: 'no-charge',
          invoiceNumber: 'INV-NC',
          billToDisplayName: 'Family D',
          invoiceDate: '2025-08-04',
          total: '0',
          taxTotal: '0',
          isPaid: false,
          amountAllocated: '0',
          balanceDue: '0',
        }),
      ],
      2025,
      'recognized',
    );
    expect(rows.find((r) => r.referenceId === 'e1')?.status).toBe('Paid');
    expect(rows.find((r) => r.referenceId === 'open')?.status).toBe('Open');
    expect(rows.find((r) => r.referenceId === 'partial')?.status).toBe('Partially paid');
    expect(rows.find((r) => r.referenceId === 'paid-inv')?.status).toBe('Paid');
    expect(rows.find((r) => r.referenceId === 'no-charge')?.status).toBe('No charge');
  });

  it('includes expenses matching the status filter in range and revenue by invoice date', () => {
    const rows = buildTaxFiscalYearRows(
      [
        expenseStub({
          id: 'e1',
          status: 'draft',
          vendorName: 'Paper Co',
          invoiceDate: '2025-06-10',
          total: '200',
          tax: '10',
        }),
      ],
      [
        invoiceStub({
          id: 'i1',
          status: 'draft',
          invoiceNumber: 'INV-1',
          currency: 'HKD',
          subtotal: '900',
          taxTotal: '50',
          total: '950',
          billToDisplayName: 'Family A',
          invoiceDate: '2025-08-01',
          issuedAt: '2025-08-01T08:00:00.000Z',
        }),
      ],
      2025,
      'in_progress',
    );
    expect(rows.map((r) => r.kind)).toEqual(['revenue', 'expense']);
    expect(rows[0]?.kind).toBe('revenue');
    expect(rows[0]?.classificationDate).toBe('2025-08-01');
    expect(rows[0]?.status).toBe('Draft');
    expect(rows[1]?.kind).toBe('expense');
    expect(rows[1]?.status).toBe('Draft');
  });

  it('classifies revenue by invoiceDate when it differs from issuedAt calendar day', () => {
    const rows = buildTaxFiscalYearRows(
      [],
      [
        invoiceStub({
          id: 'i-cross',
          status: 'issued',
          invoiceNumber: 'INV-X',
          currency: 'HKD',
          subtotal: '100',
          taxTotal: '0',
          total: '100',
          billToDisplayName: 'Client',
          invoiceDate: '2025-07-31',
          issuedAt: '2025-08-01T02:00:00.000Z',
        }),
      ],
      2025,
      'recognized',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('revenue');
    expect(rows[0]?.classificationDate).toBe('2025-07-31');
    expect(rows[0]?.needsInvoiceDateWarning).toBe(false);
  });

  it('flags revenue missing invoice date when classified by issue timestamp', () => {
    const rows = buildTaxFiscalYearRows(
      [],
      [
        invoiceStub({
          id: 'i-legacy',
          status: 'issued',
          invoiceNumber: 'INV-L',
          currency: 'HKD',
          subtotal: '50',
          taxTotal: '0',
          total: '50',
          billToDisplayName: 'Client',
          invoiceDate: null,
          issuedAt: '2025-06-15T12:00:00.000Z',
        }),
      ],
      2025,
      'recognized',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.classificationDate).toBe('2025-06-15');
    expect(rows[0]?.needsInvoiceDateWarning).toBe(true);
  });

  it('flags missing invoice date when using paid date', () => {
    const rows = buildTaxFiscalYearRows(
      [
        expenseStub({
          id: 'e2',
          status: 'paid',
          invoiceDate: null,
          paidAt: '2025-07-01T00:00:00.000Z',
          vendorName: 'Vendor',
          total: '10',
        }),
      ],
      [],
      2025,
      'recognized',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.needsInvoiceDateWarning).toBe(true);
  });

  it('serializes CSV with status instead of expense_status', () => {
    const csv = taxFiscalYearRowsToCsv([
      {
        kind: 'expense',
        classificationDate: '2025-06-01',
        description: 'Hello, world',
        currency: 'HKD',
        amount: '1',
        tax: '0',
        status: 'Paid',
        referenceId: 'id',
        needsInvoiceDateWarning: false,
        invoiceNumber: null,
      },
    ]);
    expect(csv).toContain('"Hello, world"');
    expect(csv).toContain('status');
    expect(csv).not.toContain('expense_status');
    expect(csv).toContain('Paid');
  });
});
