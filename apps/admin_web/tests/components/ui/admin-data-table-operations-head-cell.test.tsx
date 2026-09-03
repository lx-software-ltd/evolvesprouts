import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AdminDataTableOperationsHeadCell } from '@/components/ui/admin-data-table';

describe('AdminDataTableOperationsHeadCell', () => {
  it('lets font-normal override the default font-semibold via tailwind-merge', () => {
    render(
      <table>
        <thead>
          <tr>
            <AdminDataTableOperationsHeadCell className='font-normal' />
          </tr>
        </thead>
      </table>
    );
    const header = screen.getByRole('columnheader', { name: 'Operations' });
    expect(header.className).toContain('font-normal');
    expect(header.className).not.toContain('font-semibold');
  });

  it('keeps the label for screen readers but hides it visually below md so it never widens the column', () => {
    render(
      <table>
        <thead>
          <tr>
            <AdminDataTableOperationsHeadCell />
          </tr>
        </thead>
      </table>
    );
    const header = screen.getByRole('columnheader', { name: 'Operations' });
    expect(header.querySelector('span')).toHaveClass('sr-only', 'md:not-sr-only');
  });
});
