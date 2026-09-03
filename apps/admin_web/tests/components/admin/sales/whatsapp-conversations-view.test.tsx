import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const { listState, mockListMessages, inboxImportApi } = vi.hoisted(() => {
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
    inboxImportApi: {
      listInboxImportJobs: vi.fn(async () => []),
      createWhatsAppExportImportJob: vi.fn(),
      formatInboxImportCounters: vi.fn(() => ''),
    },
  };
});

vi.mock('@/hooks/use-whatsapp-conversations', () => ({
  useWhatsAppConversations: () => listState,
}));

vi.mock('@/lib/whatsapp-api', () => ({
  listWhatsAppMessages: (...args: unknown[]) => mockListMessages(...args),
}));

vi.mock('@/lib/inbox-import-api', () => inboxImportApi);

vi.mock('@/lib/assets-api', () => ({
  createAdminAsset: vi.fn(),
  deleteAdminAsset: vi.fn(),
  uploadFileToPresignedUrl: vi.fn(),
}));

import { WhatsAppConversationsView } from '@/components/admin/sales/whatsapp-conversations-view';

const MESSAGES = [
  {
    id: 'msg-1',
    waMessageId: 'wamid.1',
    direction: 'inbound',
    messageType: 'text',
    body: 'Older question',
    sentAt: '2026-08-01T00:00:00+00:00',
  },
  {
    id: 'msg-2',
    waMessageId: 'wamid.2',
    direction: 'outbound',
    messageType: 'text',
    body: 'How much?',
    sentAt: '2026-08-02T00:00:00+00:00',
  },
];

describe('WhatsAppConversationsView', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/sales');
    mockListMessages.mockReset();
    listState.setFilter.mockClear();
  });

  it('renders a title-less record table with the import accordion collapsed', () => {
    render(<WhatsAppConversationsView />);

    // The only heading is the import accordion's trigger; the table has no title.
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText('WhatsApp conversations')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'WhatsApp conversations' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toHaveAttribute('placeholder', 'Name or WhatsApp id');

    const importToggle = screen.getByRole('button', { name: 'Import WhatsApp export' });
    expect(importToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('whatsapp-export-import-section-disclosure')).toBeInTheDocument();
    // Collapsed accordion keeps its form mounted but hidden.
    expect(screen.getByRole('button', { name: 'Import export', hidden: true })).toBeDisabled();

    expect(screen.getByRole('link', { name: 'Jane Doe' })).toHaveAttribute('href', '/contacts?contact=contact-1');
    expect(screen.queryByText('Kitie Wong')).not.toBeInTheDocument();
    expect(screen.getAllByText('85294479843').length).toBeGreaterThan(0);
    expect(screen.queryByRole('columnheader', { name: 'Operations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View conversation/ })).not.toBeInTheDocument();
  });

  it('expands a row in place to show the thread newest first and collapses it again', async () => {
    mockListMessages.mockResolvedValue({ conversation: listState.conversations[0], items: MESSAGES });
    const user = userEvent.setup();
    render(<WhatsAppConversationsView />);

    expect(mockListMessages).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Expand Jane Doe' }));
    expect(window.location.search).toContain('conversation=conv-1');
    expect(mockListMessages).toHaveBeenCalledWith('conv-1');
    expect(await screen.findByText('How much?')).toBeInTheDocument();
    const messageBodies = screen.getAllByText(/How much\?|Older question/).map((node) => node.textContent);
    expect(messageBodies).toEqual(['How much?', 'Older question']);
    expect(screen.getByText('Inbound 2 · outbound 1')).toBeInTheDocument();
    expect(screen.getByTestId('admin-row-conv-1')).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: 'Collapse Jane Doe' }));
    await waitFor(() => {
      expect(screen.queryByText('How much?')).not.toBeInTheDocument();
    });
    expect(window.location.search).not.toContain('conversation=');
  });

  it('applies the search filter on change', async () => {
    const user = userEvent.setup();
    render(<WhatsAppConversationsView />);

    await user.type(screen.getByLabelText('Search'), 'ja');
    expect(listState.setFilter).toHaveBeenCalledWith('q', 'j');
  });

  it('opens the first conversation when a contact deep link is present', async () => {
    mockListMessages.mockResolvedValue({ conversation: listState.conversations[0], items: MESSAGES.slice(1) });
    window.history.replaceState(null, '', '/sales?tab=whatsapp&contact=contact-1');
    render(<WhatsAppConversationsView />);

    expect(await screen.findByText('How much?')).toBeInTheDocument();
    expect(mockListMessages).toHaveBeenCalledWith('conv-1');
    expect(window.location.search).toContain('conversation=conv-1');
  });

  it('opens the conversation from a conversation deep link', async () => {
    mockListMessages.mockResolvedValue({ conversation: listState.conversations[0], items: MESSAGES.slice(1) });
    window.history.replaceState(null, '', '/sales?tab=whatsapp&contact=contact-1&conversation=conv-1');
    render(<WhatsAppConversationsView />);

    expect(await screen.findByText('How much?')).toBeInTheDocument();
    expect(mockListMessages).toHaveBeenCalledWith('conv-1');
  });

  it('opens the import accordion with a field grid and a Saving-style submit', async () => {
    const user = userEvent.setup();
    render(<WhatsAppConversationsView />);

    await user.click(screen.getByRole('button', { name: 'Import WhatsApp export' }));
    expect(screen.getByRole('button', { name: 'Import WhatsApp export' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Counterparty WhatsApp number (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Business display names (optional, comma-separated)')).toBeInTheDocument();
    expect(screen.getByLabelText('Counterparty WhatsApp number (optional)').closest('[data-columns]')).toHaveAttribute(
      'data-columns',
      '4'
    );
    expect(screen.getByRole('button', { name: 'Import export' })).toBeDisabled();
  });
});
