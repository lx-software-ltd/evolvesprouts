import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { LeadsFilterBar } from '@/components/admin/sales/leads-filter-bar';
import { DEFAULT_LEAD_LIST_FILTERS, FUNNEL_STAGES } from '@/types/leads';
import { formatEnumLabel } from '@/lib/format';

function renderFilterBar(overrides: Partial<ComponentProps<typeof LeadsFilterBar>> = {}) {
  const onCreateLead = vi.fn();
  const onFilterChange = vi.fn();
  const view = render(
    <LeadsFilterBar
      filters={DEFAULT_LEAD_LIST_FILTERS}
      users={[{ sub: 'u1', email: 'a@example.com', name: 'Ann' }]}
      onCreateLead={onCreateLead}
      onFilterChange={onFilterChange}
      {...overrides}
    />
  );
  return { ...view, onCreateLead, onFilterChange };
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

    const filterBar = screen.getByTestId('admin-filter-bar');
    expect(filterBar).toBeInTheDocument();

    expect(screen.getByRole('group', { name: 'Filter by stage' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toHaveAttribute('placeholder', 'Search by name or email');
    expect(screen.getByLabelText('Source')).toBeInTheDocument();
    expect(screen.getByLabelText('Lead type')).toBeInTheDocument();
    expect(screen.getByLabelText('Assignee')).toHaveDisplayValue('All assignees');
    expect(screen.getByRole('button', { name: 'New lead' })).toBeInTheDocument();

    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Unassigned only')).not.toBeInTheDocument();

    const filterFields = filterBar.querySelector(':scope > div > div');
    expect(filterFields).toContainElement(screen.getByLabelText('Source'));
    expect(filterFields).toContainElement(screen.getByLabelText('Lead type'));
    expect(filterFields).toContainElement(screen.getByLabelText('Assignee'));
    expect(filterBar).toContainElement(screen.getByRole('button', { name: 'New lead' }));
  });

  it('starts create when New lead is clicked', async () => {
    const user = userEvent.setup();
    const { onCreateLead } = renderFilterBar();

    await user.click(screen.getByRole('button', { name: 'New lead' }));
    expect(onCreateLead).toHaveBeenCalledTimes(1);
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
