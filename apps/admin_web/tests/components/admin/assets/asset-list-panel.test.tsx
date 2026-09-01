import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetListPanel } from '@/components/admin/assets/asset-list-panel';
import { CLIENT_DOCUMENT_ASSET_TAG } from '@/types/assets';
import { createAdminAssetFixture } from '../../../fixtures/assets';

const { mockGetUserAssetDownloadUrl } = vi.hoisted(() => ({
  mockGetUserAssetDownloadUrl: vi.fn(),
}));

vi.mock('@/lib/assets-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/assets-api')>();
  return {
    ...actual,
    getUserAssetDownloadUrl: mockGetUserAssetDownloadUrl,
  };
});

const FIXTURE_ASSET = createAdminAssetFixture({
  title: 'Infant Nutrition Guide',
  s3Key: 'assets/infant-nutrition-guide.pdf',
  fileName: 'infant-nutrition-guide.pdf',
});

function renderPanel(overrides: Partial<ComponentProps<typeof AssetListPanel>> = {}) {
  const onQueryChange = vi.fn();
  const onVisibilityChange = vi.fn();
  const onTagNameChange = vi.fn();
  const onLoadMore = vi.fn().mockResolvedValue(undefined);
  const onSelectAsset = vi.fn();
  const onDeleteAsset = vi.fn().mockResolvedValue(undefined);

  render(
    <AssetListPanel
      assets={[FIXTURE_ASSET]}
      linkedTagNames={[]}
      selectedAssetId={null}
      filters={{ query: '', visibility: '', tagName: '' }}
      isLoadingAssets={false}
      isLoadingMoreAssets={false}
      isDeletingAssetId={null}
      assetsError=''
      nextCursor='cursor-1'
      onQueryChange={onQueryChange}
      onVisibilityChange={onVisibilityChange}
      onTagNameChange={onTagNameChange}
      onLoadMore={onLoadMore}
      onSelectAsset={onSelectAsset}
      onDeleteAsset={onDeleteAsset}
      {...overrides}
    />
  );

  return {
    onQueryChange,
    onVisibilityChange,
    onTagNameChange,
    onLoadMore,
    onSelectAsset,
    onDeleteAsset,
  };
}

describe('AssetListPanel', () => {
  beforeEach(() => {
    mockGetUserAssetDownloadUrl.mockReset();
  });

  it('opens asset in a new tab when view button is clicked', async () => {
    const user = userEvent.setup();
    mockGetUserAssetDownloadUrl.mockResolvedValueOnce('https://cdn.example.com/file.pdf');
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Open asset in new tab' }));

    expect(mockGetUserAssetDownloadUrl).toHaveBeenCalledWith('asset-1');
    expect(openSpy).toHaveBeenCalledWith('https://cdn.example.com/file.pdf', '_blank', 'noopener,noreferrer');

    openSpy.mockRestore();
  });

  it('renders table data and handles filter and load-more actions', async () => {
    const user = userEvent.setup();
    const { onQueryChange, onLoadMore } = renderPanel({
      assets: [createAdminAssetFixture({ ...FIXTURE_ASSET, contentLanguage: 'zh-HK' })],
    });

    expect(screen.getByRole('columnheader', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByText('Cantonese (Hong Kong)')).toBeInTheDocument();
    expect(screen.getByText('Infant Nutrition Guide')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search'), 'guide');
    expect(onQueryChange).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard row selection', async () => {
    const user = userEvent.setup();
    const { onSelectAsset } = renderPanel();

    const row = screen.getByText('Infant Nutrition Guide').closest('tr');
    expect(row).toBeTruthy();
    row?.focus();
    await user.keyboard('{Enter}');

    expect(onSelectAsset).toHaveBeenCalledWith('asset-1');
  });

  it('confirms deletion before invoking onDeleteAsset', async () => {
    const user = userEvent.setup();
    const { onDeleteAsset } = renderPanel();

    const row = screen.getByText('Infant Nutrition Guide').closest('tr');
    expect(row).toBeTruthy();
    const deleteButton = within(row as HTMLElement).getByRole('button', { name: 'Delete asset' });
    await user.click(deleteButton);

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDeleteAsset).toHaveBeenCalledWith('asset-1');
  });

  it('renders client document tag with green pill styling', () => {
    const clientAsset = createAdminAssetFixture({
      title: 'Client-facing PDF',
      tags: [{ id: 'tag-cli', name: CLIENT_DOCUMENT_ASSET_TAG, color: null }],
    });
    renderPanel({ assets: [clientAsset] });

    const tagPill = screen.getByText('Client').closest('span');
    expect(tagPill).toBeTruthy();
    expect(tagPill).toHaveClass('bg-green-100', 'text-green-900');
  });

  it('disables delete for assets tagged as expense attachments', () => {
    const expenseAsset = createAdminAssetFixture({
      title: 'Invoice PDF',
      tags: [{ id: 'tag-exp', name: 'expense_attachment', color: null }],
    });
    renderPanel({ assets: [expenseAsset] });

    const row = screen.getByText('Invoice PDF').closest('tr');
    expect(row).toBeTruthy();
    const deleteButton = within(row as HTMLElement).getByRole('button', {
      name: 'Cannot delete: asset is linked to expenses',
    });
    expect(deleteButton).toBeDisabled();
  });

  it('renders invoice tag with blue pill and disables delete', () => {
    const invoiceAsset = createAdminAssetFixture({
      title: 'INV-2026-000001 — Acme Family',
      tags: [{ id: 'tag-inv', name: 'customer_invoice', color: null }],
    });
    renderPanel({ assets: [invoiceAsset] });

    const tagPill = screen.getByText('Invoices').closest('span');
    expect(tagPill).toBeTruthy();
    expect(tagPill).toHaveClass('bg-blue-100', 'text-blue-900');

    const row = screen.getByText('INV-2026-000001 — Acme Family').closest('tr');
    expect(row).toBeTruthy();
    const deleteButton = within(row as HTMLElement).getByRole('button', {
      name: 'Cannot delete: asset is linked to customer invoices',
    });
    expect(deleteButton).toBeDisabled();
  });

  it('uses a search placeholder that mentions client', () => {
    renderPanel();
    expect(screen.getByLabelText('Search')).toHaveAttribute(
      'placeholder',
      'Title, file name, or client'
    );
  });
});
