import { fireEvent, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const billingMocks = vi.hoisted(() => ({
  listCustomerInvoices: vi.fn(),
  getCustomerInvoice: vi.fn(),
  getCustomerInvoicePdfDownload: vi.fn(),
  listCustomerPayments: vi.fn(),
  getCustomerPayment: vi.fn(),
  issueInvoice: vi.fn(),
  voidInvoice: vi.fn(),
  deleteDraftCustomerInvoice: vi.fn(),
  emailInvoice: vi.fn(),
  confirmCustomerPayment: vi.fn(),
  deleteCustomerPayment: vi.fn(),
  createDraftInvoice: vi.fn(),
  createPaymentAllocation: vi.fn(),
  createCustomerRefund: vi.fn(),
  createManualInboundCustomerPayment: vi.fn(),
  updateManualInboundCustomerPayment: vi.fn(),
  exportBillingCsv: vi.fn(),
  listRecentEnrollmentsForInvoicing: vi.fn(),
}));

const billToPartyMocks = vi.hoisted(() => ({
  searchBillToParties: vi.fn(),
  createBillToParty: vi.fn(),
}));

vi.mock('@/lib/billing-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing-api')>();
  return {
    ...actual,
    listCustomerInvoices: billingMocks.listCustomerInvoices,
    getCustomerInvoice: billingMocks.getCustomerInvoice,
    getCustomerInvoicePdfDownload: billingMocks.getCustomerInvoicePdfDownload,
    listCustomerPayments: billingMocks.listCustomerPayments,
    getCustomerPayment: billingMocks.getCustomerPayment,
    issueInvoice: billingMocks.issueInvoice,
    voidInvoice: billingMocks.voidInvoice,
    deleteDraftCustomerInvoice: billingMocks.deleteDraftCustomerInvoice,
    emailInvoice: billingMocks.emailInvoice,
    confirmCustomerPayment: billingMocks.confirmCustomerPayment,
    deleteCustomerPayment: billingMocks.deleteCustomerPayment,
    createDraftInvoice: billingMocks.createDraftInvoice,
    createPaymentAllocation: billingMocks.createPaymentAllocation,
    createCustomerRefund: billingMocks.createCustomerRefund,
    createManualInboundCustomerPayment: billingMocks.createManualInboundCustomerPayment,
    updateManualInboundCustomerPayment: billingMocks.updateManualInboundCustomerPayment,
    exportBillingCsv: billingMocks.exportBillingCsv,
    listRecentEnrollmentsForInvoicing: billingMocks.listRecentEnrollmentsForInvoicing,
  };
});

vi.mock('@/lib/bill-to-party-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bill-to-party-api')>();
  return {
    ...actual,
    searchBillToParties: billToPartyMocks.searchBillToParties,
    createBillToParty: billToPartyMocks.createBillToParty,
  };
});

import {
  ClientInvoicesPanel,
  NO_ENROLLMENT_OPTION_VALUE,
} from '@/components/admin/finance/client-invoices-panel';
import { formatDateOnly, formatYmdAsLocalDate } from '@/lib/format';

function firstCustomerInvoiceDataRow(invoiceTable: HTMLElement): HTMLElement {
  const rows = within(invoiceTable).getAllByRole('row');
  return rows[1] as HTMLElement;
}

function firstCustomerPaymentDataRow(paymentTable: HTMLElement): HTMLElement {
  const rows = within(paymentTable).getAllByRole('row');
  return rows[1] as HTMLElement;
}

