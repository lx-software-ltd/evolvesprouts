import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { LeadsFilterBar } from '@/components/admin/sales/leads-filter-bar';
import { DEFAULT_LEAD_LIST_FILTERS, FUNNEL_STAGES } from '@/types/leads';
import { formatEnumLabel } from '@/lib/format';

function renderFilterBar(overrides: Partial<ComponentProps<typeof LeadsFilterBar>> = {}) {
  const onFilterChange = vi.fn();
  const view = render(
    <LeadsFilterBar
      filters={DEFAULT_LEAD_LIST_FILTERS}
      users={[{ sub: 'u1', email: 'a@example.com', name: 'Ann' }]}
      onFilterChange={onFilterChange}
      trailing={<button type='button'>New lead</button>}
      {...overrides}
    />
  );
  return { ...view, onFilterChange };
}

describe('LeadsFilterBar', () => {
  it('vertically centers stage chip labels in their color boxes', () => {
    renderFilterBar({ users: [] });

    for (const stage of FUNNEL_STAGES) {
      const chip = screen.getByRole('button', { name: formatEnumLabel(stage) });
      expect(chip.className).toContain('items-center');
      expect(chip.className).toContain('justify-center');
      expect(chip.className).toContain('leading-none');
      expect(chip.className).toContain('h-8');
      expect(chip.className).toContain('py-0');
    }
  });

  it('keeps source, lead type, assignee, and New lead on the filter row', () => {
    renderFilterBar();

    expect(screen.getByTestId('admin-filter-bar')).toBeInTheDocument();
    expect(screen.getByTestId('admin-filter-bar-trailing')).toContainElement(
      screen.getByRole('button', { name: 'New lead' })
    );
    expect(screen.getByRole('group', { name: 'Filter by stage' }).parentElement).toHaveClass('basis-full');

    expect(screen.getByRole('group', { name: 'Filter by stage' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toHaveAttribute('placeholder', 'Search by name or email');
    expect(screen.getByLabelText('Source')).toBeInTheDocument();
    expect(screen.getByLabelText('Lead type')).toBeInTheDocument();
    expect(screen.getByLabelText('Assignee')).toHaveDisplayValue('All assignees');

    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Unassigned only')).not.toBeInTheDocument();
  });

  it('marks the active stage chips with aria-pressed', () => {
    renderFilterBar({
      filters: { ...DEFAULT_LEAD_LIST_FILTERS, stage: ['contacted'] },
      users: [],
    });

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Contacted' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles a stage filter when a chip is clicked', async () => {
    const user = userEvent.setup();
    const { onFilterChange } = renderFilterBar({ users: [] });

    await user.click(screen.getByRole('button', { name: 'Contacted' }));
    expect(onFilterChange).toHaveBeenCalledWith('stage', ['contacted']);

    await user.selectOptions(screen.getByLabelText('Source'), 'referral');
    expect(onFilterChange).toHaveBeenCalledWith('source', ['referral']);
  });
});
