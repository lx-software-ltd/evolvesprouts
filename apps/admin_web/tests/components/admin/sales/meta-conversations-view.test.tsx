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
        channel: 'instagram' as const,
        platformUserId: 'igsid-1',
        pageId: 'ig-page-1',
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
      createMetaImportJob: vi.fn(),
      formatInboxImportCounters: vi.fn(() => ''),
    },
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

vi.mock('@/lib/inbox-import-api', () => inboxImportApi);

import { MetaConversationsView } from '@/components/admin/sales/meta-conversations-view';

const MESSAGES = [
  {
    id: 'msg-1',
    platformMessageId: 'm_1',
    direction: 'inbound',
    messageType: 'text',
    body: 'Older question',
    sentAt: '2026-08-01T00:00:00+00:00',
  },
  {
    id: 'msg-2',
    platformMessageId: 'm_2',
    direction: 'outbound',
    messageType: 'text',
    body: 'How much?',
    sentAt: '2026-08-02T00:00:00+00:00',
  },
];

describe('MetaConversationsView', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/sales');
    mockListMessages.mockReset();
    inboxImportApi.createMetaImportJob.mockReset();
  });

  it('lists Instagram conversations in a title-less table and expands the thread in place', async () => {
    mockListMessages.mockResolvedValue({ conversation: listState.conversations[0], items: MESSAGES });
    const user = userEvent.setup();
    render(<MetaConversationsView channel='instagram' />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Instagram conversations' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Instagram user id' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toHaveAttribute('placeholder', 'Name or Instagram user id');
    expect(screen.getByTestId('admin-filter-bar-trailing')).toContainElement(
      screen.getByRole('button', { name: 'Import recent history' })
    );
    expect(screen.getByRole('link', { name: 'Jane Doe' })).toHaveAttribute('href', '/contacts?contact=contact-1');
    expect(screen.queryByText('Kitie Wong')).not.toBeInTheDocument();
    expect(screen.getAllByText('igsid-1').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /View conversation/ })).not.toBeInTheDocument();

    await user.click(screen.getByText('Jane Doe').closest('tr') as HTMLElement);
    expect(mockListMessages).toHaveBeenCalledWith('conv-1');
    expect(await screen.findByText('How much?')).toBeInTheDocument();
    const messageBodies = screen.getAllByText(/How much\?|Older question/).map((node) => node.textContent);
    expect(messageBodies).toEqual(['How much?', 'Older question']);

    await user.click(screen.getByRole('button', { name: 'Collapse Jane Doe' }));
    await waitFor(() => {
      expect(screen.queryByText('How much?')).not.toBeInTheDocument();
    });
  });

  it('labels the Messenger id column and shows no count copy', () => {
    render(<MetaConversationsView channel='facebook' />);

    expect(screen.getByRole('region', { name: 'Messenger conversations' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Messenger user id' })).toBeInTheDocument();
    expect(screen.queryByText('1 conversations')).not.toBeInTheDocument();
  });

  it('shows Importing… with a spinner while the import job is being created', async () => {
    const user = userEvent.setup();
    let resolveJob: (value: unknown) => void = () => {};
    inboxImportApi.createMetaImportJob.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveJob = resolve;
        })
    );
    render(<MetaConversationsView channel='instagram' />);

    await user.click(screen.getByRole('button', { name: 'Import recent history' }));
    const busy = screen.getByRole('button', { name: 'Importing…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');

    resolveJob({
      id: 'job-1',
      channel: 'instagram',
      status: 'pending',
      errorMessage: null,
      counters: {},
      createdAt: '2026-08-02T00:00:00+00:00',
    });
    expect(await screen.findByRole('button', { name: 'Import recent history' })).toBeEnabled();
    expect(listState.refetch).toHaveBeenCalled();
    expect(screen.getByText('Import queued')).toBeInTheDocument();
  });

  it('opens the first conversation when a contact deep link is present', async () => {
    mockListMessages.mockResolvedValue({ conversation: listState.conversations[0], items: MESSAGES.slice(1) });
    window.history.replaceState(null, '', '/sales?tab=instagram&contact=contact-1');
    render(<MetaConversationsView channel='instagram' />);

    expect(await screen.findByText('How much?')).toBeInTheDocument();
    expect(mockListMessages).toHaveBeenCalledWith('conv-1');
  });
});
