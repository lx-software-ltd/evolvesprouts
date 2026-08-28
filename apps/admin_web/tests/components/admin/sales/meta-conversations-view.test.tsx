import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { listState, mockListMessages } = vi.hoisted(() => {
  const listState = {
    conversations: [
      {
        id: 'conv-1',
        channel: 'instagram' as const,
        platformUserId: 'igsid-1',
        pageId: 'ig-page-1',
        profileName: 'Kitie Wong',
        contactId: null,
        contactName: null,
        leadId: 'lead-1',
        firstInboundAt: '2026-08-01T00:00:00+00:00',
        lastMessageAt: '2026-08-02T00:00:00+00:00',
        inboundCount: 2,
        outboundCount: 1,
        createdAt: '2026-08-01T00:00:00+00:00',
      },
    ],
    filters: { q: '' },
    setFilter: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    error: '',
    refetch: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
    totalCount: 1,
  };
  return {
    listState,
    mockListMessages: vi.fn(),
  };
});

vi.mock('@/hooks/use-meta-conversations', () => ({
  useMetaConversations: () => listState,
}));

vi.mock('@/lib/meta-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/meta-api')>('@/lib/meta-api');
  return {
    ...actual,
    listMetaMessages: (...args: unknown[]) => mockListMessages(...args),
  };
});

import { MetaConversationsView } from '@/components/admin/sales/meta-conversations-view';

describe('MetaConversationsView', () => {
  it('lists Instagram conversations and loads messages on row click', async () => {
    mockListMessages.mockResolvedValue({
      conversation: listState.conversations[0],
      items: [
        {
          id: 'msg-1',
          platformMessageId: 'm_1',
          direction: 'inbound',
          messageType: 'text',
          body: 'How much?',
          sentAt: '2026-08-02T00:00:00+00:00',
        },
      ],
    });
    const user = userEvent.setup();
    render(<MetaConversationsView channel='instagram' />);

    expect(screen.getByText('Instagram conversations')).toBeInTheDocument();
    expect(screen.getByText('Kitie Wong')).toBeInTheDocument();
    expect(screen.getByText('igsid-1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View conversation Kitie Wong' }));
    expect(mockListMessages).toHaveBeenCalledWith('conv-1');
    expect(await screen.findByText('How much?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('How much?')).not.toBeInTheDocument();
  });
});