describe('ClientInvoicesPanel', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/finance?tab=client-invoices');
    for (const key of Object.keys(billingMocks) as (keyof typeof billingMocks)[]) {
      billingMocks[key].mockReset();
    }
    billToPartyMocks.searchBillToParties.mockReset();
    billToPartyMocks.createBillToParty.mockReset();
    billToPartyMocks.searchBillToParties.mockResolvedValue([
      { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', label: 'Pat Contact' },
    ]);
    billingMocks.listCustomerPayments.mockResolvedValue({ items: [], next_cursor: null });
    billingMocks.listCustomerInvoices.mockResolvedValue({ items: [], next_cursor: null });
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({ items: [], truncated: false });
    billingMocks.getCustomerInvoicePdfDownload.mockResolvedValue({
      downloadUrl: 'https://example.com/signed.pdf',
      expiresAt: '2026-12-31T00:00:00Z',
    });
    billingMocks.getCustomerInvoice.mockResolvedValue({ id: '', lines: [] });
    billingMocks.createManualInboundCustomerPayment.mockResolvedValue({
      id: 'new-payment-uuid-1111-1111-111111111111',
      direction: 'inbound',
      status: 'pending',
      method: 'fps',
      amount: '10',
      currency: 'HKD',
      enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      contactId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      externalReference: null,
      succeededAt: null,
      createdAt: '2026-01-01T00:00:00+00:00',
      orphanPaymentDeletable: false,
      party: 'Pat',
      unappliedAmount: '10',
    });
    billingMocks.updateManualInboundCustomerPayment.mockResolvedValue({
      id: 'updated-payment-uuid',
      direction: 'inbound',
      status: 'pending',
      method: 'fps',
      amount: '20',
      currency: 'HKD',
      enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      contactId: null,
      externalReference: 'REF',
      succeededAt: null,
      createdAt: '2026-01-01T00:00:00+00:00',
      orphanPaymentDeletable: false,
      party: 'Pat',
      unappliedAmount: '20',
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('selecting an issued invoice row seeds allocate invoice select', async () => {
    const invId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    billingMocks.listCustomerInvoices.mockResolvedValue({
      items: [
        {
          id: invId,
          status: 'issued',
          invoiceNumber: 'INV-42',
          currency: 'HKD',
          total: '100',
          amountAllocated: '0',
          balanceDue: '100',
          paidAt: null,
          isPaid: false,
          lineCount: 1,
          billToDisplayName: 'Pat',
          createdAt: '2026-01-01T00:00:00+00:00',
        },
      ],
      next_cursor: null,
    });
    billingMocks.getCustomerInvoice.mockResolvedValue({
      id: invId,
      status: 'issued',
      lines: [{ id: 'line-1-uuid-1111-1111-111111111111', description: 'Tuition', lineOrder: 0 }],
    });

    render(<ClientInvoicesPanel />);

    await waitFor(() => {
      expect(billingMocks.listCustomerInvoices).toHaveBeenCalled();
    });

    const invoiceRegion = screen.getByRole('region', { name: /customer invoices list/i });
    const invoiceTable = within(invoiceRegion).getByRole('table');
    expect(within(invoiceTable).queryByRole('columnheader', { name: 'Invoice' })).not.toBeInTheDocument();
    expect(within(invoiceTable).getByRole('columnheader', { name: 'Settlement' })).toBeInTheDocument();
    expect(within(invoiceTable).getByText('Open')).toBeInTheDocument();
    await userEvent.click(firstCustomerInvoiceDataRow(invoiceTable));

    await waitFor(() => {
      const sel = document.getElementById('billing-allocate-invoice') as HTMLSelectElement;
      expect(sel.value).toBe(invId);
    });
  });

  it('invoice list shows Invoice date column and prefers invoiceDate over createdAt', async () => {
    billingMocks.listCustomerInvoices.mockResolvedValue({
      items: [
        {
          id: 'inv-a',
          status: 'draft',
          invoiceNumber: null,
          currency: 'HKD',
          total: '10',
          lineCount: 1,
          billToDisplayName: 'Pat',
          createdAt: '2020-01-01T00:00:00+00:00',
          invoiceDate: '2025-05-15',
        },
        {
          id: 'inv-b',
          status: 'draft',
          invoiceNumber: null,
          currency: 'HKD',
          total: '5',
          lineCount: 1,
          billToDisplayName: 'Sam',
          createdAt: '2024-06-01T12:00:00+00:00',
          invoiceDate: null,
        },
      ],
      next_cursor: null,
    });

    render(<ClientInvoicesPanel />);

    await waitFor(() => {
      expect(billingMocks.listCustomerInvoices).toHaveBeenCalled();
    });

    const invoiceRegion = screen.getByRole('region', { name: /customer invoices list/i });
    const invoiceTable = within(invoiceRegion).getByRole('table');
    expect(within(invoiceTable).getByRole('columnheader', { name: 'Invoice date' })).toBeInTheDocument();
    const dataRows = within(invoiceTable).getAllByRole('row').slice(1);
    const row1cells = within(dataRows[0]).getAllByRole('cell');
    const row2cells = within(dataRows[1]).getAllByRole('cell');
    expect(row1cells[5]).toHaveTextContent(formatYmdAsLocalDate('2025-05-15'));
    expect(row2cells[5]).toHaveTextContent(formatDateOnly('2024-06-01T12:00:00+00:00'));
  });

  it('passes status filter to listCustomerInvoices', async () => {
    billingMocks.listCustomerInvoices.mockResolvedValue({ items: [], next_cursor: null });
    render(<ClientInvoicesPanel />);

    await waitFor(() => expect(billingMocks.listCustomerInvoices).toHaveBeenCalled());

    const user = userEvent.setup();
    const invoiceStatusSelect = document.getElementById(
      'billing-invoice-status-filter',
    ) as HTMLSelectElement;
    await user.selectOptions(invoiceStatusSelect, 'issued');

    await waitFor(() => {
      expect(billingMocks.listCustomerInvoices).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'issued' }),
        expect.any(AbortSignal),
      );
    });
  });

  it('defaults settlement filter to Not completed and passes it to listCustomerInvoices', async () => {
    billingMocks.listCustomerInvoices.mockResolvedValue({ items: [], next_cursor: null });
    render(<ClientInvoicesPanel />);

    await waitFor(() => {
      expect(billingMocks.listCustomerInvoices).toHaveBeenCalledWith(
        expect.objectContaining({ settlement: 'not_completed' }),
        expect.any(AbortSignal),
      );
    });

    const settlementSelect = screen.getByLabelText('Settlement') as HTMLSelectElement;
    expect(settlementSelect.value).toBe('not_completed');
  });

  it('record customer payment editor calls createManualInboundCustomerPayment', async () => {
    const eid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [
        {
          enrollmentId: eid,
          partyDisplayName: 'Pat',
          partyEmail: 'pat@example.com',
          billToKind: 'contact',
          instanceTitle: 'Inst',
          serviceTierName: null,
          instanceCohort: null,
          amountPaid: '100.00',
          currency: 'HKD',
          enrolledAt: '2026-01-15T00:00:00+00:00',
          invoiceLinked: false,
          billToMergeKey: 'contact||uuid-a||',
        },
      ],
      truncated: false,
    });
    render(<ClientInvoicesPanel />);

    await waitFor(() => expect(billingMocks.listCustomerInvoices).toHaveBeenCalled());
    await waitFor(() => expect(billingMocks.listRecentEnrollmentsForInvoicing).toHaveBeenCalled());

    const user = userEvent.setup();
    const enrollmentSelect = document.getElementById(
      'billing-create-pay-enrollment-select',
    ) as HTMLSelectElement;
    await user.selectOptions(enrollmentSelect, eid);
    const amountInput = document.getElementById('billing-create-pay-amount') as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, '10');

    await user.click(screen.getByRole('button', { name: 'Create customer payment' }));

    await waitFor(() => {
      expect(billingMocks.createManualInboundCustomerPayment).toHaveBeenCalledWith({
        direction: 'inbound',
        enrollmentId: eid,
        amount: '10',
        currency: 'HKD',
        method: 'bank_transfer',
        status: 'pending',
        externalReference: null,
      });
    });
  });

  it('record customer payment editor creates manual inbound payment without an enrollment', async () => {
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [],
      truncated: false,
    });
    render(<ClientInvoicesPanel />);

    await waitFor(() => expect(billingMocks.listCustomerInvoices).toHaveBeenCalled());
    await waitFor(() => expect(billingMocks.listRecentEnrollmentsForInvoicing).toHaveBeenCalled());

    const user = userEvent.setup();
    const enrollmentSelect = document.getElementById(
      'billing-create-pay-enrollment-select',
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(enrollmentSelect).toBeTruthy();
      expect(
        Array.from(enrollmentSelect.options).some((o) => o.value === NO_ENROLLMENT_OPTION_VALUE),
      ).toBe(true);
    });
    await user.selectOptions(enrollmentSelect, NO_ENROLLMENT_OPTION_VALUE);
    const amountInput = document.getElementById('billing-create-pay-amount') as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, '10');

    await user.click(screen.getByRole('button', { name: 'Create customer payment' }));

    await waitFor(() => {
      expect(billingMocks.createManualInboundCustomerPayment).toHaveBeenCalledWith({
        direction: 'inbound',
        enrollmentId: null,
        amount: '10',
        currency: 'HKD',
        method: 'bank_transfer',
        status: 'pending',
        externalReference: null,
      });
    });
  });

  it('record customer payment editor shows error when creating with empty enrollment selection', async () => {
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [],
      truncated: false,
    });
    render(<ClientInvoicesPanel />);

    await waitFor(() => expect(billingMocks.listCustomerInvoices).toHaveBeenCalled());
    await waitFor(() => expect(billingMocks.listRecentEnrollmentsForInvoicing).toHaveBeenCalled());

    const user = userEvent.setup();
    const amountInput = document.getElementById('billing-create-pay-amount') as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, '10');

    await user.click(screen.getByRole('button', { name: 'Create customer payment' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Select a recent enrollment or choose none to record without an enrollment.',
        ),
      ).toBeInTheDocument();
    });
    expect(billingMocks.createManualInboundCustomerPayment).not.toHaveBeenCalled();
  });

  it('record customer payment editor shows error when createManualInboundCustomerPayment fails', async () => {
    const eid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [
        {
          enrollmentId: eid,
          partyDisplayName: 'Pat',
          partyEmail: 'pat@example.com',
          billToKind: 'contact',
          instanceTitle: 'Inst',
          serviceTierName: null,
          instanceCohort: null,
          amountPaid: '100.00',
          currency: 'HKD',
          enrolledAt: '2026-01-15T00:00:00+00:00',
          invoiceLinked: false,
          billToMergeKey: 'contact||uuid-a||',
        },
      ],
      truncated: false,
    });
    billingMocks.createManualInboundCustomerPayment.mockRejectedValueOnce(new Error('Duplicate reference'));

    render(<ClientInvoicesPanel />);

    await waitFor(() => expect(billingMocks.listCustomerInvoices).toHaveBeenCalled());
    await waitFor(() => expect(billingMocks.listRecentEnrollmentsForInvoicing).toHaveBeenCalled());

    const user = userEvent.setup();
    const enrollmentSelect = document.getElementById(
      'billing-create-pay-enrollment-select',
    ) as HTMLSelectElement;
    await user.selectOptions(enrollmentSelect, eid);
    const amountInput = document.getElementById('billing-create-pay-amount') as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, '5');

    await user.click(screen.getByRole('button', { name: 'Create customer payment' }));

    await waitFor(() => {
      expect(screen.getByText(/Duplicate reference/)).toBeInTheDocument();
    });
  });

  it('manual payment editor Cancel keeps payment row selected for allocation', async () => {
    const payId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const eid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    billingMocks.listCustomerPayments.mockResolvedValue({
      items: [
        {
          id: payId,
          direction: 'inbound',
          status: 'pending',
          method: 'bank_transfer',
          amount: '10',
          currency: 'HKD',
          enrollmentId: eid,
          stripePaymentIntentId: null,
          party: 'Pat',
          unappliedAmount: '10',
          createdAt: '2026-01-01T00:00:00+00:00',
          orphanPaymentDeletable: false,
        },
      ],
      next_cursor: null,
    });
    billingMocks.getCustomerPayment.mockResolvedValue({
      id: payId,
      direction: 'inbound',
      status: 'pending',
      method: 'bank_transfer',
      amount: '10',
      currency: 'HKD',
      enrollmentId: eid,
      stripePaymentIntentId: null,
      party: 'Pat',
      unappliedAmount: '10',
      createdAt: '2026-01-01T00:00:00+00:00',
      orphanPaymentDeletable: false,
    });
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [
        {
          enrollmentId: eid,
          partyDisplayName: 'Pat',
          partyEmail: null,
          billToKind: 'contact',
          instanceTitle: 'Spring Workshop',
          parentServiceTitle: 'Workshop Series',
          serviceTierName: 'Standard',
          instanceCohort: 'Group A',
          amountPaid: '10',
          currency: 'HKD',
          enrolledAt: '2026-01-01T00:00:00+00:00',
          invoiceLinked: true,
          billToMergeKey: 'k1',
        },
      ],
      truncated: false,
    });
    billingMocks.listCustomerInvoices.mockResolvedValue({
      items: [],
      next_cursor: null,
    });

    render(<ClientInvoicesPanel />);

    const paymentTable = screen.getAllByRole('table').at(-1) as HTMLElement;
    await waitFor(() => expect(within(paymentTable).getAllByRole('row').length).toBeGreaterThan(1));

    await userEvent.click(firstCustomerPaymentDataRow(paymentTable));
    await waitFor(() => {
      expect(billingMocks.getCustomerPayment).toHaveBeenCalledWith(payId, expect.any(AbortSignal));
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update customer payment' })).toBeInTheDocument();
    });

    expect(
      screen.getByText('Pat · Spring Workshop · Standard · Group A'),
    ).toBeInTheDocument();
    expect(
      (document.getElementById('billing-create-pay-amount') as HTMLInputElement).value,
    ).toBe('10.00');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create customer payment' })).toBeInTheDocument();
    });
    const row = firstCustomerPaymentDataRow(paymentTable);
    expect(row.className).toContain('bg-sky-50');
  });

  it('load more uses cursor from previous response', async () => {
    billingMocks.listCustomerInvoices.mockImplementation(async (params) => {
      if (params.cursor) {
        return { items: [], next_cursor: null };
      }
      return {
        items: [
          {
            id: 'a',
            status: 'draft',
            currency: 'HKD',
            total: '1',
            lineCount: 0,
            createdAt: '2026-01-01T00:00:00+00:00',
          },
        ],
        next_cursor: 'cursor-token',
      };
    });

    render(<ClientInvoicesPanel />);

    await waitFor(() => expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      const calls = billingMocks.listCustomerInvoices.mock.calls;
      const last = calls[calls.length - 1];
      expect(last[0]).toEqual(
        expect.objectContaining({ cursor: 'cursor-token' }),
      );
    });
  });

  it('issue row action calls issueInvoice', async () => {
    const invId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    billingMocks.listCustomerInvoices.mockResolvedValue({
      items: [
        {
          id: invId,
          status: 'draft',
          currency: 'HKD',
          total: '1',
          lineCount: 0,
          createdAt: '2026-01-01T00:00:00+00:00',
        },
      ],
      next_cursor: null,
    });
    billingMocks.issueInvoice.mockResolvedValue({ invoiceId: invId, invoiceNumber: 'INV-1' });

    render(<ClientInvoicesPanel />);

    await waitFor(() => screen.getByRole('button', { name: /issue invoice/i }));

    await userEvent.click(screen.getByRole('button', { name: /issue invoice/i }));

    await waitFor(() => {
      expect(billingMocks.issueInvoice).toHaveBeenCalledWith(invId);
      expect(billingMocks.listCustomerPayments.mock.calls.length).toBeGreaterThan(1);
      expect(billingMocks.listCustomerInvoices.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('preview row action opens invoice PDF URL in a new tab', async () => {
    const invId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    billingMocks.listCustomerInvoices.mockResolvedValue({
      items: [
        {
          id: invId,
          status: 'draft',
          currency: 'HKD',
          total: '1',
          lineCount: 0,
          createdAt: '2026-01-01T00:00:00+00:00',
        },
      ],
      next_cursor: null,
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<ClientInvoicesPanel />);

    const invoiceRegion = screen.getByRole('region', { name: /customer invoices list/i });
    const invoiceTable = within(invoiceRegion).getByRole('table');

    await waitFor(() =>
      within(invoiceTable).getByRole('button', { name: /preview invoice pdf/i }),
    );

    await userEvent.click(
      within(invoiceTable).getByRole('button', { name: /preview invoice pdf/i }),
    );

    await waitFor(() => {
      expect(billingMocks.getCustomerInvoicePdfDownload).toHaveBeenCalledWith(invId);
      expect(openSpy).toHaveBeenCalledWith(
        'https://example.com/signed.pdf',
        '_blank',
        'noopener,noreferrer',
      );
    });

    openSpy.mockRestore();
  });

  it('void dialog calls voidInvoice with reason', async () => {
    const invId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    billingMocks.listCustomerInvoices.mockResolvedValue({
      items: [
        {
          id: invId,
          status: 'draft',
          currency: 'HKD',
          total: '1',
          lineCount: 0,
          createdAt: '2026-01-01T00:00:00+00:00',
        },
      ],
      next_cursor: null,
    });
    billingMocks.voidInvoice.mockResolvedValue({ invoiceId: invId, status: 'void' });

    render(<ClientInvoicesPanel />);

    const invoiceRegion = screen.getByRole('region', { name: /customer invoices list/i });
    const invoiceTable = within(invoiceRegion).getByRole('table');

    await waitFor(() =>
      within(invoiceTable).getByRole('button', { name: /void invoice/i }),
    );

    await userEvent.click(within(invoiceTable).getByRole('button', { name: /void invoice/i }));

    await userEvent.type(screen.getByLabelText(/reason/i), 'Customer cancelled');
    const voidDialog = screen.getByRole('alertdialog');
    await userEvent.click(
      within(voidDialog).getByRole('button', { name: /^void invoice$/i }),
    );

    await waitFor(() => {
      expect(billingMocks.voidInvoice).toHaveBeenCalledWith(invId, 'Customer cancelled');
    });
  });

  it('export calls exportBillingCsv and triggers download', async () => {
    billingMocks.exportBillingCsv.mockResolvedValue('a,b\n1,2');
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    render(<ClientInvoicesPanel />);

    await userEvent.click(screen.getByRole('button', { name: /download csv export/i }));

    await waitFor(() => {
      expect(billingMocks.exportBillingCsv).toHaveBeenCalled();
      const args = billingMocks.exportBillingCsv.mock.calls[0];
      expect(args[0]).toBe('2');
    });

    createUrl.mockRestore();
    revokeUrl.mockRestore();
  });

  it('passes currency filter to listCustomerInvoices', async () => {
    billingMocks.listCustomerInvoices.mockResolvedValue({ items: [], next_cursor: null });
    render(<ClientInvoicesPanel />);

    await waitFor(() => expect(billingMocks.listCustomerInvoices).toHaveBeenCalled());

    const user = userEvent.setup();
    const currencyFilter = document.getElementById('billing-invoice-currency-filter') as HTMLSelectElement;
    await user.selectOptions(currencyFilter, 'USD');

    await waitFor(() => {
      expect(billingMocks.listCustomerInvoices).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD' }),
        expect.any(AbortSignal),
      );
    });
  });

  it('passes debounced text filter q to listCustomerInvoices', async () => {
    billingMocks.listCustomerInvoices.mockResolvedValue({ items: [], next_cursor: null });
    render(<ClientInvoicesPanel />);

    await waitFor(() => expect(billingMocks.listCustomerInvoices).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/Filter invoices/i), { target: { value: 'INV-9' } });

    await waitFor(
      () => {
        expect(billingMocks.listCustomerInvoices).toHaveBeenCalledWith(
          expect.objectContaining({ q: 'INV-9' }),
          expect.any(AbortSignal),
        );
      },
      { timeout: 4000 },
    );
  });

  it('issued invoice toolbar send email calls emailInvoice with comma-separated recipients', async () => {
    const invId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    billingMocks.listCustomerInvoices.mockResolvedValue({
      items: [
        {
          id: invId,
          status: 'issued',
          currency: 'HKD',
          total: '1',
          lineCount: 0,
          billToEmail: 'bill@example.com',
          createdAt: '2026-01-01T00:00:00+00:00',
        },
      ],
      next_cursor: null,
    });
    billingMocks.emailInvoice.mockResolvedValue({ sent: true });

    render(<ClientInvoicesPanel />);

    await waitFor(() => screen.getAllByRole('table'));

    const invoiceRegion = screen.getByRole('region', { name: /customer invoices list/i });
    const invoiceTable = within(invoiceRegion).getByRole('table');
    await userEvent.click(firstCustomerInvoiceDataRow(invoiceTable));

    await waitFor(() => {
      expect(screen.getByLabelText(/email recipients/i)).toBeInTheDocument();
    });

    const emailField = document.getElementById('billing-issued-invoice-emails') as HTMLInputElement;
    await userEvent.clear(emailField);
    await userEvent.type(emailField, 'a@example.com, b@example.com');

    await userEvent.click(screen.getByRole('button', { name: /^send email$/i }));

    await waitFor(() => {
      expect(billingMocks.emailInvoice).toHaveBeenCalledWith(invId, 'a@example.com, b@example.com');
    });
  });

  it('issued invoice toolbar shows error when recipients empty', async () => {
    const invId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    billingMocks.listCustomerInvoices.mockResolvedValue({
      items: [
        {
          id: invId,
          status: 'issued',
          currency: 'HKD',
          total: '1',
          lineCount: 0,
          billToEmail: null,
          createdAt: '2026-01-01T00:00:00+00:00',
        },
      ],
      next_cursor: null,
    });

    render(<ClientInvoicesPanel />);

    await waitFor(() => screen.getAllByRole('table'));

    const invoiceRegion = screen.getByRole('region', { name: /customer invoices list/i });
    const invoiceTable = within(invoiceRegion).getByRole('table');
    await userEvent.click(firstCustomerInvoiceDataRow(invoiceTable));

    await waitFor(() => {
      expect(screen.getByLabelText(/email recipients/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /^send email$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Enter at least one recipient email/i)).toBeInTheDocument();
    });
    expect(billingMocks.emailInvoice).not.toHaveBeenCalled();
  });

  it('confirm payment dialog calls confirmCustomerPayment', async () => {
    const payId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    billingMocks.listCustomerPayments.mockResolvedValue({
      items: [
        {
          id: payId,
          direction: 'inbound',
          status: 'pending',
          method: 'bank_transfer',
          amount: '10',
          currency: 'HKD',
          createdAt: '2026-01-01T00:00:00+00:00',
          orphanPaymentDeletable: false,
        },
      ],
      next_cursor: null,
    });
    billingMocks.getCustomerPayment.mockResolvedValue({
      id: payId,
      direction: 'inbound',
      status: 'pending',
      method: 'bank_transfer',
      amount: '10',
      currency: 'HKD',
      unappliedAmount: '10',
      createdAt: '2026-01-01T00:00:00+00:00',
      orphanPaymentDeletable: false,
    });
    billingMocks.confirmCustomerPayment.mockResolvedValue({
      id: payId,
      direction: 'inbound',
      status: 'succeeded',
      method: 'bank_transfer',
      amount: '10',
      currency: 'HKD',
      createdAt: '2026-01-01T00:00:00+00:00',
      orphanPaymentDeletable: false,
      party: 'Pat',
      unappliedAmount: '10',
    });

    render(<ClientInvoicesPanel />);

    const paymentTable = screen.getAllByRole('table').at(-1) as HTMLElement;
    await waitFor(() => within(paymentTable).getByRole('button', { name: /confirm pending payment/i }));

    await userEvent.click(within(paymentTable).getByRole('button', { name: /confirm pending payment/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /confirm payment/i })).toBeInTheDocument();
    });

    const refField = document.getElementById('billing-confirm-dialog-ref') as HTMLInputElement;
    await userEvent.type(refField, 'REF-99');

    await userEvent.click(screen.getByRole('button', { name: /^confirm payment$/i }));

    await waitFor(() => {
      expect(billingMocks.confirmCustomerPayment).toHaveBeenCalledWith(payId, {
        externalReference: 'REF-99',
      });
    });
  });

  it('delete payment dialog calls deleteCustomerPayment when server marks row deletable', async () => {
    const payId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    billingMocks.listCustomerPayments.mockResolvedValue({
      items: [
        {
          id: payId,
          direction: 'inbound',
          status: 'pending',
          method: 'bank_transfer',
          amount: '10',
          currency: 'HKD',
          createdAt: '2026-01-01T00:00:00+00:00',
          orphanPaymentDeletable: true,
        },
      ],
      next_cursor: null,
    });
    billingMocks.deleteCustomerPayment.mockResolvedValue(undefined);

    render(<ClientInvoicesPanel />);

    const paymentTable = screen.getAllByRole('table').at(-1) as HTMLElement;
    await waitFor(() =>
      within(paymentTable).getByRole('button', { name: /delete customer payment/i }),
    );

    await userEvent.click(within(paymentTable).getByRole('button', { name: /delete customer payment/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /delete customer payment/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /^delete payment$/i }));

    await waitFor(() => {
      expect(billingMocks.deleteCustomerPayment).toHaveBeenCalledWith(payId);
    });
  });

  it('delete draft invoice dialog calls deleteDraftCustomerInvoice for draft rows', async () => {
    const invId = 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff';
    billingMocks.listCustomerInvoices.mockResolvedValue({
      items: [
        {
          id: invId,
          status: 'draft',
          invoiceNumber: null,
          currency: 'HKD',
          total: '50',
          lineCount: 1,
          billToDisplayName: 'Pat',
          createdAt: '2026-01-01T00:00:00+00:00',
        },
      ],
      next_cursor: null,
    });
    billingMocks.deleteDraftCustomerInvoice.mockResolvedValue(undefined);

    render(<ClientInvoicesPanel />);

    const invoiceRegion = screen.getByRole('region', { name: /customer invoices list/i });
    const invoiceTable = within(invoiceRegion).getByRole('table');
    await waitFor(() =>
      within(invoiceTable).getByRole('button', { name: /delete draft invoice/i }),
    );

    const enrollmentFetchCountBefore =
      billingMocks.listRecentEnrollmentsForInvoicing.mock.calls.length;

    await userEvent.click(within(invoiceTable).getByRole('button', { name: /delete draft invoice/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /delete draft invoice/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /^delete draft$/i }));

    await waitFor(() => {
      expect(billingMocks.deleteDraftCustomerInvoice).toHaveBeenCalledWith(invId);
    });

    await waitFor(() => {
      expect(billingMocks.listRecentEnrollmentsForInvoicing.mock.calls.length).toBeGreaterThan(
        enrollmentFetchCountBefore,
      );
    });
  });

  it('does not render Customer payments Refresh control', async () => {
    billingMocks.listCustomerPayments.mockResolvedValue({ items: [], next_cursor: null });
    render(<ClientInvoicesPanel />);
    await waitFor(() => expect(billingMocks.listCustomerPayments).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /^refresh$/i })).not.toBeInTheDocument();
  });

  it('capitalizes fps payment method as FPS', async () => {
    billingMocks.listCustomerPayments.mockResolvedValue({
      items: [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          direction: 'inbound',
          status: 'succeeded',
          method: 'fps',
          amount: '1',
          currency: 'HKD',
          createdAt: '2026-01-01T00:00:00+00:00',
        },
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          direction: 'inbound',
          status: 'succeeded',
          method: 'bank_fps',
          amount: '2',
          currency: 'HKD',
          createdAt: '2026-01-01T00:00:00+00:00',
        },
      ],
      next_cursor: null,
    });
    render(<ClientInvoicesPanel />);
    const paymentTable = screen.getAllByRole('table').at(-1) as HTMLElement;
    await waitFor(() => {
      const cells = within(paymentTable).getAllByRole('cell');
      expect(cells.some((c) => c.textContent === 'FPS')).toBe(true);
      expect(cells.some((c) => c.textContent === 'Bank FPS')).toBe(true);
    });
  });

  it('submitting allocate form calls createPaymentAllocation', async () => {
    const invId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const lineId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const payId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    billingMocks.listCustomerInvoices.mockResolvedValue({
      items: [
        {
          id: invId,
          status: 'issued',
          invoiceNumber: 'INV-9',
          currency: 'HKD',
          total: '100',
          lineCount: 1,
          createdAt: '2026-01-01T00:00:00+00:00',
        },
      ],
      next_cursor: null,
    });
    billingMocks.getCustomerInvoice.mockResolvedValue({
      id: invId,
      lines: [{ id: lineId, description: 'Service fee', lineOrder: 0 }],
    });

    billingMocks.listCustomerPayments.mockResolvedValue({
      items: [
        {
          id: payId,
          direction: 'inbound',
          status: 'succeeded',
          method: 'bank_transfer',
          amount: '100',
          currency: 'HKD',
          enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          stripePaymentIntentId: null,
          party: 'Pat · Service',
          externalReference: 'WIRE-999',
          unappliedAmount: '100',
          createdAt: '2026-01-01T00:00:00+00:00',
          orphanPaymentDeletable: false,
        },
      ],
      next_cursor: null,
    });
    billingMocks.getCustomerPayment.mockResolvedValue({
      id: payId,
      direction: 'inbound',
      status: 'succeeded',
      method: 'bank_transfer',
      amount: '100',
      currency: 'HKD',
      enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      stripePaymentIntentId: null,
      party: 'Pat · Service',
      externalReference: 'WIRE-999',
      unappliedAmount: '100',
      createdAt: '2026-01-01T00:00:00+00:00',
      allocationInvoices: [],
      orphanPaymentDeletable: false,
    });
    billingMocks.createPaymentAllocation.mockResolvedValue({ allocationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' });

    render(<ClientInvoicesPanel />);

    const invoiceRegion = screen.getByRole('region', { name: /customer invoices list/i });
    const invoiceTable = within(invoiceRegion).getByRole('table');
    await waitFor(() => {
      expect(within(invoiceTable).getAllByRole('button').length).toBeGreaterThan(0);
    });
    await userEvent.click(firstCustomerInvoiceDataRow(invoiceTable));
    await waitFor(() => {
      expect(billingMocks.getCustomerInvoice).toHaveBeenCalledWith(invId, expect.any(AbortSignal));
    });

    const paymentTable = screen.getAllByRole('table').at(-1) as HTMLElement;
    await waitFor(() => {
      expect(within(paymentTable).getAllByRole('row').length).toBeGreaterThan(1);
    });
    await userEvent.click(firstCustomerPaymentDataRow(paymentTable));

    await waitFor(() => {
      expect(billingMocks.getCustomerPayment).toHaveBeenCalledWith(payId, expect.any(AbortSignal));
    });
    await waitFor(() => {
      const refInput = document.getElementById('billing-create-pay-external-ref') as HTMLInputElement;
      expect(refInput.value).toBe('WIRE-999');
    });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/invoice line/i), lineId);

    const amountField = document.getElementById('billing-allocate-amount') as HTMLInputElement;
    await user.clear(amountField);
    await user.type(amountField, '25');

    await user.click(screen.getByRole('button', { name: /^create allocation$/i }));

    await waitFor(() => {
      expect(billingMocks.createPaymentAllocation).toHaveBeenCalledWith({
        paymentId: payId,
        invoiceId: invId,
        invoiceLineId: lineId,
        allocatedAmount: '25',
        currency: 'HKD',
      });
    });
  });

  it('submitting refund form calls createCustomerRefund', async () => {
    const invId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const payId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    billingMocks.listCustomerInvoices.mockResolvedValue({
      items: [
        {
          id: invId,
          status: 'issued',
          invoiceNumber: 'INV-10',
          currency: 'HKD',
          total: '100',
          lineCount: 1,
          createdAt: '2026-01-01T00:00:00+00:00',
        },
      ],
      next_cursor: null,
    });
    billingMocks.listCustomerPayments.mockImplementation(async (params?: { invoiceId?: string }) => {
      const filtered =
        params?.invoiceId === invId
          ? [
              {
                id: payId,
                direction: 'inbound' as const,
                status: 'succeeded' as const,
                method: 'stripe_card',
                amount: '100',
                currency: 'HKD',
                createdAt: '2026-01-01T00:00:00+00:00',
              },
            ]
          : [
              {
                id: payId,
                direction: 'inbound' as const,
                status: 'succeeded' as const,
                method: 'stripe_card',
                amount: '100',
                currency: 'HKD',
                createdAt: '2026-01-01T00:00:00+00:00',
              },
            ];
      return { items: filtered, next_cursor: null };
    });
    billingMocks.getCustomerPayment.mockResolvedValue({
      id: payId,
      direction: 'inbound',
      status: 'succeeded',
      method: 'stripe_card',
      amount: '100',
      currency: 'HKD',
      unappliedAmount: '0',
      createdAt: '2026-01-01T00:00:00+00:00',
      allocationInvoices: [{ invoiceId: invId, invoiceNumber: 'INV-10' }],
    });
    billingMocks.createCustomerRefund.mockResolvedValue({
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      direction: 'refund',
      status: 'succeeded',
      amount: '10',
      currency: 'HKD',
      createdAt: '2026-01-01T00:00:00+00:00',
    });

    render(<ClientInvoicesPanel />);

    const invoiceRegion = screen.getByRole('region', { name: /customer invoices list/i });
    const invoiceTable = within(invoiceRegion).getByRole('table');
    await waitFor(() => {
      expect(within(invoiceTable).getAllByRole('button').length).toBeGreaterThan(0);
    });
    await userEvent.click(firstCustomerInvoiceDataRow(invoiceTable));

    const paymentTable = screen.getAllByRole('table').at(-1) as HTMLElement;
    await waitFor(() => {
      expect(within(paymentTable).getAllByRole('row').length).toBeGreaterThan(1);
    });
    await userEvent.click(firstCustomerPaymentDataRow(paymentTable));

    await waitFor(() => {
      const invoiceSelect = document.getElementById('billing-refund-invoice') as HTMLSelectElement;
      expect(invoiceSelect.value).toBe(invId);
    });

    const refundAmount = document.getElementById('billing-refund-amount') as HTMLInputElement;
    await userEvent.clear(refundAmount);
    await userEvent.type(refundAmount, '10');

    await userEvent.click(screen.getByRole('button', { name: /^record refund$/i }));

    await waitFor(() => {
      expect(billingMocks.createCustomerRefund).toHaveBeenCalledWith({
        direction: 'refund',
        originalPaymentId: payId,
        amount: '10',
        currency: 'HKD',
        method: undefined,
        stripeRefundId: null,
      });
    });
  });

  it('shows billing error when issueInvoice rejects', async () => {
    const invId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    billingMocks.listCustomerInvoices.mockResolvedValue({
      items: [
        {
          id: invId,
          status: 'draft',
          currency: 'HKD',
          total: '1',
          lineCount: 0,
          createdAt: '2026-01-01T00:00:00+00:00',
        },
      ],
      next_cursor: null,
    });
    billingMocks.issueInvoice.mockRejectedValue(new Error('Invoice is not draft'));

    render(<ClientInvoicesPanel />);

    await waitFor(() => screen.getByRole('button', { name: /issue invoice/i }));
    await userEvent.click(screen.getByRole('button', { name: /issue invoice/i }));

    await waitFor(() => {
      expect(screen.getByText('Invoice is not draft')).toBeInTheDocument();
    });
  });

  it('shows billing error when create draft submitted with no enrollments selected', async () => {
    render(<ClientInvoicesPanel />);

    await waitFor(() =>
      screen.getByRole('button', { name: 'Create draft invoice from selected enrollments' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Create draft invoice from selected enrollments' }),
    );

    await waitFor(() => {
      expect(screen.getByText('Select at least one enrollment.')).toBeInTheDocument();
    });
    expect(billingMocks.createDraftInvoice).not.toHaveBeenCalled();
  });

  const pickerRow = (
    overrides: Partial<{
      enrollmentId: string;
      partyDisplayName: string;
      partyEmail: string | null;
      billToMergeKey: string;
      invoiceLinked: boolean;
      amountPaid: string | null;
      billToKind: 'contact' | 'family' | 'organization';
    }>,
  ) => ({
    enrollmentId: overrides.enrollmentId ?? 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    partyDisplayName: overrides.partyDisplayName ?? 'Pat',
    partyEmail: overrides.partyEmail !== undefined ? overrides.partyEmail : 'pat@example.com',
    billToKind: overrides.billToKind ?? 'contact',
    instanceTitle: 'Inst',
    serviceTierName: null,
    instanceCohort: null,
    amountPaid: overrides.amountPaid ?? '100.00',
    currency: 'HKD',
    enrolledAt: '2026-01-15T00:00:00+00:00',
    invoiceLinked: overrides.invoiceLinked ?? false,
    billToMergeKey: overrides.billToMergeKey ?? 'contact||uuid-a||',
  });

  it('server-side filter (q) narrows enrollment rows after debounce', async () => {
    billingMocks.listRecentEnrollmentsForInvoicing.mockImplementation(async (_signal, params) => {
      const q = (params?.q ?? '').trim();
      const all = [
        pickerRow({
          enrollmentId: '11111111-1111-1111-1111-111111111111',
          partyDisplayName: 'Alice Alpha',
        }),
        pickerRow({
          enrollmentId: '22222222-2222-2222-2222-222222222222',
          partyDisplayName: 'Bob Beta',
        }),
      ];
      if (!q) {
        return { items: all, truncated: false };
      }
      const needle = q.toLowerCase();
      return {
        items: all.filter(
          (r) =>
            r.partyDisplayName.toLowerCase().includes(needle) ||
            r.enrollmentId.toLowerCase().includes(needle),
        ),
        truncated: false,
      };
    });
    render(<ClientInvoicesPanel />);

    await waitFor(() => {
      expect(document.querySelectorAll('[aria-label="Enrollment picker"]').length).toBeGreaterThan(0);
    });
    const enrollmentPickerSection = document.querySelector(
      '[aria-label="Enrollment picker"]',
    ) as HTMLElement;

    await waitFor(() =>
      expect(within(enrollmentPickerSection).getByText(/Alice Alpha/)).toBeInTheDocument(),
    );

    const filterInput = screen.getByPlaceholderText(/Search name, email, title, tier, cohort/i);
    await userEvent.type(filterInput, 'Bob');

    await waitFor(
      () => {
        expect(billingMocks.listRecentEnrollmentsForInvoicing).toHaveBeenCalledWith(expect.any(AbortSignal), {
          q: 'Bob',
        });
      },
      { timeout: 4000 },
    );

    await waitFor(() => {
      expect(within(enrollmentPickerSection).queryByText(/Alice Alpha/)).not.toBeInTheDocument();
    });
    expect(within(enrollmentPickerSection).getByText(/Bob Beta/)).toBeInTheDocument();
  });

  it('server-side filter matches enrollment id substring', async () => {
    billingMocks.listRecentEnrollmentsForInvoicing.mockImplementation(async (_signal, params) => {
      const q = (params?.q ?? '').trim();
      const all = [
        pickerRow({
          enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-111111111111',
          partyDisplayName: 'Alice Alpha',
        }),
        pickerRow({
          enrollmentId: 'bbbbbbbb-bbbb-bbbb-bbbb-222222222222',
          partyDisplayName: 'Bob Beta',
        }),
      ];
      if (!q) {
        return { items: all, truncated: false };
      }
      const needle = q.replace(/-/g, '').toLowerCase();
      return {
        items: all.filter((r) => {
          const idCompact = r.enrollmentId.replace(/-/g, '').toLowerCase();
          return idCompact.includes(needle) || r.enrollmentId.toLowerCase().includes(q.toLowerCase());
        }),
        truncated: false,
      };
    });
    render(<ClientInvoicesPanel />);

    await waitFor(() => {
      expect(document.querySelectorAll('[aria-label="Enrollment picker"]').length).toBeGreaterThan(0);
    });
    const enrollmentPickerSection = document.querySelector(
      '[aria-label="Enrollment picker"]',
    ) as HTMLElement;

    await waitFor(() =>
      expect(within(enrollmentPickerSection).getByText(/Alice Alpha/)).toBeInTheDocument(),
    );

    const filterInput = screen.getByPlaceholderText(/Search name, email, title, tier, cohort/i);
    await userEvent.type(filterInput, '22222222');

    await waitFor(
      () => {
        expect(billingMocks.listRecentEnrollmentsForInvoicing).toHaveBeenCalledWith(expect.any(AbortSignal), {
          q: '22222222',
        });
      },
      { timeout: 4000 },
    );

    await waitFor(() => {
      expect(within(enrollmentPickerSection).queryByText(/Alice Alpha/)).not.toBeInTheDocument();
    });
    expect(within(enrollmentPickerSection).getByText(/Bob Beta/)).toBeInTheDocument();
  });

  it('create draft omits currency when selection is valid', async () => {
    const id1 = 'aaaaaaaa-bbbb-cccc-dddd-111111111111';
    const id2 = 'aaaaaaaa-bbbb-cccc-dddd-222222222222';
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [
        pickerRow({
          enrollmentId: id1,
          billToMergeKey: 'family||fam-1||',
          amountPaid: '50.00',
        }),
        pickerRow({
          enrollmentId: id2,
          billToMergeKey: 'family||fam-1||',
          amountPaid: '50.00',
        }),
      ],
      truncated: false,
    });
    billingMocks.createDraftInvoice.mockResolvedValue({ invoiceId: 'inv-1', status: 'draft' });

    render(<ClientInvoicesPanel />);

    await waitFor(() => screen.getAllByRole('checkbox', { name: /Select enrollment/i }));

    const checks = screen.getAllByRole('checkbox', { name: /Select enrollment/i });
    await userEvent.click(checks[0]);
    await userEvent.click(checks[1]);

    await userEvent.click(
      screen.getByRole('button', { name: 'Create draft invoice from selected enrollments' }),
    );

    await waitFor(() => {
      expect(billingMocks.createDraftInvoice).toHaveBeenCalled();
    });
    const arg = billingMocks.createDraftInvoice.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.draftKind).toBe('enrollment_merge');
    expect(arg.currency).toBeUndefined();
    expect(arg.enrollmentIds).toEqual([id1, id2]);
    expect(arg.lineTotalsByEnrollmentId).toBeUndefined();
    expect(arg.invoiceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('create draft allows zero-dollar enrollments with recorded amount 0', async () => {
    const id1 = 'aaaaaaaa-bbbb-cccc-dddd-111111111111';
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [
        pickerRow({
          enrollmentId: id1,
          billToMergeKey: 'family||fam-1||',
          amountPaid: '0',
        }),
      ],
      truncated: false,
    });
    billingMocks.createDraftInvoice.mockResolvedValue({ invoiceId: 'inv-zero', status: 'draft' });

    render(<ClientInvoicesPanel />);

    await waitFor(() => screen.getByRole('checkbox', { name: /Select enrollment/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Select enrollment/i }));

    const createBtn = screen.getByRole('button', {
      name: 'Create draft invoice from selected enrollments',
    });
    expect(createBtn).not.toBeDisabled();

    await userEvent.click(createBtn);

    await waitFor(() => {
      expect(billingMocks.createDraftInvoice).toHaveBeenCalled();
    });
    const arg = billingMocks.createDraftInvoice.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.draftKind).toBe('enrollment_merge');
    expect(arg.enrollmentIds).toEqual([id1]);
    expect(arg.lineTotalsByEnrollmentId).toBeUndefined();
    expect(arg.invoiceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('create draft is disabled when line total override is not a valid number', async () => {
    const id1 = 'aaaaaaaa-bbbb-cccc-dddd-111111111111';
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [
        pickerRow({
          enrollmentId: id1,
          billToMergeKey: 'family||fam-1||',
          amountPaid: '50.00',
        }),
      ],
      truncated: false,
    });

    render(<ClientInvoicesPanel />);

    await waitFor(() => screen.getByRole('checkbox', { name: /Select enrollment/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Select enrollment/i }));

    const override1 = document.getElementById(`billing-line-override-${id1}`) as HTMLInputElement;
    await userEvent.clear(override1);
    await userEvent.type(override1, 'not-a-number');

    expect(
      screen.getByRole('button', { name: 'Create draft invoice from selected enrollments' }),
    ).toBeDisabled();
    expect(screen.getByText(/Enter a valid number for every line total/i)).toBeInTheDocument();
    expect(billingMocks.createDraftInvoice).not.toHaveBeenCalled();
  });

  it('create draft sends lineTotalsByEnrollmentId when override differs', async () => {
    const id1 = 'aaaaaaaa-bbbb-cccc-dddd-111111111111';
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [
        pickerRow({
          enrollmentId: id1,
          billToMergeKey: 'family||fam-1||',
          amountPaid: '50.00',
        }),
      ],
      truncated: false,
    });
    billingMocks.createDraftInvoice.mockResolvedValue({ invoiceId: 'inv-2', status: 'draft' });

    render(<ClientInvoicesPanel />);

    await waitFor(() => screen.getByRole('checkbox', { name: /Select enrollment/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Select enrollment/i }));

    const override1 = document.getElementById(`billing-line-override-${id1}`) as HTMLInputElement;
    await userEvent.clear(override1);
    await userEvent.type(override1, '99');

    await userEvent.click(
      screen.getByRole('button', { name: 'Create draft invoice from selected enrollments' }),
    );

    await waitFor(() => {
      expect(billingMocks.createDraftInvoice).toHaveBeenCalled();
    });
    const arg = billingMocks.createDraftInvoice.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.draftKind).toBe('enrollment_merge');
    expect(arg.currency).toBeUndefined();
    expect(arg.lineTotalsByEnrollmentId).toEqual({ [id1]: '99' });
    expect(arg.invoiceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    cleanup();
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [
        pickerRow({
          enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-111111111111',
          billToMergeKey: 'k1',
        }),
        pickerRow({
          enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-222222222222',
          billToMergeKey: 'k2',
        }),
      ],
      truncated: false,
    });
    render(<ClientInvoicesPanel />);

    await waitFor(() => screen.getAllByRole('checkbox', { name: /Select enrollment/i }));
    const checks = screen.getAllByRole('checkbox', { name: /Select enrollment/i });
    await userEvent.click(checks[0]);
    await userEvent.click(checks[1]);

    expect(
      screen.getByText(/must share the same bill-to/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create draft invoice from selected enrollments' }),
    ).toBeDisabled();
  });

  it('create customized draft posts billTo, currency, and lines', async () => {
    billingMocks.createDraftInvoice.mockResolvedValue({ invoiceId: 'inv-custom', status: 'draft' });

    render(<ClientInvoicesPanel />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create draft invoice' })).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByLabelText(/^Draft type$/i), 'customized');

    const customizedForm = document.getElementById('client-billing-customized-draft-form');
    expect(customizedForm).toBeTruthy();
    const desc = within(customizedForm as HTMLElement).getByLabelText(/^Description/i);
    await userEvent.clear(desc);
    await userEvent.type(desc, 'Consulting hours');

    const unit = within(customizedForm as HTMLElement).getByLabelText(/^Unit price/i);
    await userEvent.clear(unit);
    await userEvent.type(unit, '150');

    await userEvent.type(screen.getByLabelText(/^Contact$/i), 'Pa');
    await userEvent.click(await screen.findByRole('option', { name: 'Pat Contact' }));

    await userEvent.click(screen.getByRole('button', { name: 'Create draft invoice from custom lines' }));

    await waitFor(() => {
      expect(billingMocks.createDraftInvoice).toHaveBeenCalled();
    });
    const arg = billingMocks.createDraftInvoice.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      draftKind: 'customized_manual',
      billTo: { kind: 'contact', contactId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' },
      currency: 'HKD',
      lines: [{ description: 'Consulting hours', quantity: '1', unitAmount: '150' }],
      invoiceDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it('create customized draft sends chosen top-level invoice date', async () => {
    billingMocks.createDraftInvoice.mockResolvedValue({ invoiceId: 'inv-d', status: 'draft' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
    try {
      render(<ClientInvoicesPanel />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Create draft invoice' })).toBeInTheDocument();
      });

      await userEvent.selectOptions(screen.getByLabelText(/^Draft type$/i), 'customized');

      const dateInput = screen.getByLabelText(/^Invoice date$/i) as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2025-07-04' } });

      const customizedForm = document.getElementById('client-billing-customized-draft-form');
      expect(customizedForm).toBeTruthy();
      const desc = within(customizedForm as HTMLElement).getByLabelText(/^Description/i);
      await userEvent.clear(desc);
      await userEvent.type(desc, 'Line A');

      const unit = within(customizedForm as HTMLElement).getByLabelText(/^Unit price/i);
      await userEvent.clear(unit);
      await userEvent.type(unit, '25');

      await userEvent.type(screen.getByLabelText(/^Contact$/i), 'Pa');
      await userEvent.click(await screen.findByRole('option', { name: 'Pat Contact' }));

      await userEvent.click(screen.getByRole('button', { name: 'Create draft invoice from custom lines' }));

      await waitFor(() => {
        expect(billingMocks.createDraftInvoice).toHaveBeenCalled();
      });
      expect(billingMocks.createDraftInvoice.mock.calls[0][0]).toMatchObject({
        draftKind: 'customized_manual',
        invoiceDate: '2025-07-04',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows message when every enrollment returned is invoice-linked', async () => {
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [pickerRow({ enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-111111111111', invoiceLinked: true })],
      truncated: false,
    });
    render(<ClientInvoicesPanel />);

    await waitFor(() =>
      expect(
        screen.getByText(/All matching enrollments are already on a draft or issued invoice/i),
      ).toBeInTheDocument(),
    );
  });

  it('hides invoice-linked enrollments from draft picker table', async () => {
    const blockedId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [
        pickerRow({ enrollmentId: blockedId, invoiceLinked: true }),
        pickerRow({ enrollmentId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', invoiceLinked: false }),
      ],
      truncated: false,
    });
    render(<ClientInvoicesPanel />);

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Select enrollment cccccccc/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('checkbox', { name: new RegExp(blockedId, 'i') })).not.toBeInTheDocument();
  });

  it('select all visible selects every shown row when server also returns invoice-linked enrollments', async () => {
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [
        pickerRow({ enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-111111111111', invoiceLinked: true }),
        pickerRow({ enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-222222222222', invoiceLinked: false }),
        pickerRow({ enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-333333333333', invoiceLinked: false }),
      ],
      truncated: false,
    });
    render(<ClientInvoicesPanel />);

    await waitFor(() => screen.getByRole('checkbox', { name: /Select all visible enrollments/i }));

    await userEvent.click(screen.getByRole('checkbox', { name: /Select all visible enrollments/i }));

    await waitFor(() => {
      const rowChecks = screen.getAllByRole('checkbox', { name: /^Select enrollment /i });
      expect(rowChecks).toHaveLength(2);
      expect(rowChecks.every((el) => (el as HTMLInputElement).checked)).toBe(true);
    });
  });

  it('draft enrollment picker Party column shows server partyDisplayName', async () => {
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [
        pickerRow({
          enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-111111111111',
          partyDisplayName: 'Sam Sample \u00b7 sam@example.com',
          partyEmail: 'sam@example.com',
        }),
        pickerRow({
          enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-222222222222',
          partyDisplayName: 'No Email Party',
          partyEmail: null,
        }),
      ],
      truncated: false,
    });
    render(<ClientInvoicesPanel />);

    await waitFor(() => {
      expect(screen.getByText('Sam Sample · sam@example.com')).toBeInTheDocument();
    });
    expect(screen.getByText('No Email Party')).toBeInTheDocument();
    const enrollmentPicker = screen.getByRole('region', { name: 'Enrollment picker' });
    expect(within(enrollmentPicker).queryByRole('columnheader', { name: 'Email' })).not.toBeInTheDocument();
    expect(within(enrollmentPicker).queryByRole('columnheader', { name: 'Invoice' })).not.toBeInTheDocument();
  });

  it('draft enrollment picker Party column for family bill-to uses composed label without appending email', async () => {
    billingMocks.listRecentEnrollmentsForInvoicing.mockResolvedValue({
      items: [
        pickerRow({
          enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-111111111111',
          partyDisplayName: 'Smith Family · Jane Primary',
          partyEmail: 'jane@example.com',
          billToKind: 'family',
        }),
      ],
      truncated: false,
    });
    render(<ClientInvoicesPanel />);

    await waitFor(() => {
      expect(screen.getByText('Smith Family · Jane Primary')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Smith Family · Jane Primary · jane@example.com/)).not.toBeInTheDocument();
  });
});
