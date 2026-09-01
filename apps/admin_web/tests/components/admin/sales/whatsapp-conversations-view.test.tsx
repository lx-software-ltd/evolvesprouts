import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const { listState, mockListMessages } = vi.hoisted(() => {
  const listState = {
    conversations: [
      {
        id: 'conv-1',
        waId: '85294479843',
        profileName: 'Kitie Wong',
        contactId: 'contact-1',
        contactName: 'Jane Doe',
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

vi.mock('@/lib/inbox-import-api', () => ({
  listInboxImportJobs: vi.fn().mockResolvedValue([]),
  createWhatsAppExportImportJob: vi.fn(),
  formatInboxImportCounters: () => '',
}));

vi.mock('@/lib/assets-api', () => ({
  createAdminAsset: vi.fn(),
  deleteAdminAsset: vi.fn(),
  uploadFileToPresignedUrl: vi.fn(),
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

    expect(screen.getByText('Import WhatsApp export')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import export' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Jane Doe' })).toHaveAttribute(
      'href',
      '/contacts?contact=contact-1'
    );
    expect(screen.queryByText('Kitie Wong')).not.toBeInTheDocument();
    expect(screen.getByText('85294479843')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View conversation Jane Doe' }));
    expect(mockListMessages).toHaveBeenCalledWith('conv-1');
    expect(await screen.findByText('How much?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('How much?')).not.toBeInTheDocument();
  });
});
