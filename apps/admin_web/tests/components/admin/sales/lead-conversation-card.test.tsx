import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

describe('LeadConversationCard', () => {
  it('merges Instagram, Messenger, and WhatsApp history', async () => {
    listWhatsAppConversations.mockResolvedValue({
      items: [{ id: 'wa-1' }],
      nextCursor: null,
      totalCount: 1,
    });
    listMetaConversations.mockImplementation(async ({ channel }: { channel?: string }) => ({
      items: [{ id: channel === 'instagram' ? 'ig-1' : 'fb-1' }],
      nextCursor: null,
      totalCount: 1,
    }));
    listWhatsAppMessages.mockResolvedValue({
      conversation: { id: 'wa-1' },
      items: [
        {
          id: 'wa-msg-1',
          waMessageId: 'w1',
          direction: 'inbound',
          messageType: 'text',
          body: 'Hello from WhatsApp',
          sentAt: '2026-03-02T10:00:00Z',
        },
      ],
    });
    listMetaMessages.mockImplementation(async (conversationId: string) => ({
      conversation: { id: conversationId },
      items: [
        {
          id: `${conversationId}-msg`,
          platformMessageId: conversationId,
          direction: 'outbound',
          messageType: 'text',
          body: conversationId === 'ig-1' ? 'Hello from Instagram' : 'Hello from Messenger',
          sentAt: conversationId === 'ig-1' ? '2026-03-01T10:00:00Z' : '2026-03-03T10:00:00Z',
        },
      ],
    }));

    render(<LeadConversationCard contactId='contact-1' />);

    await waitFor(() => {
      expect(screen.getByText('Hello from Instagram')).toBeInTheDocument();
    });
    expect(screen.getByText('Hello from WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Hello from Messenger')).toBeInTheDocument();

    const bodies = screen.getAllByText(/Hello from /).map((node) => node.textContent);
    expect(bodies).toEqual([
      'Hello from Instagram',
      'Hello from WhatsApp',
      'Hello from Messenger',
    ]);
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
  });
});
