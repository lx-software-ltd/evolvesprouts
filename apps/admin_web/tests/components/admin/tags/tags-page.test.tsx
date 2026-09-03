import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListAdminTags, mockUpdateAdminTag, mockCreateAdminTag } = vi.hoisted(() => ({
  mockListAdminTags: vi.fn(),
  mockUpdateAdminTag: vi.fn(),
  mockCreateAdminTag: vi.fn(),
}));

vi.mock('@/lib/tags-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tags-api')>();
  return {
    ...actual,
    listAdminTags: mockListAdminTags,
    updateAdminTag: mockUpdateAdminTag,
    createAdminTag: mockCreateAdminTag,
  };
});

import { TagsPage } from '@/components/admin/tags/tags-page';

const tagAlpha = {
  id: 't-alpha',
  name: 'Alpha',
  color: '#112233',
  description: null,
  archived_at: null,
  usage_count: 0,
  is_system: false,
};

const tagBeta = {
  id: 't-beta',
  name: 'Beta',
  color: null,
  description: null,
  archived_at: null,
  usage_count: 1,
  is_system: false,
};

function rowNamed(name: RegExp): HTMLElement {
  const row = screen.getByRole('cell', { name }).closest('tr');
  expect(row).toBeTruthy();
  return row as HTMLElement;
}

describe('TagsPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/tags');
    mockListAdminTags.mockReset();
    mockUpdateAdminTag.mockReset();
    mockCreateAdminTag.mockReset();
    mockListAdminTags.mockResolvedValue([tagAlpha, tagBeta]);
    mockUpdateAdminTag.mockImplementation(async (tagId: string, body: { archived?: boolean }) => {
      if (body.archived === true) {
        return { ...tagAlpha, id: tagId, archived_at: '2026-01-01T00:00:00.000Z' };
      }
      if (body.archived === false) {
        return { ...tagAlpha, id: tagId, archived_at: null };
      }
      return null;
    });
  });

  it('renders the table first with no titles and filters rows by name search', async () => {
    const user = userEvent.setup();
    render(<TagsPage />);

    expect(await screen.findByRole('cell', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('button', { name: 'New tag' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: /Beta/ })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Name'), 'alp');

    expect(screen.getByRole('cell', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: /Beta/ })).not.toBeInTheDocument();
  });

  it('separates a system tag name from its marker so the cell can wrap on a phone', async () => {
    mockListAdminTags.mockResolvedValue([
      { ...tagAlpha, id: 't-sys', name: 'client_document', is_system: true, usage_count: 3 },
    ]);
    render(<TagsPage />);

    const cell = await screen.findByRole('cell', { name: /client_document/ });
    // A real space between the name and "(system)" gives the browser a break
    // opportunity; a margin alone would leave one unbreakable token.
    expect(cell.textContent).toContain('client_document (system)');
    expect(cell.className).toContain('max-md:wrap-anywhere');
  });

  it('disables delete when usage is greater than zero and offers Archive', async () => {
    render(<TagsPage />);
    await screen.findByRole('cell', { name: /Alpha/ });

    const betaRow = rowNamed(/Beta/);
    expect(
      within(betaRow).getByRole('button', { name: 'Cannot delete tag while it is in use' })
    ).toBeDisabled();
    expect(within(betaRow).getByRole('button', { name: 'Archive tag' })).not.toBeDisabled();

    expect(within(rowNamed(/Alpha/)).getByRole('button', { name: 'Delete tag' })).not.toBeDisabled();
  });

  it('archives a tag from the table after confirmation', async () => {
    const user = userEvent.setup();
    render(<TagsPage />);
    await screen.findByRole('cell', { name: /Alpha/ });

    await user.click(within(rowNamed(/Alpha/)).getByRole('button', { name: 'Archive tag' }));

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    expect(mockUpdateAdminTag).toHaveBeenCalledWith('t-alpha', { archived: true });
  });

  it('expands a row into the editor and updates the tag', async () => {
    const user = userEvent.setup();
    mockUpdateAdminTag.mockResolvedValue({ ...tagAlpha, name: 'Alpha renamed' });
    render(<TagsPage />);
    await screen.findByRole('cell', { name: /Alpha/ });

    await user.click(screen.getByRole('button', { name: 'Expand Alpha' }));
    const nameInput = await screen.findByLabelText('Name');
    expect(nameInput).toHaveValue('Alpha');
    expect(screen.getByLabelText('Color (#RRGGBB)')).toHaveValue('#112233');

    await user.clear(nameInput);
    await user.type(nameInput, 'Alpha renamed');
    await user.click(screen.getByRole('button', { name: 'Update tag' }));

    await waitFor(() => {
      expect(mockUpdateAdminTag).toHaveBeenCalledWith('t-alpha', {
        name: 'Alpha renamed',
        color: '#112233',
        description: null,
      });
    });
  });

  it('opens a draft row from New tag and creates the tag', async () => {
    const user = userEvent.setup();
    mockCreateAdminTag.mockResolvedValue({ ...tagAlpha, id: 't-new', name: 'Gamma' });
    render(<TagsPage />);
    await screen.findByRole('cell', { name: /Alpha/ });

    await user.click(screen.getByRole('button', { name: 'New tag' }));
    expect(screen.getByRole('cell', { name: 'New tag' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Gamma');
    await user.click(screen.getByRole('button', { name: 'Create tag' }));

    await waitFor(() => {
      expect(mockCreateAdminTag).toHaveBeenCalledWith({ name: 'Gamma', color: null, description: null });
    });
    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'New tag' })).toBeNull();
    });
  });
});
