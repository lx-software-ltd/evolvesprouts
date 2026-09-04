import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listAdminContactNotes,
  listWhatsAppConversations,
  listMetaConversations,
  listWhatsAppMessages,
  listMetaMessages,
} = vi.hoisted(() => ({
  listAdminContactNotes: vi.fn().mockResolvedValue([]),
  listWhatsAppConversations: vi.fn().mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 }),
  listMetaConversations: vi.fn().mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 }),
  listWhatsAppMessages: vi.fn().mockResolvedValue({ conversation: {}, items: [] }),
  listMetaMessages: vi.fn().mockResolvedValue({ conversation: {}, items: [] }),
}));

vi.mock('@/lib/entity-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/entity-api')>();
  return {
    ...actual,
    listAdminContactNotes,
  };
});

vi.mock('@/lib/whatsapp-api', () => ({
  listWhatsAppConversations,
  listWhatsAppMessages,
}));

vi.mock('@/lib/meta-api', () => ({
  listMetaConversations,
  listMetaMessages,
}));

import { LeadDetailPanel } from '@/components/admin/sales/lead-detail-panel';
import type { LeadDetail } from '@/types/leads';

const LEAD_FIXTURE: LeadDetail = {
  id: 'lead-1',
  contact: {
    id: 'contact-1',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phoneRegion: 'HK',
    phoneNationalNumber: '12345678',
    phoneE164: '+85212345678',
    instagramHandle: 'kitie.w',
    source: 'manual',
    sourceDetail: 'Walk-in',
    contactType: 'parent',
    relationshipType: 'prospect',
  },
  leadType: 'consultation',
  funnelStage: 'contacted',
  assignedTo: 'user-1',
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-01T10:00:00Z',
  convertedAt: null,
  lostAt: null,
  lostReason: null,
  daysInStage: 4,
  lastActivityAt: '2026-03-02T10:00:00Z',
  noteCount: 2,
  tags: [],
  family: null,
  organization: null,
  events: [
    {
      id: 'event-1',
      eventType: 'created',
      fromStage: null,
      toStage: 'new',
      metadata: null,
      createdBy: 'user-1',
      createdAt: '2026-03-01T10:00:00Z',
    },
  ],
  notes: [],
};

const USERS = [{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }];

const baseProps = {
  users: USERS,
  isSaving: false,
  error: '',
  onCreate: vi.fn(),
  onUpdate: vi.fn(),
};

