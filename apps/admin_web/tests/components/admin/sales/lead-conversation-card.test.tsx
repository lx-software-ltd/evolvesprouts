import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { listWhatsAppConversations, listMetaConversations, listWhatsAppMessages, listMetaMessages } =
  vi.hoisted(() => ({
    listWhatsAppConversations: vi.fn(),
    listMetaConversations: vi.fn(),
    listWhatsAppMessages: vi.fn(),
    listMetaMessages: vi.fn(),
  }));

vi.mock('@/lib/whatsapp-api', () => ({
  listWhatsAppConversations,
  listWhatsAppMessages,
}));

vi.mock('@/lib/meta-api', () => ({
  listMetaConversations,
  listMetaMessages,
}));

import { LeadConversationCard } from '@/components/admin/sales/lead-conversation-card';

function conversation(id: string, lastMessageAt: string) {
  return { id, lastMessageAt, contactId: 'contact-1' };
}

function message(id: string, body: string, sentAt: string, direction: 'inbound' | 'outbound' = 'inbound') {
  return { id, direction, messageType: 'text', body, sentAt };
}

describe('LeadConversationCard', () => {
  it('shows the latest five conversations and links overflow to the inbox', async () => {
    listWhatsAppConversations.mockResolvedValue({
      items: [conversation('wa-1', '2026-03-02T10:00:00Z'), conversation('wa-2', '2026-03-06T10:00:00Z')],
      nextCursor: null,
      totalCount: 2,
    });
    listMetaConversations.mockImplementation(async ({ channel }: { channel?: string }) => ({
      items:
        channel === 'instagram'
          ? [conversation('ig-1', '2026-03-01T10:00:00Z'), conversation('ig-2', '2026-03-05T10:00:00Z')]
          : [
              conversation('fb-1', '2026-03-03T10:00:00Z'),
              conversation('fb-2', '2026-03-04T10:00:00Z'),
              conversation('fb-3', '2026-03-07T10:00:00Z'),
            ],
      nextCursor: null,
      totalCount: channel === 'instagram' ? 2 : 3,
    }));
    listWhatsAppMessages.mockImplementation(async (conversationId: string) => ({
      conversation: { id: conversationId },
      items: [message(`${conversationId}-msg`, `Hello from ${conversationId}`, '2026-03-02T10:00:00Z')],
    }));
    listMetaMessages.mockImplementation(async (conversationId: string) => ({
      conversation: { id: conversationId },
      items: [
        message(
          `${conversationId}-msg`,
          `Hello from ${conversationId}`,
          '2026-03-01T10:00:00Z',
          'outbound'
        ),
      ],
    }));

    render(<LeadConversationCard contactId='contact-1' />);

    await waitFor(() => {
      expect(screen.getByText('Hello from fb-3')).toBeInTheDocument();
    });
    expect(screen.getByText('Hello from wa-2')).toBeInTheDocument();
    expect(screen.getByText('Hello from ig-2')).toBeInTheDocument();
    expect(screen.getByText('Hello from fb-2')).toBeInTheDocument();
    expect(screen.getByText('Hello from fb-1')).toBeInTheDocument();
    expect(screen.queryByText('Hello from ig-1')).not.toBeInTheDocument();

    const bodies = screen.getAllByText(/Hello from /).map((node) => node.textContent);
    expect(bodies).toEqual([
      'Hello from fb-3',
      'Hello from wa-2',
      'Hello from ig-2',
      'Hello from fb-2',
      'Hello from fb-1',
    ]);

    expect(screen.getByRole('link', { name: /Hello from fb-3/i })).toHaveAttribute(
      'href',
      '/sales?tab=messenger&contact=contact-1&conversation=fb-3'
    );
    expect(screen.getByRole('link', { name: 'Open full conversation' })).toHaveAttribute(
      'href',
      '/sales?tab=whatsapp&contact=contact-1&conversation=wa-1'
    );
  });

  it('shows an empty state when the contact has no conversations', async () => {
    listWhatsAppConversations.mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });
    listMetaConversations.mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });

    render(<LeadConversationCard contactId='contact-1' />);

    await waitFor(() => {
      expect(
        screen.getByText('No Instagram, Messenger, or WhatsApp conversations for this contact.')
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'Open full conversation' })).not.toBeInTheDocument();
  });
});
