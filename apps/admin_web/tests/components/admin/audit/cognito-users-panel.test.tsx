import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockList, mockCreate, mockUpdate, mockDelete, mockUseAuth } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockUseAuth: vi.fn(),
}));

vi.mock('@/components/auth-provider', () => ({
  useAuth: mockUseAuth,
}));

vi.mock('@/lib/cognito-users-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cognito-users-api')>('@/lib/cognito-users-api');
  return {
    ...actual,
    listCognitoUsers: (...args: unknown[]) => mockList(...args),
    createCognitoUser: (...args: unknown[]) => mockCreate(...args),
    updateCognitoUser: (...args: unknown[]) => mockUpdate(...args),
    deleteCognitoUser: (...args: unknown[]) => mockDelete(...args),
    getCognitoUser: vi.fn(),
  };
});

import { CognitoUsersPanel } from '@/components/admin/audit/cognito-users-panel';

const sampleUser = {
  id: 'ada@example.com',
  username: 'ada@example.com',
  sub: 'sub-ada',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  email_verified: true,
  enabled: true,
  status: 'CONFIRMED',
  groups: ['admin'],
  created_at: '2026-01-01T00:00:00+00:00',
  updated_at: '2026-01-02T00:00:00+00:00',
  last_auth_time: null,
};

describe('CognitoUsersPanel', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/audit?tab=users');
    mockUseAuth.mockReturnValue({ user: { subject: 'me-sub' } });
    mockList.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockDelete.mockReset();
    mockList.mockResolvedValue({ items: [sampleUser], next_cursor: null });
  });

  it('lists users and creates one from the draft row', async () => {
    mockCreate.mockResolvedValue({
      ...sampleUser,
      id: 'new@example.com',
      username: 'new@example.com',
      email: 'new@example.com',
      name: 'New User',
      groups: ['instructor'],
    });
    const user = userEvent.setup();
    render(<CognitoUsersPanel />);

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getAllByText('ada@example.com').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'New user' }));
    const editor = screen.getByTestId('admin-editor-panel');
    await user.type(within(editor).getByLabelText('Email'), 'new@example.com');
    await user.type(within(editor).getByLabelText('Name'), 'New User');
    await user.selectOptions(within(editor).getByLabelText('Group'), 'instructor');
    await user.click(screen.getByRole('button', { name: 'Create user' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        email: 'new@example.com',
        name: 'New User',
        group: 'instructor',
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'New user' })).toBeNull();
    });
  });

  it('filters by name and email without an Apply button', async () => {
    const user = userEvent.setup();
    render(<CognitoUsersPanel />);
    await waitFor(() => {
      expect(mockList).toHaveBeenCalled();
    });

    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@');

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ada', email: 'ada@' }),
        null,
        25,
        expect.anything()
      );
    });
    expect(screen.queryByRole('button', { name: 'Apply filters' })).toBeNull();
  });

  it('updates an expanded user', async () => {
    mockUpdate.mockResolvedValue({ ...sampleUser, name: 'Ada L' });
    const user = userEvent.setup();
    render(<CognitoUsersPanel />);
    const table = await screen.findByRole('table');
    await user.click(await within(table).findByRole('button', { name: /^Expand Ada Lovelace/ }));

    const editor = screen.getByTestId('admin-editor-panel');
    const nameInput = within(editor).getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Ada L');
    await user.click(screen.getByRole('button', { name: 'Update user' }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        'ada@example.com',
        expect.objectContaining({ name: 'Ada L', email: 'ada@example.com', group: 'admin' })
      );
    });
  });

  it('disables a user from Operations after confirm', async () => {
    mockUpdate.mockResolvedValue({ ...sampleUser, enabled: false });
    const user = userEvent.setup();
    render(<CognitoUsersPanel />);
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Disable user' }));
    await user.click(screen.getByRole('button', { name: 'Disable' }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('ada@example.com', { enabled: false });
    });
  });
});
