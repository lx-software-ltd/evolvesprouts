import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockList, mockCreate, mockRevoke } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockRevoke: vi.fn(),
}));

vi.mock('@/lib/api-keys-api', () => ({
  listAdminApiKeys: (...args: unknown[]) => mockList(...args),
  createAdminApiKey: (...args: unknown[]) => mockCreate(...args),
  revokeAdminApiKey: (...args: unknown[]) => mockRevoke(...args),
}));

import { ApiKeysPanel } from '@/components/admin/audit/api-keys-panel';

const sampleKey = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Partner read',
  key_prefix: 'esk_testdisp',
  scope: 'user' as const,
  status: 'active' as const,
  created_by: 'admin-user',
  created_at: '2026-08-01T00:00:00+00:00',
  expires_at: null,
  revoked_at: null,
  last_used_at: null,
};

describe('ApiKeysPanel', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/audit?view=api-keys');
    mockList.mockReset();
    mockCreate.mockReset();
    mockRevoke.mockReset();
    mockList.mockResolvedValue([sampleKey]);
  });

  it('lists keys and creates a token shown once from the draft row', async () => {
    mockCreate.mockResolvedValue({
      ...sampleKey,
      id: '22222222-2222-4222-8222-222222222222',
      name: 'New key',
      scope: 'admin',
      api_token: 'esk_shown_once',
    });
    const user = userEvent.setup();
    render(<ApiKeysPanel />);

    expect(await screen.findByText('Partner read')).toBeInTheDocument();
    expect(screen.getAllByText('esk_testdisp').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'New API key' }));
    await user.type(screen.getByLabelText('Name'), 'New key');
    await user.selectOptions(screen.getByLabelText('Scope'), 'admin');
    await user.click(screen.getByRole('button', { name: 'Create API key' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'New key',
        scope: 'admin',
        expires_at: null,
      });
    });
    expect(await screen.findByText(/esk_shown_once/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'New API key' })).toBeNull();
    });
  });

  it('lays the draft out as Name 2/4, Scope 1/4, Expires at 1/4 in one field grid', async () => {
    const user = userEvent.setup();
    render(<ApiKeysPanel />);
    expect(await screen.findByText('Partner read')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New API key' }));
    const name = screen.getByLabelText('Name');
    const scope = screen.getByLabelText('Scope');
    const expires = screen.getByLabelText('Expires at (optional)');
    const grid = scope.closest('.grid');
    expect(grid).not.toBeNull();
    expect(expires.closest('.grid')).toBe(grid);
    expect(name.closest('.grid')).toBe(grid);
    expect(name.parentElement).toHaveClass('sm:col-span-2');
  });

  it('opens an existing key as a read-only view with no save action', async () => {
    const user = userEvent.setup();
    render(<ApiKeysPanel />);
    expect(await screen.findByText('Partner read')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand Partner read' }));
    const nameField = await screen.findByLabelText('Name');
    expect(nameField).toHaveValue('Partner read');
    expect(nameField).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Prefix')).toHaveValue('esk_testdisp');
    expect(screen.getByLabelText('Status')).toHaveValue('active');
    expect(screen.queryByRole('button', { name: /Create API key|Update/ })).toBeNull();
  });

  it('renders the Operations revoke action as a bordered danger icon button', async () => {
    render(<ApiKeysPanel />);
    expect(await screen.findByText('Partner read')).toBeInTheDocument();

    const revoke = screen.getByRole('button', { name: 'Revoke API key' });
    expect(revoke).toHaveClass('h-8', 'w-8', 'border', 'bg-white', 'text-red-600');
    expect(revoke).toHaveAttribute('title', 'Revoke API key');
  });

  it('revokes a key from Operations after confirm', async () => {
    mockRevoke.mockResolvedValue({ ...sampleKey, status: 'revoked' });
    const user = userEvent.setup();
    render(<ApiKeysPanel />);

    expect(await screen.findByText('Partner read')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke API key' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(mockRevoke).toHaveBeenCalledWith(sampleKey.id);
    });
  });
});
