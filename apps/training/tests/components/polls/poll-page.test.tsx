import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PollPage } from '@/components/polls/poll-page';
import { getPollContent, POLLS_COMMON } from '@/lib/polls';

const poll = getPollContent('workshop-food-jun-26');

vi.mock('@/lib/polls-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/polls-api')>();
  return {
    ...actual,
    fetchPollControlState: vi.fn().mockResolvedValue({
      pollSlug: 'workshop-food-jun-26',
      enabledQuestionIds: ['role', 'challenge', 'myth1', 'myth2', 'myth3', 'myth4', 'email', 'onething'],
    }),
    fetchPollSessionAnswers: vi.fn().mockResolvedValue({
      pollSlug: 'workshop-food-jun-26',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [],
    }),
  };
});

describe('PollPage branding', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('links the logo to the public website home when origin is configured', async () => {
    if (!poll) {
      throw new Error('Expected workshop-food-jun-26 poll content');
    }
    vi.stubEnv('NEXT_PUBLIC_PUBLIC_WWW_ORIGIN', 'https://www.evolvesprouts.com');

    render(<PollPage poll={poll} common={POLLS_COMMON} />);

    const link = screen.getByRole('link', { name: 'Go to the Evolve Sprouts website' });
    expect(link).toHaveAttribute('href', 'https://www.evolvesprouts.com/en/');
    expect(screen.getByRole('img', { name: 'Evolve Sprouts' })).toBeInTheDocument();
    await screen.findByText(poll.questions[0]?.screen ?? '');
  });

  it('renders the logo without a link when public origin is unset', async () => {
    if (!poll) {
      throw new Error('Expected workshop-food-jun-26 poll content');
    }
    vi.stubEnv('NEXT_PUBLIC_PUBLIC_WWW_ORIGIN', '');

    render(<PollPage poll={poll} common={POLLS_COMMON} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('img', { name: 'Evolve Sprouts' })).toBeInTheDocument();
    await screen.findByText(poll.questions[0]?.screen ?? '');
  });
});
