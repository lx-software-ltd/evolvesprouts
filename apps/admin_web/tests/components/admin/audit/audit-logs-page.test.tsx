import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListAuditLogs, mockListApiKeys } = vi.hoisted(() => ({
  mockListAuditLogs: vi.fn(),
  mockListApiKeys: vi.fn(),
}));

vi.mock('@/lib/audit-logs-api', () => ({
  listAuditLogs: mockListAuditLogs,
}));

vi.mock('@/lib/api-keys-api', () => ({
  listAdminApiKeys: (...args: unknown[]) => mockListApiKeys(...args),
  createAdminApiKey: vi.fn(),
  revokeAdminApiKey: vi.fn(),
}));

import { AuditLogsPage } from '@/components/admin/audit/audit-logs-page';

describe('AuditLogsPage', () => {
  beforeEach(() => {
    mockListAuditLogs.mockResolvedValue({ items: [], next_cursor: null });
    mockListApiKeys.mockResolvedValue([]);
  });

  it('switches to the API keys tab', async () => {
    const user = userEvent.setup();
    render(<AuditLogsPage />);
    await user.click(screen.getByRole('button', { name: 'API keys' }));
    expect(await screen.findByRole('heading', { name: 'New API key' })).toBeInTheDocument();
    expect(mockListApiKeys).toHaveBeenCalled();
  });

  it('renders audit logs heading', async () => {
    render(<AuditLogsPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Audit logs' })).toBeInTheDocument();
    });
  });

  it('shows API key name in the Actor column', async () => {
    mockListAuditLogs.mockResolvedValue({
      items: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          table_name: 'contacts',
          record_id: 'c1',
          action: 'UPDATE' as const,
          timestamp: '2024-01-03T00:00:00.000Z',
          source: 'trigger',
          user_id: 'api-key:00000000-0000-4000-8000-000000000099',
          user_email: 'Prod CRM full access',
        },
      ],
      next_cursor: null,
    });
    render(<AuditLogsPage />);
    await waitFor(() => {
      const table = screen.getByRole('table');
      expect(within(table).getByText('Prod CRM full access')).toBeInTheDocument();
      expect(within(table).getByText('contacts')).toBeInTheDocument();
    });
  });

  it('stacks table name above the action badge in one column', async () => {
    mockListAuditLogs.mockResolvedValue({
      items: [
        {
          id: '00000000-0000-4000-8000-000000000005',
          table_name: 'customer_invoices',
          record_id: 'inv-1',
          action: 'DRAFT_CREATED_CUSTOMIZED',
          timestamp: '2024-01-05T00:00:00.000Z',
          source: 'application',
        },
      ],
      next_cursor: null,
    });
    render(<AuditLogsPage />);
    await waitFor(() => {
      const table = screen.getByRole('table');
      expect(within(table).getByRole('columnheader', { name: 'Table / action' })).toBeInTheDocument();
      expect(within(table).queryByRole('columnheader', { name: /^Table$/ })).not.toBeInTheDocument();
      expect(within(table).queryByRole('columnheader', { name: /^Action$/ })).not.toBeInTheDocument();
      const stackedCell = within(table).getByText('customer_invoices').closest('td');
      expect(stackedCell).not.toBeNull();
      expect(within(stackedCell as HTMLElement).getByText('DRAFT_CREATED_CUSTOMIZED')).toBeInTheDocument();
    });
  });

  it('shows webhook actor label in the Actor column', async () => {
    mockListAuditLogs.mockResolvedValue({
      items: [
        {
          id: '00000000-0000-4000-8000-000000000004',
          table_name: 'whatsapp_conversations',
          record_id: 'w1',
          action: 'UPDATE' as const,
          timestamp: '2024-01-04T00:00:00.000Z',
          source: 'trigger',
          user_id: 'webhook:whatsapp',
          user_email: 'WhatsApp webhook',
        },
      ],
      next_cursor: null,
    });
    render(<AuditLogsPage />);
    await waitFor(() => {
      const table = screen.getByRole('table');
      expect(within(table).getByText('WhatsApp webhook')).toBeInTheDocument();
      expect(within(table).getByText('whatsapp_conversations')).toBeInTheDocument();
    });
  });

  it('passes email filter to listAuditLogs when user types email and applies', async () => {
    const user = userEvent.setup();
    render(<AuditLogsPage />);
    await waitFor(() => {
      expect(mockListAuditLogs).toHaveBeenCalled();
    });

    await user.type(screen.getByLabelText('Actor'), 'ops@example.com');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockListAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ops@example.com' }),
        undefined,
        50
      );
    });
  });

  it('appends items when Load more is used with next_cursor', async () => {
    const user = userEvent.setup();
    const first = {
      id: '00000000-0000-4000-8000-000000000001',
      table_name: 'assets',
      record_id: 'r1',
      action: 'INSERT' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      source: 'trigger',
    };
    const second = {
      id: '00000000-0000-4000-8000-000000000002',
      table_name: 'asset_access_grants',
      record_id: 'r2',
      action: 'UPDATE' as const,
      timestamp: '2024-01-02T00:00:00.000Z',
      source: 'trigger',
    };
    mockListAuditLogs.mockReset();
    mockListAuditLogs
      .mockResolvedValueOnce({ items: [first], next_cursor: 'cursor-token' })
      .mockResolvedValueOnce({ items: [second], next_cursor: null })
      .mockResolvedValue({ items: [], next_cursor: null });

    render(<AuditLogsPage />);
    await waitFor(() => {
      const table = screen.getByRole('table');
      expect(within(table).getByText('assets')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => {
      expect(mockListAuditLogs).toHaveBeenNthCalledWith(2, expect.anything(), 'cursor-token', 50);
      const table = screen.getByRole('table');
      expect(within(table).getByText('asset_access_grants')).toBeInTheDocument();
    });
  });
});
