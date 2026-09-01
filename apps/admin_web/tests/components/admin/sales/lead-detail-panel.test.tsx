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

describe('LeadDetailPanel', () => {
  beforeEach(() => {
    listAdminContactNotes.mockReset();
    listAdminContactNotes.mockResolvedValue([]);
    listWhatsAppConversations.mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });
    listMetaConversations.mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });
    listWhatsAppMessages.mockResolvedValue({ conversation: {}, items: [] });
    listMetaMessages.mockResolvedValue({ conversation: {}, items: [] });
  });

  it('uses one editor card for create and does not render removed sub-cards', () => {
    render(
      <LeadDetailPanel
        mode='create'
        lead={null}
        users={USERS}
        isLoading={false}
        error=''
        onStartCreate={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Lead' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create lead' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Lead Info' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Stage Control' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Notes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Contact notes' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Initial note')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Quick Actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Activity Timeline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Conversation' })).not.toBeInTheDocument();
  });

  it('hides notes and contact notes until a lead is selected', () => {
    render(
      <LeadDetailPanel
        mode='edit'
        lead={null}
        users={USERS}
        isLoading={false}
        error=''
        onStartCreate={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByText('Select a lead below to edit, or create a new lead.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Notes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Contact notes' })).not.toBeInTheDocument();
    expect(listAdminContactNotes).not.toHaveBeenCalled();
  });

  it('loads the selected lead onto the editor card and keeps activity only', async () => {
    listAdminContactNotes.mockResolvedValueOnce([
      {
        id: 'note-1',
        content: 'Called the parent.',
        created_by: 'user-1',
        created_at: '2026-03-01T11:00:00Z',
        updated_at: '2026-03-01T11:00:00Z',
      },
    ]);

    render(
      <LeadDetailPanel
        mode='edit'
        lead={LEAD_FIXTURE}
        users={USERS}
        isLoading={false}
        error=''
        onStartCreate={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Lead' })).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('Jane');
    expect(screen.getByLabelText('Last name')).toHaveValue('Doe');
    expect(screen.getByLabelText('Email')).toHaveValue('jane@example.com');
    expect(screen.getByLabelText('Instagram')).toHaveValue('kitie.w');
    expect(screen.getByLabelText('Source detail')).toHaveValue('Walk-in');
    expect(screen.getByLabelText('Stage')).toHaveValue('contacted');
    expect(screen.getByLabelText('Assigned to')).toHaveValue('user-1');
    expect(screen.getByRole('button', { name: 'Update lead' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contact notes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notes' }).closest('.grid')).toBe(
      screen.getByRole('heading', { name: 'Contact notes' }).closest('.grid')
    );
    await waitFor(() => {
      expect(screen.getByText('Called the parent.')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Activity Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Lead Info' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Stage Control' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Quick Actions' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Activity Timeline' }).closest('.grid')
    ).toBe(screen.getByRole('heading', { name: 'Conversation' }).closest('.grid'));
  });

  it('hydrates the editor when lead detail arrives after selection', () => {
    const { rerender } = render(
      <LeadDetailPanel
        mode='edit'
        lead={null}
        users={USERS}
        isLoading={true}
        error=''
        onStartCreate={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByText('Loading lead…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Notes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Contact notes' })).not.toBeInTheDocument();

    rerender(
      <LeadDetailPanel
        mode='edit'
        lead={LEAD_FIXTURE}
        users={USERS}
        isLoading={false}
        error=''
        onStartCreate={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByLabelText('First name')).toHaveValue('Jane');
    expect(screen.getByLabelText('Stage')).toHaveValue('contacted');
  });

  it('omits assigned_to on create when the assignee field is untouched', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <LeadDetailPanel
        mode='create'
        lead={null}
        users={USERS}
        isLoading={false}
        error=''
        onStartCreate={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText('First name'), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Create lead' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'Sam',
      })
    );
    expect(onCreate.mock.calls[0][0]).not.toHaveProperty('assigned_to');
  });

  it('sends the prefilled default assignee when the user does not change it', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <LeadDetailPanel
        mode='create'
        lead={null}
        users={USERS}
        defaultAssignedTo='user-1'
        isLoading={false}
        error=''
        onStartCreate={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText('First name'), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Create lead' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'Sam',
        assigned_to: 'user-1',
      })
    );
  });

  it('prefills create assignee from defaultAssignedTo until the user changes it', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <LeadDetailPanel
        mode='create'
        lead={null}
        users={USERS}
        defaultAssignedTo='user-1'
        isLoading={false}
        error=''
        onStartCreate={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Assigned to')).toHaveValue('user-1');

    await user.selectOptions(screen.getByLabelText('Assigned to'), '');
    await user.type(screen.getByLabelText('First name'), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Create lead' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'Sam',
        assigned_to: null,
      })
    );
  });

  it('submits create from the lead card', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <LeadDetailPanel
        mode='create'
        lead={null}
        users={USERS}
        isLoading={false}
        error=''
        onStartCreate={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText('First name'), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Create lead' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'Sam',
        lead_type: 'consultation',
        source: 'manual',
      })
    );
  });

  it('submits update from the loaded lead card', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    render(
      <LeadDetailPanel
        mode='edit'
        lead={LEAD_FIXTURE}
        users={USERS}
        isLoading={false}
        error=''
        onStartCreate={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
      />
    );

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
});
