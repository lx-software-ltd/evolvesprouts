import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SalesConfigurationView } from '@/components/admin/sales/sales-configuration-view';

const USERS = [{ sub: 'user-1', name: 'Alex', email: 'alex@example.com' }];

const MEMORY_PROPS = {
  onResetMemory: vi.fn().mockResolvedValue(undefined),
  isResettingMemory: false,
  resetError: '',
};

describe('SalesConfigurationView', () => {
  it('saves the default assignee and notify toggle', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <SalesConfigurationView
        users={USERS}
        settings={{
          default_assigned_to: null,
          notify_assignee_on_assignment: false,
          helper_detector_enabled: false,
        }}
        isLoading={false}
        isSaving={false}
        error=''
        onSave={onSave}
        {...MEMORY_PROPS}
      />
    );

    expect(screen.getByText(/scheduled 6:00 HKT insight/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Default assignee'), 'user-1');
    await user.click(
      screen.getByLabelText('Email the assignee when a lead is assigned to them')
    );
    await user.click(screen.getByLabelText('Helper Detector'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      default_assigned_to: 'user-1',
      notify_assignee_on_assignment: true,
      helper_detector_enabled: true,
    });
  });

  it('keeps a leftover option when the saved assignee is no longer in the user list', () => {
    render(
      <SalesConfigurationView
        users={USERS}
        settings={{
          default_assigned_to: 'stale-sub',
          notify_assignee_on_assignment: true,
          helper_detector_enabled: false,
        }}
        isLoading={false}
        isSaving={false}
        error=''
        onSave={vi.fn()}
        {...MEMORY_PROPS}
      />
    );

    expect(screen.getByLabelText('Default assignee')).toHaveValue('stale-sub');
    expect(screen.getByRole('option', { name: 'stale-sub' })).toBeInTheDocument();
  });

  it('confirms before resetting sale plan memory', async () => {
    const user = userEvent.setup();
    const onResetMemory = vi.fn().mockResolvedValue(undefined);

    render(
      <SalesConfigurationView
        users={USERS}
        settings={{
          default_assigned_to: null,
          notify_assignee_on_assignment: false,
          helper_detector_enabled: false,
        }}
        isLoading={false}
        isSaving={false}
        error=''
        onSave={vi.fn()}
        onResetMemory={onResetMemory}
        isResettingMemory={false}
        resetError=''
      />
    );

    await user.click(screen.getByRole('button', { name: 'Reset sale plan memory' }));
    expect(
      screen.getByText(/permanently deletes every saved sale plan insight/i)
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset memory' }));
    expect(onResetMemory).toHaveBeenCalledTimes(1);
  });
});
