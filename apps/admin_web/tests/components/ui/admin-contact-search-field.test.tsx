import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  AdminContactSearchField,
  type SelectedContactValue,
} from '@/components/ui/admin-contact-search-field';

vi.mock('@/lib/entity-api', () => ({
  searchEntityContactsForPicker: vi.fn(async () => [
    { id: '11111111-1111-4111-8111-111111111111', label: 'Jane Doe · jane@example.com' },
  ]),
}));

function Harness() {
  const [value, setValue] = useState<SelectedContactValue>({ status: 'empty' });
  return <AdminContactSearchField inputId='contact-search' value={value} onChange={setValue} />;
}

describe('AdminContactSearchField', () => {
  it('keeps characters typed one at a time before the 2-character search minimum', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'j');
    expect(input).toHaveValue('j');
    await user.type(input, 'a');
    expect(input).toHaveValue('ja');

    const option = await screen.findByRole('option', { name: 'Jane Doe · jane@example.com' });
    fireEvent.click(option);
    expect(input).toHaveValue('Jane Doe · jane@example.com');
  });
});
