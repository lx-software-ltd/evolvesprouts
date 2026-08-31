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
  });
});
