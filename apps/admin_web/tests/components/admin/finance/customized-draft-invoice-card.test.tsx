import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const billingMocks = vi.hoisted(() => ({
  createDraftInvoice: vi.fn(),
}));

const billToPartyMocks = vi.hoisted(() => ({
  searchBillToParties: vi.fn(),
  createBillToParty: vi.fn(),
}));

vi.mock('@/lib/billing-api', () => ({
  createDraftInvoice: billingMocks.createDraftInvoice,
}));

vi.mock('@/lib/bill-to-party-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bill-to-party-api')>();
  return {
    ...actual,
    searchBillToParties: billToPartyMocks.searchBillToParties,
    createBillToParty: billToPartyMocks.createBillToParty,
  };
});

import { CustomizedDraftInvoiceCard } from '@/components/admin/finance/customized-draft-invoice-card';

const EXISTING_CONTACT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PARTNER_ORG_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

async function fillRequiredLine(form: HTMLElement) {
  const desc = within(form).getByLabelText(/^Description/i);
  await userEvent.type(desc, 'Line A');
  const unit = within(form).getByLabelText(/^Unit price/i);
  await userEvent.clear(unit);
  await userEvent.type(unit, '25');
}

describe('CustomizedDraftInvoiceCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
    billingMocks.createDraftInvoice.mockReset();
    billToPartyMocks.searchBillToParties.mockReset();
    billToPartyMocks.createBillToParty.mockReset();
    billToPartyMocks.searchBillToParties.mockResolvedValue([
      { id: EXISTING_CONTACT_ID, label: 'Pat Contact' },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('submits customized draft with draftKind and billTo', async () => {
    billingMocks.createDraftInvoice.mockResolvedValue({ invoiceId: 'inv-x', status: 'draft' });
    const onCreated = vi.fn();

    render(
      <CustomizedDraftInvoiceCard
        defaultCurrency='HKD'
        currencyOptions={[{ value: 'HKD', label: 'HKD' }]}
        editorBusy={false}
        loadParents
        draftInvoiceDate='2025-06-01'
        onCreated={onCreated}
      />,
    );

    const form = document.getElementById('client-billing-customized-draft-form');
    expect(form).toBeTruthy();
    await fillRequiredLine(form as HTMLElement);

    await userEvent.type(screen.getByLabelText(/^Contact$/i), 'Pa');
    await userEvent.click(await screen.findByRole('option', { name: 'Pat Contact' }));

    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(billingMocks.createDraftInvoice).toHaveBeenCalled();
    });
    expect(billingMocks.createDraftInvoice.mock.calls[0][0]).toMatchObject({
      draftKind: 'customized_manual',
      billTo: { kind: 'contact', contactId: EXISTING_CONTACT_ID },
      currency: 'HKD',
      lines: [{ description: 'Line A', quantity: '1', unitAmount: '25' }],
      invoiceDate: '2025-06-01',
    });
    expect(billToPartyMocks.createBillToParty).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith('inv-x');
  });

  it('creates a new contact from the search box then posts that id on the draft', async () => {
    billingMocks.createDraftInvoice.mockResolvedValue({ invoiceId: 'inv-new', status: 'draft' });
    billToPartyMocks.searchBillToParties.mockResolvedValue([]);
    billToPartyMocks.createBillToParty.mockResolvedValue({
      id: '99999999-9999-9999-9999-999999999999',
      label: 'New Person',
    });

    render(
      <CustomizedDraftInvoiceCard
        defaultCurrency='HKD'
        currencyOptions={[{ value: 'HKD', label: 'HKD' }]}
        editorBusy={false}
        loadParents
        draftInvoiceDate='2025-06-01'
        onCreated={vi.fn()}
      />,
    );

    const form = document.getElementById('client-billing-customized-draft-form');
    expect(form).toBeTruthy();
    await fillRequiredLine(form as HTMLElement);

    await userEvent.type(screen.getByLabelText(/^Contact$/i), 'New Person');
    expect(await screen.findByText(/^New contact$/i)).toBeInTheDocument();

    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(billToPartyMocks.createBillToParty).toHaveBeenCalledWith('contact', 'New Person');
    });
    expect(billingMocks.createDraftInvoice.mock.calls[0][0]).toMatchObject({
      billTo: { kind: 'contact', contactId: '99999999-9999-9999-9999-999999999999' },
    });
  });

  it('submits partner bill-to as organization with selected partner org id', async () => {
    billingMocks.createDraftInvoice.mockResolvedValue({ invoiceId: 'inv-p', status: 'draft' });
    billToPartyMocks.searchBillToParties.mockResolvedValue([
      { id: PARTNER_ORG_ID, label: 'Partner Org' },
    ]);

    render(
      <CustomizedDraftInvoiceCard
        defaultCurrency='HKD'
        currencyOptions={[{ value: 'HKD', label: 'HKD' }]}
        editorBusy={false}
        loadParents
        draftInvoiceDate='2025-06-01'
        onCreated={vi.fn()}
      />,
    );

    const form = document.getElementById('client-billing-customized-draft-form');
    expect(form).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText(/^Bill to$/i), 'partner');
    await userEvent.type(screen.getByLabelText(/^Partner organization$/i), 'Pa');
    await userEvent.click(await screen.findByRole('option', { name: 'Partner Org' }));

    const desc = within(form as HTMLElement).getByLabelText(/^Description/i);
    await userEvent.type(desc, 'Partner fee');

    const unit = within(form as HTMLElement).getByLabelText(/^Unit price/i);
    await userEvent.clear(unit);
    await userEvent.type(unit, '99');

    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(billingMocks.createDraftInvoice).toHaveBeenCalled();
    });
    expect(billingMocks.createDraftInvoice.mock.calls[0][0]).toMatchObject({
      draftKind: 'customized_manual',
      billTo: { kind: 'organization', organizationId: PARTNER_ORG_ID },
      lines: [{ description: 'Partner fee', quantity: '1', unitAmount: '99' }],
      invoiceDate: '2025-06-01',
    });
  });
});
