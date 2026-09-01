import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchLeadAiSuggestion, generateLeadAiSuggestion } = vi.hoisted(() => ({
  fetchLeadAiSuggestion: vi.fn(),
  generateLeadAiSuggestion: vi.fn(),
}));

vi.mock('@/lib/leads-api', () => ({
  fetchLeadAiSuggestion,
  generateLeadAiSuggestion,
}));

import { LeadAiSuggestionPanel } from '@/components/admin/sales/lead-ai-suggestion-panel';

describe('LeadAiSuggestionPanel', () => {
  beforeEach(() => {
    fetchLeadAiSuggestion.mockReset();
    generateLeadAiSuggestion.mockReset();
  });

  it('loads empty state and generates a suggestion on demand', async () => {
    fetchLeadAiSuggestion.mockResolvedValue(null);
    generateLeadAiSuggestion.mockResolvedValue({
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
    expect(generateLeadAiSuggestion).toHaveBeenCalledWith('lead-1');
  });

  it('shows a stale banner when the stored suggestion is outdated', async () => {
    fetchLeadAiSuggestion.mockResolvedValue({
      id: 'sug-2',
      leadId: 'lead-1',
      summary: 'Old advice',
      actions: [],
      followUps: [],
      risks: [],
      generatedAt: '2026-08-01T10:00:00Z',
      generatedBy: null,
      model: null,
      conversationWatermarkAt: null,
      isStale: true,
      staleReasons: ['age', 'new_conversation'],
      staleAfter: '2026-08-02T10:00:00Z',
      latestMessageAt: '2026-09-01T10:00:00Z',
    });

    render(<LeadAiSuggestionPanel leadId='lead-1' />);

    await waitFor(() => {
      expect(screen.getByText(/Suggestion may be stale/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/older than 24 hours/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh suggestion' })).toBeInTheDocument();
  });
});
