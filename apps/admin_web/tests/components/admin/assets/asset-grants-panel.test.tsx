import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AssetGrantsPanel, GRANT_DRAFT_ID } from '@/components/admin/assets/asset-grants-panel';
import { createAdminAssetFixture, createAssetGrantFixture } from '../../../fixtures/assets';

const SELECTED_ASSET = createAdminAssetFixture();

const GRANT = createAssetGrantFixture();

function renderPanel(overrides: Partial<ComponentProps<typeof AssetGrantsPanel>> = {}) {
  const onCreateGrant = vi.fn().mockResolvedValue(true);
  const onDeleteGrant = vi.fn().mockResolvedValue(undefined);

  render(
    <AssetGrantsPanel
      selectedAsset={SELECTED_ASSET}
      grants={[]}
      isLoadingGrants={false}
      grantsError=''
      grantMutationError=''
      isSavingGrant={false}
      isDeletingGrantId={null}
      onCreateGrant={onCreateGrant}
      onDeleteGrant={onDeleteGrant}
      {...overrides}
    />
  );

  return { onCreateGrant, onDeleteGrant };
}

async function openDisclosure(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Access grants/ }));
}

describe('AssetGrantsPanel', () => {
  it('renders grants as a nested table inside a collapsed sub-accordion with a count', async () => {
    const user = userEvent.setup();
    renderPanel({ grants: [GRANT] });

    const trigger = screen.getByRole('button', { name: /Access grants/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('1 grant');

    await openDisclosure(user);

    const table = screen.getByTestId('admin-record-table');
    expect(table).toHaveAttribute('data-embedded', 'true');
    expect(screen.queryByRole('heading', { name: /Grants/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'New grant' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Grantee' })).toHaveClass('hidden', 'md:table-cell');
    expect(screen.getByRole('columnheader', { name: 'Granted by' })).toHaveClass('hidden', 'lg:table-cell');
    const row = screen.getByTestId('asset-grant-row-grant-1');
    expect(within(row).getByText('Organization')).toBeInTheDocument();
    expect(within(row).getByText('org-1', { selector: 'span.wrap-anywhere' })).toBeInTheDocument();
  });

  it('opens a draft row from the create button and requires a grantee for organization grants', async () => {
    const user = userEvent.setup();
    const { onCreateGrant } = renderPanel();

    await openDisclosure(user);
    await user.click(screen.getByRole('button', { name: 'New grant' }));

    const draftRow = screen.getByTestId(`admin-row-${GRANT_DRAFT_ID}`);
    expect(draftRow).toHaveAttribute('data-draft', 'true');
    expect(screen.getByLabelText('Grantee ID')).toBeDisabled();

    const grantTypeSelect = screen.getByLabelText('Grant type');
    await user.selectOptions(grantTypeSelect, 'organization');
    expect((grantTypeSelect as HTMLSelectElement).value).toBe('organization');
    expect(screen.getByLabelText('Grantee ID')).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Add grant' }));
    expect(screen.getByText('Grantee ID is required for organization and user grants.')).toBeInTheDocument();
    expect(onCreateGrant).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Grantee ID'), 'org-42');
    await user.click(screen.getByRole('button', { name: 'Add grant' }));

    expect(onCreateGrant).toHaveBeenCalledWith('asset-1', {
      grantType: 'organization',
      granteeId: 'org-42',
    });
    await waitFor(() => {
      expect(screen.queryByTestId(`admin-row-${GRANT_DRAFT_ID}`)).not.toBeInTheDocument();
    });
  });

  it('keeps the draft row open when creating the grant fails', async () => {
    const user = userEvent.setup();
    renderPanel({ onCreateGrant: vi.fn().mockResolvedValue(false) });

    await openDisclosure(user);
    await user.click(screen.getByRole('button', { name: 'New grant' }));
    await user.click(screen.getByRole('button', { name: 'Add grant' }));

    expect(screen.getByTestId(`admin-row-${GRANT_DRAFT_ID}`)).toBeInTheDocument();
  });

  it('shows the saving label while the grant is being added', async () => {
    const user = userEvent.setup();
    renderPanel({ isSavingGrant: true });

    await openDisclosure(user);
    await user.click(screen.getByRole('button', { name: 'New grant' }));

    expect(screen.getByRole('button', { name: /Adding…/ })).toBeDisabled();
  });

  it('confirms revoke action from the Operations column before deleting a grant', async () => {
    const user = userEvent.setup();
    const { onDeleteGrant } = renderPanel({ grants: [GRANT] });

    await openDisclosure(user);
    await user.click(screen.getByRole('button', { name: 'Revoke grant' }));
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    expect(onDeleteGrant).toHaveBeenCalledWith('asset-1', 'grant-1');
  });

  it('surfaces load and mutation errors inside the nested table', async () => {
    const user = userEvent.setup();
    renderPanel({ grantMutationError: 'Failed to create grant.' });

    await openDisclosure(user);
    expect(screen.getByText('Failed to create grant.')).toBeInTheDocument();
  });
});
