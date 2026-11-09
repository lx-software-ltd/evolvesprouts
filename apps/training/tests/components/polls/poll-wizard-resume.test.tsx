import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PollWizard } from '@/components/polls/poll-wizard';
import { getPollContent, POLLS_COMMON } from '@/lib/polls';
import * as pollsApi from '@/lib/polls-api';

describe('PollWizard resume and completion', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it('shows stay tuned copy when more poll questions can be unlocked', async () => {
    const poll = getPollContent('workshop-food-jun-26');
    if (!poll) {
      throw new Error('expected poll fixture');
    }

    vi.spyOn(pollsApi, 'fetchPollControlState').mockResolvedValue({
      pollSlug: poll.slug,
      enabledQuestionIds: ['role'],
    });
    vi.spyOn(pollsApi, 'fetchPollSessionAnswers').mockResolvedValue({
      pollSlug: poll.slug,
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [
        {
          questionId: 'role',
          questionType: 'select',
          selectedOption: 'Parent',
        },
      ],
    });
    vi.spyOn(pollsApi, 'persistPollAnswer').mockResolvedValue();

    render(<PollWizard poll={poll} common={POLLS_COMMON} />);

    await waitFor(() => {
      expect(screen.getByText('Thank you')).toBeInTheDocument();
    });
    expect(screen.getByText('Your responses have been saved.')).toBeInTheDocument();
    expect(screen.getByText('Stay tuned for more questions!')).toBeInTheDocument();
  });

  it('returns to the wizard when control enables another question after thank you', async () => {
    const poll = getPollContent('workshop-food-jun-26');
    if (!poll) {
      throw new Error('expected poll fixture');
    }

    let fetchCount = 0;
    vi.spyOn(pollsApi, 'fetchPollControlState').mockImplementation(async () => {
      fetchCount += 1;
      return {
        pollSlug: poll.slug,
        enabledQuestionIds:
          fetchCount === 1 ? ['role'] : ['role', 'challenge'],
      };
    });
    vi.spyOn(pollsApi, 'fetchPollSessionAnswers').mockResolvedValue({
      pollSlug: poll.slug,
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [
        {
          questionId: 'role',
          questionType: 'select',
          selectedOption: 'Parent',
        },
      ],
    });
    vi.spyOn(pollsApi, 'persistPollAnswer').mockResolvedValue();

    vi.useFakeTimers();
    render(<PollWizard poll={poll} common={POLLS_COMMON} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Thank you')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(
      screen.getByText('What is the biggest mealtime challenge in your home?'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Thank you')).toBeNull();
  });

  it('resumes at the first unanswered enabled question after refresh hydration', async () => {
    const poll = getPollContent('workshop-food-jun-26');
    if (!poll) {
      throw new Error('expected poll fixture');
    }

    vi.spyOn(pollsApi, 'fetchPollControlState').mockResolvedValue({
      pollSlug: poll.slug,
      enabledQuestionIds: ['role', 'challenge', 'myth1'],
    });
    vi.spyOn(pollsApi, 'fetchPollSessionAnswers').mockResolvedValue({
      pollSlug: poll.slug,
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [
        {
          questionId: 'role',
          questionType: 'select',
          selectedOption: 'Parent',
        },
      ],
    });
    vi.spyOn(pollsApi, 'persistPollAnswer').mockResolvedValue();

    render(<PollWizard poll={poll} common={POLLS_COMMON} />);

    await waitFor(() => {
      expect(
        screen.getByText('What is the biggest mealtime challenge in your home?'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Question 2 of 3')).toBeInTheDocument();
  });

  it('scopes session ids per poll slug in session storage', async () => {
    const poll = getPollContent('workshop-food-jun-26');
    if (!poll) {
      throw new Error('expected poll fixture');
    }

    vi.spyOn(pollsApi, 'fetchPollControlState').mockResolvedValue({
      pollSlug: poll.slug,
      enabledQuestionIds: [],
    });
    vi.spyOn(pollsApi, 'fetchPollSessionAnswers').mockResolvedValue({
      pollSlug: poll.slug,
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [],
    });

    render(<PollWizard poll={poll} common={POLLS_COMMON} />);

    expect(
      window.sessionStorage.getItem('evolvesprouts-poll-session-id:workshop-food-jun-26'),
    ).toBeTruthy();
    expect(window.sessionStorage.getItem('evolvesprouts-poll-session-id')).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
  });
});