describe('LeadDetailPanel', () => {
  beforeEach(() => {
    listAdminContactNotes.mockReset();
    listAdminContactNotes.mockResolvedValue([]);
    listWhatsAppConversations.mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });
    listMetaConversations.mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });
    listWhatsAppMessages.mockResolvedValue({ conversation: {}, items: [] });
    listMetaMessages.mockResolvedValue({ conversation: {}, items: [] });
  });

  it('renders the create editor without a title, Cancel, or edit-only disclosures', () => {
    render(<LeadDetailPanel {...baseProps} mode='create' lead={null} />);

    expect(screen.getByTestId('admin-editor-panel')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Lead' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create lead' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stage')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lead-notes-disclosure')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lead-ai-suggestion-disclosure')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lead-activity-disclosure')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lead-conversation-disclosure')).not.toBeInTheDocument();
    expect(listAdminContactNotes).not.toHaveBeenCalled();
  });

  it('lays the fields out in four-column grids', () => {
    render(<LeadDetailPanel {...baseProps} mode='edit' lead={LEAD_FIXTURE} />);

    const firstName = screen.getByLabelText(/^First name/);
    expect(firstName.closest('[data-columns]')).toHaveAttribute('data-columns', '4');
    expect(screen.getByLabelText('Source detail').parentElement).toHaveClass('sm:col-span-2');
  });

  it('seeds the edit form from the lead and lazily mounts the disclosures', async () => {
    const user = userEvent.setup();
    listAdminContactNotes.mockResolvedValueOnce([
      {
        id: 'note-1',
        content: 'Called the parent.',
        created_by: 'user-1',
        created_at: '2026-03-01T11:00:00Z',
        updated_at: '2026-03-01T11:00:00Z',
      },
    ]);

    render(<LeadDetailPanel {...baseProps} mode='edit' lead={LEAD_FIXTURE} detail={LEAD_FIXTURE} />);

    expect(screen.getByLabelText(/^First name/)).toHaveValue('Jane');
    expect(screen.getByLabelText('Last name')).toHaveValue('Doe');
    expect(screen.getByLabelText('Email')).toHaveValue('jane@example.com');
    expect(screen.getByLabelText('Instagram')).toHaveValue('kitie.w');
    expect(screen.getByLabelText('Source detail')).toHaveValue('Walk-in');
    expect(screen.getByLabelText('Stage')).toHaveValue('contacted');
    expect(screen.getByLabelText('Assigned to')).toHaveValue('user-1');
    expect(screen.getByLabelText('Lead type')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update lead' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

    expect(screen.getByTestId('lead-notes-disclosure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Notes/ })).toHaveTextContent('2');
    expect(screen.getByTestId('lead-ai-suggestion-disclosure')).toBeInTheDocument();
    expect(screen.getByTestId('lead-activity-disclosure')).toBeInTheDocument();
    expect(screen.getByTestId('lead-conversation-disclosure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Activity/ })).toHaveTextContent('1');
    // Notes are fetched only once the operator opens the disclosure.
    expect(listAdminContactNotes).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Notes' }));
    await waitFor(() => {
      expect(screen.getByText('Called the parent.')).toBeInTheDocument();
    });
    expect(listAdminContactNotes).toHaveBeenCalledWith('contact-1', expect.anything());

    await user.click(screen.getByRole('button', { name: /Activity/ }));
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('shows the activity loading state until the detail arrives', () => {
    render(<LeadDetailPanel {...baseProps} mode='edit' lead={LEAD_FIXTURE} detail={null} isDetailLoading />);

    expect(screen.getByRole('button', { name: /Activity/ })).toHaveTextContent('Loading…');
    expect(screen.getByLabelText(/^First name/)).toHaveValue('Jane');
  });

  it('reports dirty state to the row hook and clears it on unmount', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const { unmount } = render(
      <LeadDetailPanel {...baseProps} mode='create' lead={null} onDirtyChange={onDirtyChange} />
    );

    await user.type(screen.getByLabelText(/^First name/), 'S');
    expect(onDirtyChange).toHaveBeenCalledWith(true);

    unmount();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('omits assigned_to on create when the assignee field is untouched', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(<LeadDetailPanel {...baseProps} mode='create' lead={null} onCreate={onCreate} />);

    await user.type(screen.getByLabelText(/^First name/), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Create lead' }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ first_name: 'Sam' }));
    expect(onCreate.mock.calls[0][0]).not.toHaveProperty('assigned_to');
  });

  it('sends the prefilled default assignee when the user does not change it', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <LeadDetailPanel {...baseProps} mode='create' lead={null} defaultAssignedTo='user-1' onCreate={onCreate} />
    );

    await user.type(screen.getByLabelText(/^First name/), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Create lead' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ first_name: 'Sam', assigned_to: 'user-1' })
    );
  });

  it('prefills create assignee from defaultAssignedTo until the user changes it', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <LeadDetailPanel {...baseProps} mode='create' lead={null} defaultAssignedTo='user-1' onCreate={onCreate} />
    );

    expect(screen.getByLabelText('Assigned to')).toHaveValue('user-1');

    await user.selectOptions(screen.getByLabelText('Assigned to'), '');
    await user.type(screen.getByLabelText(/^First name/), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Create lead' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ first_name: 'Sam', assigned_to: null })
    );
  });

  it('submits create with the default lead type and source', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(<LeadDetailPanel {...baseProps} mode='create' lead={null} onCreate={onCreate} />);

    await user.type(screen.getByLabelText(/^First name/), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Create lead' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ first_name: 'Sam', lead_type: 'consultation', source: 'manual' })
    );
  });

  it('shows Saving… with a spinner while the create call is in flight', () => {
    render(<LeadDetailPanel {...baseProps} mode='create' lead={null} isSaving />);

    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('submits update from the loaded lead editor', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    render(<LeadDetailPanel {...baseProps} mode='edit' lead={LEAD_FIXTURE} onUpdate={onUpdate} />);

    await user.selectOptions(screen.getByLabelText('Stage'), 'engaged');
    await user.click(screen.getByRole('button', { name: 'Update lead' }));

    expect(onUpdate).toHaveBeenCalledWith({
      funnel_stage: 'engaged',
      assigned_to: 'user-1',
      lost_reason: null,
      contact: expect.objectContaining({
        id: 'contact-1',
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
        phone_region: 'HK',
        phone_number: '12345678',
        instagram_handle: 'kitie.w',
        source: 'manual',
        source_detail: 'Walk-in',
        contact_type: 'parent',
      }),
    });
  });

  it('requires a lost reason select when marking a lead lost', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    render(<LeadDetailPanel {...baseProps} mode='edit' lead={LEAD_FIXTURE} onUpdate={onUpdate} />);

    await user.selectOptions(screen.getByLabelText('Stage'), 'lost');
    expect(screen.getByLabelText(/^Lost reason/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update lead' })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/^Lost reason/), 'ghosted');
    await user.click(screen.getByRole('button', { name: 'Update lead' }));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ funnel_stage: 'lost', lost_reason: 'ghosted' })
    );
  });
});
