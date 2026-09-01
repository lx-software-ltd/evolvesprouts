import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function conversation(
  id: string,
  lastMessageAt: string,
  inboundCount = 1,
  outboundCount = 0
) {
  return { id, lastMessageAt, contactId: 'contact-1', inboundCount, outboundCount };
}

function message(id: string, body: string, sentAt: string, direction: 'inbound' | 'outbound' = 'inbound') {
  return { id, direction, messageType: 'text', body, sentAt };
}

describe('LeadConversationCard', () => {
  beforeEach(() => {
    listWhatsAppConversations.mockReset();
    listMetaConversations.mockReset();
    listWhatsAppMessages.mockReset();
    listMetaMessages.mockReset();
  });

  it('shows the three latest messages and links overflow to the inbox', async () => {
    listWhatsAppConversations.mockResolvedValue({
      items: [conversation('wa-1', '2026-03-02T10:00:00Z', 1, 0)],
      nextCursor: null,
      totalCount: 1,
    });
    listMetaConversations.mockImplementation(async ({ channel }: { channel?: string }) => ({
      items:
        channel === 'instagram'
          ? [conversation('ig-1', '2026-03-08T10:00:00Z', 3, 2)]
          : [conversation('fb-1', '2026-03-03T10:00:00Z', 2, 0)],
      nextCursor: null,
      totalCount: 1,
    }));
    listMetaMessages.mockResolvedValue({
      conversation: { id: 'ig-1' },
      items: [
        message('m-4', 'Oldest kept off the card', '2026-03-05T10:00:00Z'),
        message('m-3', 'Third newest', '2026-03-06T10:00:00Z'),
        message('m-2', 'Second newest', '2026-03-07T10:00:00Z', 'outbound'),
        message('m-1', 'Newest reply', '2026-03-08T10:00:00Z'),
      ],
    });

    render(<LeadConversationCard contactId='contact-1' />);

    await waitFor(() => {
      expect(screen.getByText('Newest reply')).toBeInTheDocument();
    });
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('Second newest')).toBeInTheDocument();
    expect(screen.getByText('Third newest')).toBeInTheDocument();
    expect(screen.queryByText('Oldest kept off the card')).not.toBeInTheDocument();
    expect(screen.queryByText('Hello from wa-1')).not.toBeInTheDocument();

    const bodies = screen.getAllByText(/newest|Newest/i).map((node) => node.textContent);
    expect(bodies).toEqual(['Newest reply', 'Second newest', 'Third newest']);

    expect(screen.getByRole('link', { name: 'Open conversation' })).toHaveAttribute(
      'href',
      '/sales?tab=instagram&contact=contact-1&conversation=ig-1'
    );
    expect(listWhatsAppMessages).not.toHaveBeenCalled();
  });

  it('hides the open button when the thread has three or fewer messages', async () => {
    listWhatsAppConversations.mockResolvedValue({
      items: [conversation('wa-1', '2026-03-08T10:00:00Z', 2, 0)],
      nextCursor: null,
      totalCount: 1,
    });
    listMetaConversations.mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });
    listWhatsAppMessages.mockResolvedValue({
      conversation: { id: 'wa-1' },
      items: [
        message('m-2', 'Older ping', '2026-03-07T10:00:00Z'),
        message('m-1', 'Latest ping', '2026-03-08T10:00:00Z'),
      ],
    });

    render(<LeadConversationCard contactId='contact-1' />);

    await waitFor(() => {
      expect(screen.getByText('Latest ping')).toBeInTheDocument();
    });
    expect(screen.getByText('Older ping')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open conversation' })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('link', { name: 'Open conversation' })).not.toBeInTheDocument();
  });
});
