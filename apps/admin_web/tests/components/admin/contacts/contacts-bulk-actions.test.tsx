import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ContactsBulkActions } from '@/components/admin/contacts/contacts-bulk-actions';
import type { components } from '@/types/generated/admin-api.generated';

type AdminContact = components['schemas']['AdminContact'];

function buildContact(overrides: Partial<AdminContact> = {}): AdminContact {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    first_name: 'Ann',
    last_name: 'Lee',
    email: 'ann@example.com',
    instagram_handle: null,
    phone_region: null,
    phone_national_number: null,
    phone_e164: null,
    contact_type: 'parent',
    relationship_type: 'prospect',
    source: 'manual',
    mailchimp_status: 'pending',
    active: true,
    created_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
    tag_ids: [],
    tags: [],
    family_ids: [],
    organization_ids: [],
    family_location_summary: null,
    organization_location_summary: null,
    standalone_note_count: 0,
    has_completion_certificate: false,
    has_sales_conversation: false,
    has_service_instance: false,
    has_invoice: false,
    ...overrides,
  };
}

const sampleContacts: AdminContact[] = [
  buildContact(),
  buildContact({
    id: '22222222-2222-2222-2222-222222222222',
    first_name: 'Gabriella',
    last_name: 'Zavatti',
    email: 'gabriella@example.com',
    relationship_type: 'client',
  }),
];

describe('ContactsBulkActions', () => {
  it('hides merge until two contacts are selected', () => {
    const { rerender } = render(
      <ContactsBulkActions
        selectedCount={1}
        selectedContacts={sampleContacts.slice(0, 1)}
        onBulkMerge={vi.fn()}
      />
    );
    expect(screen.getByText('1 contact(s) selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Merge contacts' })).not.toBeInTheDocument();

    rerender(
      <ContactsBulkActions
        selectedCount={2}
        selectedContacts={sampleContacts}
        onBulkMerge={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Merge contacts' })).toBeInTheDocument();
  });

  it('merges selected contacts after choosing a keeper', async () => {
    const user = userEvent.setup();
    const onBulkMerge = vi.fn();

    render(
      <ContactsBulkActions
        selectedCount={2}
        selectedContacts={sampleContacts}
        onBulkMerge={onBulkMerge}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Merge contacts' }));
    await user.click(screen.getByRole('radio', { name: /Gabriella Zavatti/i }));
    const confirmMerge = screen.getAllByRole('button', { name: 'Merge contacts' })[1];
    await user.click(confirmMerge!);

    expect(onBulkMerge).toHaveBeenCalledWith(
      ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
      '22222222-2222-2222-2222-222222222222'
    );
  });
});
