import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LeadsBulkActions } from '@/components/admin/sales/leads-bulk-actions';

describe('LeadsBulkActions', () => {
  it('requires confirmation before bulk assign', async () => {
    const user = userEvent.setup();
    const onBulkAssign = vi.fn();

    render(
      <LeadsBulkActions
        selectedCount={2}
        users={[{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }]}
        onBulkAssign={onBulkAssign}
        onBulkStageChange={vi.fn()}
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
        users={[{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }]}
        onBulkAssign={vi.fn()}
        onBulkStageChange={vi.fn()}
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
        users={[{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }]}
        onBulkAssign={vi.fn()}
        onBulkStageChange={onBulkStageChange}
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
});
