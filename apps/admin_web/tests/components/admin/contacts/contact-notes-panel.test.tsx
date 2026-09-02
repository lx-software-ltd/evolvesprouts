import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listAdminContactNotes,
  createAdminContactNote,
  updateAdminContactNote,
  deleteAdminContactNote,
} = vi.hoisted(() => ({
  listAdminContactNotes: vi.fn(),
  createAdminContactNote: vi.fn(),
  updateAdminContactNote: vi.fn(),
  deleteAdminContactNote: vi.fn(),
}));

vi.mock('@/lib/entity-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/entity-api')>();
  return {
    ...actual,
    listAdminContactNotes,
    createAdminContactNote,
    updateAdminContactNote,
    deleteAdminContactNote,
  };
});

vi.mock('@/hooks/use-confirm-dialog', () => ({
  useConfirmDialog: () => [
    {
      open: false,
      title: '',
      description: '',
      onConfirm: () => {},
      onCancel: () => {},
    },
    () => Promise.resolve(true),
  ],
}));

import { ContactNotesPanel } from '@/components/admin/contacts/contact-notes-panel';
import type { components } from '@/types/generated/admin-api.generated';

const CONTACT: components['schemas']['AdminContact'] = {
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
  standalone_note_count: 0,
  has_completion_certificate: false,
  has_sales_conversation: false,
  has_service_instance: false,
  has_invoice: false,
};

describe('ContactNotesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads notes and supports add, edit, and delete flows', async () => {
    const user = userEvent.setup();
    const onStandaloneNoteCountChange = vi.fn();
    const onClose = vi.fn();

    listAdminContactNotes.mockResolvedValue([
      {
        id: 'note-1',
        content: 'Existing note',
        created_by: 'user-1',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: null,
      },
    ]);
    createAdminContactNote.mockResolvedValue({
      id: 'note-2',
      content: 'New note',
      created_by: 'user-1',
      created_at: '2026-01-02T00:00:00.000Z',
      updated_at: null,
    });
    updateAdminContactNote.mockResolvedValue({
      id: 'note-1',
      content: 'Updated note',
      created_by: 'user-1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-03T00:00:00.000Z',
    });
    deleteAdminContactNote.mockResolvedValue(undefined);

    render(
      <ContactNotesPanel
        contact={CONTACT}
        adminUsers={[{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }]}
        onClose={onClose}
        onStandaloneNoteCountChange={onStandaloneNoteCountChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Existing note')).toBeInTheDocument();
    });
    expect(onStandaloneNoteCountChange).toHaveBeenCalledWith(CONTACT.id, 1);

    await user.type(screen.getByPlaceholderText('Add a note about this contact…'), 'New note');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => {
      expect(createAdminContactNote).toHaveBeenCalledWith(CONTACT.id, { content: 'New note' });
    });
    expect(screen.getAllByText('New note').length).toBeGreaterThanOrEqual(1);

    const editButtons = screen.getAllByRole('button', { name: 'Edit note' });
    await user.click(editButtons[editButtons.length - 1]!);
    await user.clear(screen.getByPlaceholderText('Add a note about this contact…'));
    await user.type(screen.getByPlaceholderText('Add a note about this contact…'), 'Updated note');
    await user.click(screen.getByRole('button', { name: 'Update note' }));

    await waitFor(() => {
      expect(updateAdminContactNote).toHaveBeenCalledWith(CONTACT.id, 'note-1', {
        content: 'Updated note',
      });
      expect(screen.getByText('Updated note')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete note' });
    await user.click(deleteButtons[deleteButtons.length - 1]!);

    await waitFor(() => {
      expect(deleteAdminContactNote).toHaveBeenCalledWith(CONTACT.id, 'note-1');
    });
  });

  it('shows the notes editor before a contact exists', () => {
    render(<ContactNotesPanel contact={null} adminUsers={[]} />);

    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contact notes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notes' }).closest('.grid')).toBe(
      screen.getByRole('heading', { name: 'Contact notes' }).closest('.grid')
    );
    expect(screen.getByText('Save the lead to add notes for the linked contact.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled();
    expect(listAdminContactNotes).not.toHaveBeenCalled();
  });

  it('shows load errors from the API', async () => {
    listAdminContactNotes.mockRejectedValue(new Error('Failed to load notes'));

    render(
      <ContactNotesPanel
        contact={CONTACT}
        adminUsers={[]}
        onClose={vi.fn()}
        onStandaloneNoteCountChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load notes')).toBeInTheDocument();
    });
  });

  it('embedded layout: + opens a draft row, clicking a note opens its editor, Delete stays in Operations', async () => {
    const user = userEvent.setup();
    listAdminContactNotes.mockResolvedValue([
      {
        id: 'note-1',
        content: 'Existing note',
        created_by: 'user-1',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: null,
      },
    ]);
    createAdminContactNote.mockResolvedValue({
      id: 'note-2',
      content: 'Fresh note',
      created_by: 'user-1',
      created_at: '2026-01-02T00:00:00.000Z',
      updated_at: null,
    });
    updateAdminContactNote.mockResolvedValue({
      id: 'note-1',
      content: 'Existing note edited',
      created_by: 'user-1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-03T00:00:00.000Z',
    });
    deleteAdminContactNote.mockResolvedValue(undefined);

    render(<ContactNotesPanel layout='embedded' contact={CONTACT} adminUsers={[]} />);

    await waitFor(() => {
      expect(screen.getByText('Existing note')).toBeInTheDocument();
    });
    expect(screen.getByRole('region', { name: 'Notes' })).toHaveAttribute('data-embedded', 'true');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit note' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New note' }));
    expect(screen.getByTestId('admin-row-note-draft')).toHaveAttribute('data-draft', 'true');
    await user.type(screen.getByRole('textbox', { name: 'New note' }), 'Fresh note');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => {
      expect(createAdminContactNote).toHaveBeenCalledWith(CONTACT.id, { content: 'Fresh note' });
    });
    expect(screen.queryByTestId('admin-row-note-draft')).not.toBeInTheDocument();
    expect(screen.getAllByText('Fresh note').length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByTestId('admin-row-note-1'));
    const editor = screen.getByRole('textbox', { name: 'Edit note' });
    expect(editor).toHaveValue('Existing note');
    await user.type(editor, ' edited');
    await user.click(screen.getByRole('button', { name: 'Update note' }));
    await waitFor(() => {
      expect(updateAdminContactNote).toHaveBeenCalledWith(CONTACT.id, 'note-1', {
        content: 'Existing note edited',
      });
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete note' });
    await user.click(deleteButtons[0]!);
    await waitFor(() => {
      expect(deleteAdminContactNote).toHaveBeenCalled();
    });
  });
});
