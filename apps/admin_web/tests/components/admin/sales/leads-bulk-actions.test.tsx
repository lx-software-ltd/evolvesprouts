import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LeadsBulkActions } from '@/components/admin/sales/leads-bulk-actions';
import type { LeadSummary } from '@/types/leads';

const sampleLeads: LeadSummary[] = [
  {
    id: 'lead-1',
    contact: {
      id: 'contact-1',
      firstName: 'Alex',
      lastName: 'One',
      email: 'alex@example.com',
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
    createdAt: null,
    updatedAt: null,
    convertedAt: null,
    lostAt: null,
    lostReason: null,
    daysInStage: 0,
    lastActivityAt: null,
    noteCount: 0,
    tags: [],
  },
  {
    id: 'lead-2',
    contact: {
      id: 'contact-2',
      firstName: 'Blake',
      lastName: 'Two',
      email: 'blake@example.com',
      phoneRegion: null,
      phoneNationalNumber: null,
      phoneE164: null,
      instagramHandle: null,
      source: 'manual',
      sourceDetail: null,
      contactType: 'parent',
      relationshipType: 'prospect',
    },
    leadType: 'other',
    funnelStage: 'contacted',
    assignedTo: null,
    createdAt: null,
    updatedAt: null,
    convertedAt: null,
    lostAt: null,
    lostReason: null,
    daysInStage: 1,
    lastActivityAt: null,
    noteCount: 0,
    tags: [],
  },
];

describe('LeadsBulkActions', () => {
  it('requires confirmation before bulk assign', async () => {
    const user = userEvent.setup();
    const onBulkAssign = vi.fn();

    render(
      <LeadsBulkActions
        selectedCount={2}
        selectedLeads={sampleLeads}
        users={[{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }]}
        onBulkAssign={onBulkAssign}
        onBulkStageChange={vi.fn()}
        onBulkMerge={vi.fn()}
      />
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Bulk assign assignee' }), 'user-1');

    expect(onBulkAssign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm assign' }));

    expect(onBulkAssign).toHaveBeenCalledWith('user-1');
  });

  it('resets staged assignee when cancel is clicked', async () => {
    const user = userEvent.setup();

    render(
      <LeadsBulkActions
        selectedCount={1}
        selectedLeads={[sampleLeads[0]!]}
        users={[{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }]}
        onBulkAssign={vi.fn()}
        onBulkStageChange={vi.fn()}
        onBulkMerge={vi.fn()}
      />
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Bulk assign assignee' }), 'user-1');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('button', { name: 'Confirm assign' })).not.toBeInTheDocument();
  });

  it('requires a lost reason select before confirming bulk lost stage', async () => {
    const user = userEvent.setup();
    const onBulkStageChange = vi.fn();

    render(
      <LeadsBulkActions
        selectedCount={2}
        selectedLeads={sampleLeads}
        users={[{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }]}
        onBulkAssign={vi.fn()}
        onBulkStageChange={onBulkStageChange}
        onBulkMerge={vi.fn()}
      />
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Bulk set stage' }), 'lost');
    expect(onBulkStageChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm lost stage' })).toBeDisabled();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Bulk lost reason' }),
      'price_too_high'
    );
    await user.click(screen.getByRole('button', { name: 'Confirm lost stage' }));

    expect(onBulkStageChange).toHaveBeenCalledWith('lost', 'price_too_high');
  });

  it('places merge leads before assign dropdown with white background', () => {
    render(
      <LeadsBulkActions
        selectedCount={2}
        selectedLeads={sampleLeads}
        users={[{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }]}
        onBulkAssign={vi.fn()}
        onBulkStageChange={vi.fn()}
        onBulkMerge={vi.fn()}
      />
    );

    const toolbar = screen.getByTestId('leads-bulk-actions');
    const controls = toolbar.querySelector('.flex.flex-col.gap-2');
    expect(controls).not.toBeNull();

    const mergeButton = screen.getByRole('button', { name: 'Merge leads' });
    const assignSelect = screen.getByRole('combobox', { name: 'Bulk assign assignee' });
    const stageSelect = screen.getByRole('combobox', { name: 'Bulk set stage' });
    const selectGrid = assignSelect.closest('.grid');

    expect(mergeButton).toHaveClass('bg-white');
    expect(mergeButton).toHaveClass('shrink-0');
    expect(mergeButton).toHaveClass('whitespace-nowrap');
    expect(assignSelect).toHaveClass('sm:w-40');
    expect(stageSelect).toHaveClass('sm:w-40');
    expect(selectGrid).toHaveClass('shrink-0');
    expect(controls!.children[0]).toBe(mergeButton);
    expect(controls!.children[1]).toBe(selectGrid);
  });

  it('merges selected leads after choosing a keeper', async () => {
    const user = userEvent.setup();
    const onBulkMerge = vi.fn();

    render(
      <LeadsBulkActions
        selectedCount={2}
        selectedLeads={sampleLeads}
        users={[{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }]}
        onBulkAssign={vi.fn()}
        onBulkStageChange={vi.fn()}
        onBulkMerge={onBulkMerge}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Merge leads' }));
    await user.click(screen.getByRole('radio', { name: /Blake Two/i }));
    const confirmMerge = screen.getAllByRole('button', { name: 'Merge leads' })[1];
    await user.click(confirmMerge!);

    expect(onBulkMerge).toHaveBeenCalledWith(['lead-1', 'lead-2'], 'lead-2');
  });
});
