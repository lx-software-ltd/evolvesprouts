import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LeadsFilterBar } from '@/components/admin/sales/leads-filter-bar';
import { DEFAULT_LEAD_LIST_FILTERS, FUNNEL_STAGES } from '@/types/leads';
import { formatEnumLabel } from '@/lib/format';

describe('LeadsFilterBar', () => {
  it('vertically centers stage chip labels in their color boxes', () => {
    render(
      <LeadsFilterBar filters={DEFAULT_LEAD_LIST_FILTERS} users={[]} onFilterChange={vi.fn()} />
    );

    for (const stage of FUNNEL_STAGES) {
      const chip = screen.getByRole('button', { name: formatEnumLabel(stage) });
      expect(chip.className).toContain('items-center');
      expect(chip.className).toContain('justify-center');
      expect(chip.className).toContain('leading-none');
      expect(chip.className).toContain('h-8');
      expect(chip.className).toContain('py-0');
    }
  });

  it('renders as a standard admin table toolbar with labelled controls', () => {
    const { container } = render(
      <LeadsFilterBar
        filters={DEFAULT_LEAD_LIST_FILTERS}
        users={[{ sub: 'u1', email: 'a@example.com', name: 'Ann' }]}
        onFilterChange={vi.fn()}
      />
    );

    const toolbar = container.firstElementChild;
    expect(toolbar).toHaveClass('flex', 'flex-wrap', 'items-end', 'gap-3');
    expect(toolbar).not.toHaveClass('border');

    expect(screen.getByRole('group', { name: 'Filter by stage' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toHaveAttribute('placeholder', 'Search by name or email');
    expect(screen.getByLabelText('Source')).toBeInTheDocument();
    expect(screen.getByLabelText('Lead type')).toBeInTheDocument();
    expect(screen.getByLabelText('Assignee')).toHaveDisplayValue('All assignees');
    expect(screen.getByLabelText('From')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('To')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Unassigned only')).not.toBeChecked();
  });

  it('marks the active stage chips with aria-pressed', () => {
    render(
      <LeadsFilterBar
        filters={{ ...DEFAULT_LEAD_LIST_FILTERS, stage: ['contacted'] }}
        users={[]}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Contacted' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles a stage filter when a chip is clicked', async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();

    render(
      <LeadsFilterBar
        filters={DEFAULT_LEAD_LIST_FILTERS}
        users={[]}
        onFilterChange={onFilterChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Contacted' }));
    expect(onFilterChange).toHaveBeenCalledWith('stage', ['contacted']);

    await user.selectOptions(screen.getByLabelText('Source'), 'referral');
    expect(onFilterChange).toHaveBeenCalledWith('source', ['referral']);
  });
});
