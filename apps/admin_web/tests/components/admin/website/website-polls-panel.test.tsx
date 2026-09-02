import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebsitePollsPanel } from '@/components/admin/website/website-polls-panel';

const listAdminPolls = vi.fn();
const listAdminPollAnswers = vi.fn();
const exportAdminPollAnswersCsv = vi.fn();
const clearAdminPollAnswers = vi.fn();

vi.mock('@/lib/polls-api', () => ({
  listAdminPolls: (...args: unknown[]) => listAdminPolls(...args),
  listAdminPollAnswers: (...args: unknown[]) => listAdminPollAnswers(...args),
  exportAdminPollAnswersCsv: (...args: unknown[]) => exportAdminPollAnswersCsv(...args),
  clearAdminPollAnswers: (...args: unknown[]) => clearAdminPollAnswers(...args),
  formatPollAnswerValue: (row: { selectedOption?: string; booleanAnswer?: boolean; freeText?: string }) =>
    row.selectedOption ?? (row.booleanAnswer ? 'True' : row.freeText ?? '—'),
}));

describe('WebsitePollsPanel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads polls and answers for the selected poll', async () => {
    listAdminPolls.mockResolvedValue([
      { pollSlug: 'workshop-food-jun-26', answerCount: 1 },
    ]);
    listAdminPollAnswers.mockResolvedValue({
      items: [
        {
          pollSlug: 'workshop-food-jun-26',
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
          questionId: 'role',
          questionType: 'select',
          selectedOption: 'Parent',
          createdAt: '2026-06-26T10:00:00Z',
          updatedAt: '2026-06-26T10:00:00Z',
        },
      ],
      nextCursor: null,
    });

    render(<WebsitePollsPanel />);

    await waitFor(() => {
      expect(listAdminPollAnswers).toHaveBeenCalledWith(
        'workshop-food-jun-26',
        expect.objectContaining({
          cursor: null,
          limit: 25,
          signal: expect.any(AbortSignal),
        })
      );
    });

    expect(screen.getByText('Parent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export answers' })).toBeEnabled();
  });

  it('exports answers as CSV', async () => {
    listAdminPolls.mockResolvedValue([
      { pollSlug: 'workshop-food-jun-26', answerCount: 1 },
    ]);
    listAdminPollAnswers.mockResolvedValue({ items: [], nextCursor: null });
    exportAdminPollAnswersCsv.mockResolvedValue(new Blob(['csv'], { type: 'text/csv' }));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    render(<WebsitePollsPanel />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Export answers' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export answers' }));

    await waitFor(() => {
      expect(exportAdminPollAnswersCsv).toHaveBeenCalledWith('workshop-food-jun-26');
    });

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('clears answers after confirmation', async () => {
    listAdminPolls.mockResolvedValue([
      { pollSlug: 'workshop-food-jun-26', answerCount: 1 },
    ]);
    listAdminPollAnswers.mockResolvedValue({
      items: [
        {
          pollSlug: 'workshop-food-jun-26',
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
          questionId: 'role',
          questionType: 'select',
          selectedOption: 'Parent',
          createdAt: '2026-06-26T10:00:00Z',
          updatedAt: '2026-06-26T10:00:00Z',
        },
      ],
      nextCursor: null,
    });
    clearAdminPollAnswers.mockResolvedValue({ pollSlug: 'workshop-food-jun-26', deletedCount: 1 });

    render(<WebsitePollsPanel />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Clear answers' })).toBeEnabled();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear answers' })[0]);
    const dialog = screen.getByRole('alertdialog', { name: 'Clear poll answers' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear answers' }));

    await waitFor(() => {
      expect(clearAdminPollAnswers).toHaveBeenCalledWith('workshop-food-jun-26');
    });
  });
});
