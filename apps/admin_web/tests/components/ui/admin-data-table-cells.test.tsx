import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  AdminDataTableCell,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';

describe('AdminDataTableHeadCell', () => {
  it('applies standard padding and font-semibold', () => {
    render(
      <table>
        <thead>
          <tr>
            <AdminDataTableHeadCell>Label</AdminDataTableHeadCell>
          </tr>
        </thead>
      </table>
    );
    const cell = screen.getByRole('columnheader', { name: 'Label' });
    expect(cell.className).toContain('px-4');
    expect(cell.className).toContain('py-3');
    expect(cell.className).toContain('font-semibold');
  });

  it('merges text-right over default text-left', () => {
    render(
      <table>
        <thead>
          <tr>
            <AdminDataTableHeadCell className='text-right'>Amount</AdminDataTableHeadCell>
          </tr>
        </thead>
      </table>
    );
    const cell = screen.getByRole('columnheader', { name: 'Amount' });
    expect(cell.className).toContain('text-right');
    expect(cell.className).not.toContain('text-left');
  });
});

describe('AdminDataTableCell', () => {
  it('applies standard padding', () => {
    render(
      <table>
        <tbody>
          <tr>
            <AdminDataTableCell>Value</AdminDataTableCell>
          </tr>
        </tbody>
      </table>
    );
    const cell = screen.getByRole('cell', { name: 'Value' });
    expect(cell.className).toContain('px-4');
    expect(cell.className).toContain('py-3');
  });

  it('lets long tokens break below md so one value never widens the table on a phone', () => {
    render(
      <table>
        <thead>
          <tr>
            <AdminDataTableHeadCell>Table</AdminDataTableHeadCell>
          </tr>
        </thead>
        <tbody>
          <tr>
            <AdminDataTableCell>service_instance_participants</AdminDataTableCell>
          </tr>
        </tbody>
      </table>
    );
    expect(screen.getByRole('columnheader', { name: 'Table' }).className).toContain('max-md:wrap-anywhere');
    expect(screen.getByRole('cell', { name: 'service_instance_participants' }).className).toContain(
      'max-md:wrap-anywhere'
    );
  });
});

describe('AdminDataTableOperationsHeadCell', () => {
  it('keeps font-semibold when className does not override weight', () => {
    render(
      <table>
        <thead>
          <tr>
            <AdminDataTableOperationsHeadCell className='w-[7rem] whitespace-nowrap' />
          </tr>
        </thead>
      </table>
    );
    const cell = screen.getByRole('columnheader', { name: 'Operations' });
    expect(cell.className).toContain('font-semibold');
    expect(cell.className).toContain('text-right');
    expect(cell.className).toContain('px-4');
    expect(cell.className).toContain('py-3');
  });
});
