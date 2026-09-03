import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listCalendarManualBlocks,
  createCalendarManualBlock,
  updateCalendarManualBlock,
  deleteCalendarManualBlock,
} = vi.hoisted(() => ({
  listCalendarManualBlocks: vi.fn(),
  createCalendarManualBlock: vi.fn(),
  updateCalendarManualBlock: vi.fn(),
  deleteCalendarManualBlock: vi.fn(),
}));

vi.mock('@/lib/calendar-manual-blocks-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/calendar-manual-blocks-api')>();
  return {
    ...actual,
    listCalendarManualBlocks,
    createCalendarManualBlock,
    updateCalendarManualBlock,
    deleteCalendarManualBlock,
  };
});

import { CalendarManualBlocksPage } from '@/components/admin/calendar/calendar-manual-blocks-page';

const existingBlock = { id: 'block-9', block_date: '2026-07-01', period: 'pm', note: 'Team offsite' };

describe('CalendarManualBlocksPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/calendar');
    listCalendarManualBlocks.mockReset();
    createCalendarManualBlock.mockReset();
    updateCalendarManualBlock.mockReset();
    deleteCalendarManualBlock.mockReset();
  });

  it('loads blocks on mount and creates a new block from the draft row', async () => {
    const user = userEvent.setup();
    listCalendarManualBlocks.mockResolvedValue([]);
    createCalendarManualBlock.mockResolvedValue({
      id: 'block-1',
      block_date: '2026-06-15',
      period: 'am',
      note: null,
    });

    render(<CalendarManualBlocksPage />);

    await waitFor(() => {
      expect(listCalendarManualBlocks).toHaveBeenCalled();
      expect(screen.getByText('No manual blocks in this range.')).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'New block' }));
    await user.type(screen.getByLabelText('Date'), '2026-06-15');
    await user.click(screen.getByRole('button', { name: 'Create block' }));

    await waitFor(() => {
      expect(createCalendarManualBlock).toHaveBeenCalledWith(
        expect.objectContaining({ blockDate: '2026-06-15', period: 'am' })
      );
    });
  });

  it('expands a row into the editor and sends only the changed fields', async () => {
    const user = userEvent.setup();
    listCalendarManualBlocks.mockResolvedValue([existingBlock]);
    updateCalendarManualBlock.mockResolvedValue({ ...existingBlock, period: 'both' });

    render(<CalendarManualBlocksPage />);
    await screen.findByRole('cell', { name: /2026-07-01/ });

    await user.click(screen.getByRole('button', { name: 'Expand PM block on 2026-07-01' }));
    expect(await screen.findByLabelText('Date')).toHaveValue('2026-07-01');
    expect(screen.getByLabelText('Note (optional)')).toHaveValue('Team offsite');

    await user.selectOptions(screen.getByLabelText('Period'), 'both');
    await user.click(screen.getByRole('button', { name: 'Update block' }));

    await waitFor(() => {
      expect(updateCalendarManualBlock).toHaveBeenCalledWith('block-9', { period: 'both' });
    });
  });

  it('deletes a block from Operations after confirmation', async () => {
    const user = userEvent.setup();
    listCalendarManualBlocks.mockResolvedValue([existingBlock]);
    deleteCalendarManualBlock.mockResolvedValue(undefined);

    render(<CalendarManualBlocksPage />);
    await screen.findByRole('cell', { name: /2026-07-01/ });

    await user.click(screen.getByRole('button', { name: 'Delete block' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteCalendarManualBlock).toHaveBeenCalledWith('block-9');
    });
  });

  it('does not show the range validation error for a valid default range', async () => {
    listCalendarManualBlocks.mockResolvedValue([]);
    render(<CalendarManualBlocksPage />);

    await waitFor(() => {
      expect(listCalendarManualBlocks).toHaveBeenCalled();
    });

    expect(screen.queryByText(/"To" must be on or after "From"/)).not.toBeInTheDocument();
  });
});
