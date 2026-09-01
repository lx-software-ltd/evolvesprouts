import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LeadDetailPanel } from '@/components/admin/sales/lead-detail-panel';
import type { LeadDetail } from '@/types/leads';

const LEAD_FIXTURE: LeadDetail = {
  id: 'lead-1',
  contact: {
    id: 'contact-1',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phoneRegion: null,
    phoneNationalNumber: null,
    phoneE164: null,
    instagramHandle: null,
    source: 'manual',
    sourceDetail: null,
    contactType: 'parent',
    relationshipType: 'prospect',
  },
  leadType: 'consultation',
  funnelStage: 'new',
  assignedTo: null,
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
  notes: [
    {
      id: 'note-1',
      content: 'Called the parent.',
      created_by: 'user-1',
      created_at: '2026-03-01T11:00:00Z',
      updated_at: '2026-03-01T11:00:00Z',
    },
  ],
};

function headingGrid(name: string): HTMLElement | null {
  return screen.getByRole('heading', { name }).closest('.grid');
}

describe('LeadDetailPanel', () => {
  it('places stage/quick-action and notes/timeline cards in paired rows', () => {
    render(
      <LeadDetailPanel
        mode='edit'
        lead={LEAD_FIXTURE}
        users={[{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }]}
        isLoading={false}
        error=''
        onStartCreate={vi.fn()}
        onCancelCreate={vi.fn()}
        onCreate={vi.fn()}
        onUpdateStage={vi.fn()}
        onAddNote={vi.fn()}
        onAssign={vi.fn()}
      />
    );

    const stageRow = headingGrid('Stage Control');
    const notesRow = headingGrid('Notes');

    expect(stageRow).toBe(headingGrid('Quick Actions'));
    expect(notesRow).toBe(headingGrid('Activity Timeline'));
    expect(stageRow).not.toBe(notesRow);
    expect(stageRow?.className).toContain('md:grid-cols-2');
    expect(notesRow?.className).toContain('md:grid-cols-2');
  });

  it('shows the create-lead form in create mode', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onCancelCreate = vi.fn();

    render(
      <LeadDetailPanel
        mode='create'
        lead={null}
        users={[{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }]}
        isLoading={false}
        error=''
        onStartCreate={vi.fn()}
        onCancelCreate={onCancelCreate}
        onCreate={onCreate}
        onUpdateStage={vi.fn()}
        onAddNote={vi.fn()}
        onAssign={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Lead' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('First name *')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('First name *'), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Create lead' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'Sam',
        source: 'manual',
        lead_type: 'consultation',
      })
    );
  });

  it('returns to the create form from an existing lead', async () => {
    const user = userEvent.setup();
    const onStartCreate = vi.fn();

    render(
      <LeadDetailPanel
        mode='edit'
        lead={LEAD_FIXTURE}
        users={[{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }]}
        isLoading={false}
        error=''
        onStartCreate={onStartCreate}
        onCancelCreate={vi.fn()}
        onCreate={vi.fn()}
        onUpdateStage={vi.fn()}
        onAddNote={vi.fn()}
        onAssign={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'New lead' }));
    expect(onStartCreate).toHaveBeenCalledTimes(1);
  });
});
