import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetListPanel } from '@/components/admin/assets/asset-list-panel';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { CLIENT_DOCUMENT_ASSET_TAG, CUSTOMER_INVOICE_ASSET_TAG } from '@/types/assets';
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

function rowNamed(title: string): HTMLElement {
  const row = screen.getByText(title).closest('tr');
  expect(row).toBeTruthy();
  return row as HTMLElement;
}

function renderPanel(overrides: Partial<ComponentProps<typeof AssetListPanel>> = {}) {
  const onQueryChange = vi.fn();
  const onVisibilityChange = vi.fn();
  const onTagNameChange = vi.fn();
  const onLoadMore = vi.fn().mockResolvedValue(undefined);
  const onToggle = vi.fn();
  const onDeleteAsset = vi.fn().mockResolvedValue(undefined);
  const renderDetail = vi.fn((asset) => (
    <div data-testid='asset-detail'>{asset ? `Editing ${asset.title}` : 'Creating asset'}</div>
  ));

  render(
    <AssetListPanel
      assets={[FIXTURE_ASSET]}
      linkedTagNames={[]}
      expandedId={null}
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
      onToggle={onToggle}
      onDeleteAsset={onDeleteAsset}
      renderDetail={renderDetail}
      {...overrides}
    />
  );

  return {
    onQueryChange,
    onVisibilityChange,
    onTagNameChange,
    onLoadMore,
    onToggle,
    onDeleteAsset,
    renderDetail,
  };
}

