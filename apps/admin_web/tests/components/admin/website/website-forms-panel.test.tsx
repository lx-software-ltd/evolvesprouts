import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebsiteFormsPanel } from '@/components/admin/website/website-forms-panel';

const listAdminForms = vi.fn();
const listAdminFormAnswers = vi.fn();
const exportAdminFormAnswersCsv = vi.fn();
const clearAdminFormAnswers = vi.fn();

vi.mock('@/lib/forms-api', () => ({
  listAdminForms: (...args: unknown[]) => listAdminForms(...args),
  listAdminFormAnswers: (...args: unknown[]) => listAdminFormAnswers(...args),
  exportAdminFormAnswersCsv: (...args: unknown[]) => exportAdminFormAnswersCsv(...args),
  clearAdminFormAnswers: (...args: unknown[]) => clearAdminFormAnswers(...args),
  formatFormAnswerValue: (row: { selectedOption?: string; freeText?: string }) =>
    row.selectedOption ?? row.freeText ?? '—',
}));

vi.mock('@/lib/entity-api', () => ({
  getAdminContact: vi.fn(async (id: string) => ({
    id,
    first_name: 'Jane',
    last_name: 'Doe',
  })),
}));

describe('WebsiteFormsPanel', () => {
  afterEach(() => {
    vi.clearAllMocks();
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
      respondentContactIds: [],
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
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contact')).not.toBeInTheDocument();
  });

  it('shows a respondent dropdown for contact-required forms', async () => {
    const contactId = '11111111-1111-4111-8111-111111111111';
    listAdminForms.mockResolvedValue([{ formSlug: 'pre-session-check-in', answerCount: 1 }]);
    listAdminFormAnswers.mockResolvedValue({
      items: [
        {
          formSlug: 'pre-session-check-in',
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
          questionId: 'name',
          questionType: 'text',
          freeText: 'Alex',
          contactId,
          createdAt: '2026-06-26T10:00:00Z',
          updatedAt: '2026-06-26T10:00:00Z',
        },
      ],
      nextCursor: null,
      respondentContactIds: [contactId],
    });

    render(<WebsiteFormsPanel />);

    const contactSelect = await screen.findByLabelText('Contact');
    expect(contactSelect).toHaveDisplayValue('All contacts');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Jane Doe' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  });

  it('does not render Copy link when no forms are found', async () => {
    listAdminForms.mockResolvedValue([]);
    listAdminFormAnswers.mockResolvedValue({ items: [], nextCursor: null, respondentContactIds: [] });

    render(<WebsiteFormsPanel />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Export answers' })).toBeDisabled();
    });
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  });
});
