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
    mockList.mockReset();
    mockCreate.mockReset();
    mockRevoke.mockReset();
    mockList.mockResolvedValue([sampleKey]);
  });

  it('lists keys and creates a token shown once', async () => {
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
    expect(screen.getByText('esk_testdisp')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Name'));
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
  });

  it('places scope and expires at on the same editor row', async () => {
    render(<ApiKeysPanel />);
    expect(await screen.findByText('Partner read')).toBeInTheDocument();

    const scope = screen.getByLabelText('Scope');
    const expires = screen.getByLabelText('Expires at (optional)');
    const row = scope.closest('div.grid');
    expect(row).toBe(expires.closest('div.grid'));
    expect(row).toHaveClass('sm:grid-cols-2');
  });

  it('styles the Operations revoke action as a danger icon button', async () => {
    render(<ApiKeysPanel />);
    expect(await screen.findByText('Partner read')).toBeInTheDocument();

    const revoke = screen.getByRole('button', { name: 'Revoke API key' });
    expect(revoke).toHaveClass('bg-red-600', 'h-8', 'min-w-8', 'px-0');
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
