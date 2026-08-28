import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { listState, mockListMessages } = vi.hoisted(() => {
  const listState = {
    conversations: [
      {
        id: 'conv-1',
        waId: '85294479843',
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

vi.mock('@/hooks/use-whatsapp-conversations', () => ({
  useWhatsAppConversations: () => listState,
}));

vi.mock('@/lib/whatsapp-api', () => ({
  listWhatsAppMessages: (...args: unknown[]) => mockListMessages(...args),
}));

import { WhatsAppConversationsView } from '@/components/admin/sales/whatsapp-conversations-view';

describe('WhatsAppConversationsView', () => {
  it('lists conversations and loads messages on row click', async () => {
    mockListMessages.mockResolvedValue({
      conversation: listState.conversations[0],
      items: [
        {
          id: 'msg-1',
          waMessageId: 'wamid.1',
          direction: 'inbound',
          messageType: 'text',
          body: 'How much?',
          sentAt: '2026-08-02T00:00:00+00:00',
        },
      ],
    });
    const user = userEvent.setup();
    render(<WhatsAppConversationsView />);

    expect(screen.getByText('Kitie Wong')).toBeInTheDocument();
    expect(screen.getByText('85294479843')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View conversation Kitie Wong' }));
    expect(mockListMessages).toHaveBeenCalledWith('conv-1');
    expect(await screen.findByText('How much?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('How much?')).not.toBeInTheDocument();
  });
});