describe('AssetListPanel', () => {
  beforeEach(() => {
    mockGetUserAssetDownloadUrl.mockReset();
  });

  it('renders the table first with filters, the create button, and no title', () => {
    renderPanel();

    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('button', { name: 'New asset' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Visibility')).toBeInTheDocument();
    expect(screen.getByLabelText('Tags')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByTestId('asset-detail')).not.toBeInTheDocument();
  });

  it('notifies the parent when the tag filter changes', async () => {
    const user = userEvent.setup();
    const { onTagNameChange } = renderPanel({
      linkedTagNames: [CLIENT_DOCUMENT_ASSET_TAG, CUSTOMER_INVOICE_ASSET_TAG],
      filters: { query: '', visibility: '', tagName: CLIENT_DOCUMENT_ASSET_TAG },
    });

    await user.selectOptions(screen.getByLabelText('Tags'), CUSTOMER_INVOICE_ASSET_TAG);

    expect(onTagNameChange).toHaveBeenCalledWith(CUSTOMER_INVOICE_ASSET_TAG);
  });

  it('opens asset in a new tab from the Operations column', async () => {
    const user = userEvent.setup();
    mockGetUserAssetDownloadUrl.mockResolvedValueOnce('https://cdn.example.com/file.pdf');
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { onToggle } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Open asset in new tab' }));

    expect(mockGetUserAssetDownloadUrl).toHaveBeenCalledWith('asset-1');
    expect(openSpy).toHaveBeenCalledWith('https://cdn.example.com/file.pdf', '_blank', 'noopener,noreferrer');
    expect(onToggle).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it('renders table data and handles filter and load-more actions', async () => {
    const user = userEvent.setup();
    const { onQueryChange, onLoadMore } = renderPanel({
      assets: [createAdminAssetFixture({ ...FIXTURE_ASSET, contentLanguage: 'zh-HK' })],
    });

    expect(screen.queryByRole('columnheader', { name: 'File' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByText('Cantonese (Hong Kong)')).toBeInTheDocument();
    expect(screen.getByText('Infant Nutrition Guide')).toBeInTheDocument();
    expect(screen.queryByText(FIXTURE_ASSET.id)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Search'), 'guide');
    expect(onQueryChange).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('toggles a row from its expand control and from the keyboard', async () => {
    const user = userEvent.setup();
    const { onToggle } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Expand Infant Nutrition Guide' }));
    expect(onToggle).toHaveBeenCalledWith('asset-1');

    rowNamed('Infant Nutrition Guide').focus();
    await user.keyboard('{Enter}');
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('renders the editor inside the expanded row', () => {
    const { renderDetail } = renderPanel({ expandedId: 'asset-1' });

    expect(renderDetail).toHaveBeenCalledWith(FIXTURE_ASSET);
    const row = rowNamed('Infant Nutrition Guide');
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(row).toHaveClass('admin-row-framed');
    expect(screen.getByText('Editing Infant Nutrition Guide')).toBeInTheDocument();
  });

  it('shows the draft row with the create editor when the draft is open', () => {
    const { renderDetail } = renderPanel({ expandedId: DRAFT_RECORD_ID });

    expect(renderDetail).toHaveBeenCalledWith(null);
    expect(screen.getByRole('button', { name: 'New asset' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(`admin-row-${DRAFT_RECORD_ID}`)).toHaveAttribute('data-draft', 'true');
    expect(screen.getByText('Creating asset')).toBeInTheDocument();
  });

  it('asks the parent to open the draft from the create button', async () => {
    const user = userEvent.setup();
    const { onToggle } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'New asset' }));
    expect(onToggle).toHaveBeenCalledWith(DRAFT_RECORD_ID);
  });

  it('renders a deep-linked asset that is not in the loaded pages above the list', () => {
    const pinned = createAdminAssetFixture({ id: 'asset-pinned', title: 'Pinned Guide' });
    renderPanel({ pinnedAsset: pinned, expandedId: 'asset-pinned' });

    const rows = screen.getAllByRole('row').filter((row) => row.hasAttribute('aria-expanded'));
    expect(rows[0]).toHaveTextContent('Pinned Guide');
    expect(rows[1]).toHaveTextContent('Infant Nutrition Guide');
  });

  it('confirms deletion before invoking onDeleteAsset without toggling the row', async () => {
    const user = userEvent.setup();
    const { onDeleteAsset, onToggle } = renderPanel();

    const deleteButton = within(rowNamed('Infant Nutrition Guide')).getByRole('button', { name: 'Delete asset' });
    await user.click(deleteButton);

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDeleteAsset).toHaveBeenCalledWith('asset-1');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('renders client document tag with green pill styling', () => {
    const clientAsset = createAdminAssetFixture({
      title: 'Client-facing PDF',
      tags: [{ id: 'tag-cli', name: CLIENT_DOCUMENT_ASSET_TAG, color: null }],
    });
    renderPanel({ assets: [clientAsset] });

    const tagPill = screen.getByText('Client', { selector: 'span.rounded' });
    expect(tagPill).toHaveClass('bg-green-100', 'text-green-900');
  });

  it('disables delete for assets tagged as expense attachments', () => {
    const expenseAsset = createAdminAssetFixture({
      title: 'Invoice PDF',
      tags: [{ id: 'tag-exp', name: 'expense_attachment', color: null }],
    });
    renderPanel({ assets: [expenseAsset] });

    const deleteButton = within(rowNamed('Invoice PDF')).getByRole('button', {
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

    const tagPill = screen.getByText('Invoices', { selector: 'span.rounded' });
    expect(tagPill).toHaveClass('bg-blue-100', 'text-blue-900');

    const deleteButton = within(rowNamed('INV-2026-000001 — Acme Family')).getByRole('button', {
      name: 'Cannot delete: asset is linked to customer invoices',
    });
    expect(deleteButton).toBeDisabled();
  });

  it('hides Tags, Language, and Updated columns on phones and keeps visibility and tags in a meta line', () => {
    const clientAsset = createAdminAssetFixture({
      title: 'Client-facing PDF',
      visibility: 'public',
      tags: [{ id: 'tag-cli', name: CLIENT_DOCUMENT_ASSET_TAG, color: null }],
    });
    renderPanel({ assets: [clientAsset] });

    expect(screen.queryByRole('columnheader', { name: 'File' })).not.toBeInTheDocument();
    expect(screen.queryByText(clientAsset.fileName)).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tags' })).toHaveClass('hidden', 'md:table-cell');
    expect(screen.getByRole('columnheader', { name: 'Language' })).toHaveClass('hidden', 'lg:table-cell');
    expect(screen.getByRole('columnheader', { name: 'Updated' })).toHaveClass('hidden', 'lg:table-cell');
    expect(screen.getByText('Public · Client')).toHaveClass('md:hidden');
  });

  it('uses a search placeholder that mentions client', () => {
    renderPanel();
    expect(screen.getByLabelText('Search')).toHaveAttribute('placeholder', 'Title, file name, or client');
  });
});
