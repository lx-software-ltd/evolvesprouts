import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const billToPartyMocks = vi.hoisted(() => ({
  searchBillToParties: vi.fn(),
}));

vi.mock('@/lib/bill-to-party-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bill-to-party-api')>();
  return {
    ...actual,
    searchBillToParties: billToPartyMocks.searchBillToParties,
  };
});

import { BillToPartySearchOrCreateField } from '@/components/admin/finance/bill-to-party-search-or-create-field';
import type { BillToPartyValue } from '@/lib/bill-to-party-api';
import { useState } from 'react';

function Harness() {
  const [value, setValue] = useState<BillToPartyValue>({ status: 'empty' });
  return (
    <BillToPartySearchOrCreateField
      kind='contact'
      inputId='bill-to-contact'
      enabled
      value={value}
      onChange={setValue}
    />
  );
}

describe('BillToPartySearchOrCreateField', () => {
  beforeEach(() => {
    billToPartyMocks.searchBillToParties.mockReset();
    billToPartyMocks.searchBillToParties.mockResolvedValue([
      { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', label: 'Pat Contact' },
    ]);
  });

  it('lists matches after two characters and selects an existing contact', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText(/^Contact$/i), 'Pa');
    const option = await screen.findByRole('option', { name: 'Pat Contact' });
    await userEvent.click(option);
    await waitFor(() => {
      expect(screen.getByLabelText(/^Contact$/i)).toHaveValue('Pat Contact');
    });
    expect(screen.queryByText(/^New contact$/i)).not.toBeInTheDocument();
  });

  it('highlights a new contact when the typed value is not selected from matches', async () => {
    billToPartyMocks.searchBillToParties.mockResolvedValue([]);
    render(<Harness />);
    await userEvent.type(screen.getByLabelText(/^Contact$/i), 'New Person');
    expect(await screen.findByText(/^New contact$/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Create new contact: New Person/i })).toBeInTheDocument();
  });
});
