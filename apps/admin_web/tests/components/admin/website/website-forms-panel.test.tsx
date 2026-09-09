import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebsiteFormsPanel } from '@/components/admin/website/website-forms-panel';

const listAdminForms = vi.fn();
const listAdminFormAnswers = vi.fn();
const exportAdminFormAnswersCsv = vi.fn();
const clearAdminFormAnswers = vi.fn();
const getTrainingSiteBaseUrl = vi.fn(() => 'https://training.example.com');

vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>();
  return {
    ...actual,
    getTrainingSiteBaseUrl: () => getTrainingSiteBaseUrl(),
  };
});

vi.mock('@/lib/forms-api', () => ({
  listAdminForms: (...args: unknown[]) => listAdminForms(...args),
  listAdminFormAnswers: (...args: unknown[]) => listAdminFormAnswers(...args),
  exportAdminFormAnswersCsv: (...args: unknown[]) => exportAdminFormAnswersCsv(...args),
  clearAdminFormAnswers: (...args: unknown[]) => clearAdminFormAnswers(...args),
  formatFormAnswerValue: (row: { selectedOption?: string; freeText?: string }) =>
    row.selectedOption ?? row.freeText ?? '—',
}));

describe('WebsiteFormsPanel', () => {
  afterEach(() => {
    vi.clearAllMocks();
    getTrainingSiteBaseUrl.mockReturnValue('https://training.example.com');
  });

  it('loads forms and answers for the selected form', async () => {
    listAdminForms.mockResolvedValue([{ formSlug: 'workshop-feedback', answerCount: 1 }]);
    listAdminFormAnswers.mockResolvedValue({
      items: [
        {
          formSlug: 'workshop-feedback',
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
          questionId: 'name',
          questionType: 'text',
          freeText: 'Alex',
          createdAt: '2026-06-26T10:00:00Z',
          updatedAt: '2026-06-26T10:00:00Z',
        },
      ],
      nextCursor: null,
    });

    render(<WebsiteFormsPanel />);

    await waitFor(() => {
      expect(listAdminFormAnswers).toHaveBeenCalledWith(
        'workshop-feedback',
        expect.objectContaining({
          cursor: null,
          limit: 25,
          signal: expect.any(AbortSignal),
        })
      );
    });

    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export answers' })).toBeEnabled();
  });

  it('copies the selected form page link and shows green Link copied feedback', async () => {
    listAdminForms.mockResolvedValue([{ formSlug: 'workshop-feedback', answerCount: 1 }]);
    listAdminFormAnswers.mockResolvedValue({ items: [], nextCursor: null });
    const writeText = vi.mocked(navigator.clipboard.writeText);
    writeText.mockResolvedValue(undefined);

    render(<WebsiteFormsPanel />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy link' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://training.example.com/forms/workshop-feedback/');
    });
    const copiedButton = screen.getByRole('button', { name: 'Link copied' });
    expect(copiedButton).toBeInTheDocument();
    expect(copiedButton).toHaveClass('bg-emerald-600');
  });

  it('shows an action error when clipboard copy fails', async () => {
    listAdminForms.mockResolvedValue([{ formSlug: 'workshop-feedback', answerCount: 1 }]);
    listAdminFormAnswers.mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('Clipboard denied'));

    render(<WebsiteFormsPanel />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy link' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => {
      expect(screen.getByText('Clipboard denied')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('disables Copy link when no forms are found', async () => {
    listAdminForms.mockResolvedValue([]);
    listAdminFormAnswers.mockResolvedValue({ items: [], nextCursor: null });

    render(<WebsiteFormsPanel />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy link' })).toBeDisabled();
    });
  });
});
