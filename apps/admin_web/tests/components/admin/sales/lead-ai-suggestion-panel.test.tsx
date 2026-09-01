import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchLeadAiSuggestion,
  enqueueLeadAiSuggestionJob,
  pollLeadAiSuggestionJob,
} = vi.hoisted(() => ({
  fetchLeadAiSuggestion: vi.fn(),
  enqueueLeadAiSuggestionJob: vi.fn(),
  pollLeadAiSuggestionJob: vi.fn(),
}));

vi.mock('@/lib/leads-api', () => ({
  fetchLeadAiSuggestion,
  enqueueLeadAiSuggestionJob,
  pollLeadAiSuggestionJob,
}));

import { LeadAiSuggestionPanel } from '@/components/admin/sales/lead-ai-suggestion-panel';

const sampleSuggestion = {
  id: 'sug-1',
  leadId: 'lead-1',
  summary: 'Book a consult this week.',
  actions: ['Offer two time slots'],
  followUps: [
    {
      channel: 'whatsapp',
      messageExcerpt: 'Is this for helpers?',
      draftReply: 'Yes — My Best Auntie is helper training focused on ages 0–6.',
      rationale: 'Answer the inbound question directly.',
    },
  ],
  risks: ['Do not invent pricing'],
  generatedAt: '2026-09-01T10:00:00Z',
  generatedBy: 'user-1',
  model: 'test-model',
  conversationWatermarkAt: '2026-09-01T09:00:00Z',
  isStale: false,
  staleReasons: [],
  staleAfter: '2026-09-02T10:00:00Z',
  latestMessageAt: '2026-09-01T09:00:00Z',
};

describe('LeadAiSuggestionPanel', () => {
  beforeEach(() => {
    fetchLeadAiSuggestion.mockReset();
    enqueueLeadAiSuggestionJob.mockReset();
    pollLeadAiSuggestionJob.mockReset();
  });

  it('loads empty state and generates a suggestion on demand', async () => {
    fetchLeadAiSuggestion.mockResolvedValue(null);
    enqueueLeadAiSuggestionJob.mockResolvedValue({
      id: 'job-1',
      leadId: 'lead-1',
      status: 'pending',
      errorMessage: null,
      suggestionId: null,
      createdAt: '2026-09-01T10:00:00Z',
      startedAt: null,
      finishedAt: null,
      updatedAt: '2026-09-01T10:00:00Z',
      queueWaitMs: null,
      durationMs: null,
      suggestion: null,
    });
    pollLeadAiSuggestionJob.mockResolvedValue({
      id: 'job-1',
      leadId: 'lead-1',
      status: 'succeeded',
      errorMessage: null,
      suggestionId: 'sug-1',
      createdAt: '2026-09-01T10:00:00Z',
      startedAt: '2026-09-01T10:00:01Z',
      finishedAt: '2026-09-01T10:00:08Z',
      updatedAt: '2026-09-01T10:00:08Z',
      queueWaitMs: 1000,
      durationMs: 7000,
      suggestion: sampleSuggestion,
    });

    const user = userEvent.setup();
    render(<LeadAiSuggestionPanel leadId='lead-1' />);

    await waitFor(() => {
      expect(screen.getByText(/No suggestion yet/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Generate suggestion' }));

    await waitFor(() => {
      expect(screen.getByText('Book a consult this week.')).toBeInTheDocument();
    });
    expect(screen.getByText('Offer two time slots')).toBeInTheDocument();
    expect(screen.getByText(/Is this for helpers?/)).toBeInTheDocument();
    expect(screen.getByText(/Last run: queue 1\.0 s · model 7\.0 s/i)).toBeInTheDocument();
    expect(enqueueLeadAiSuggestionJob).toHaveBeenCalledWith('lead-1');
    expect(pollLeadAiSuggestionJob).toHaveBeenCalledWith('lead-1', 'job-1', expect.any(AbortSignal));
  });

  it('shows a stale banner when the stored suggestion is outdated', async () => {
    fetchLeadAiSuggestion.mockResolvedValue({
      ...sampleSuggestion,
      id: 'sug-2',
      summary: 'Old advice',
      actions: [],
      followUps: [],
      risks: [],
      isStale: true,
      staleReasons: ['age', 'new_conversation'],
    });

    render(<LeadAiSuggestionPanel leadId='lead-1' />);

    await waitFor(() => {
      expect(screen.getByText(/Suggestion may be stale/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/older than 24 hours/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh suggestion' })).toBeInTheDocument();
  });
});
