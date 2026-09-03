import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AdminTabStrip } from '@/components/ui/admin-tab-strip';

describe('AdminTabStrip', () => {
  it('renders a button group with aria-pressed on the active view', () => {
    const onChange = vi.fn();
    render(
      <AdminTabStrip
        items={[
          { key: 'a', label: 'Alpha' },
          { key: 'b', label: 'Beta' },
        ]}
        activeKey='a'
        onChange={onChange}
        aria-label='Finance views'
      />
    );
    expect(screen.getByRole('group', { name: 'Finance views' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
