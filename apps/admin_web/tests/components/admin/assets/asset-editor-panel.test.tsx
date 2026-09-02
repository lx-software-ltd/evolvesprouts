import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetAdminAssetShareLink,
  mockGetOrCreateAdminAssetShareLink,
  mockRotateAdminAssetShareLink,
  mockRevokeAdminAssetShareLink,
} = vi.hoisted(() => ({
  mockGetAdminAssetShareLink: vi.fn(),
  mockGetOrCreateAdminAssetShareLink: vi.fn(),
  mockRotateAdminAssetShareLink: vi.fn(),
  mockRevokeAdminAssetShareLink: vi.fn(),
}));

vi.mock('@/lib/assets-api', () => ({
  getAdminAssetShareLink: mockGetAdminAssetShareLink,
  getOrCreateAdminAssetShareLink: mockGetOrCreateAdminAssetShareLink,
  rotateAdminAssetShareLink: mockRotateAdminAssetShareLink,
  revokeAdminAssetShareLink: mockRevokeAdminAssetShareLink,
}));

import { AssetEditorPanel } from '@/components/admin/assets/asset-editor-panel';
import { CLIENT_DOCUMENT_ASSET_TAG } from '@/types/assets';

import { createAdminAssetFixture } from '../../../fixtures/assets';

const SELECTED_ASSET = createAdminAssetFixture({
  description: 'Original description',
});

function renderEditor(overrides: Partial<ComponentProps<typeof AssetEditorPanel>> = {}) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  const onUpdate = vi.fn().mockResolvedValue(true);
  const onReplaceFile = vi.fn().mockResolvedValue(true);
  const onStartCreate = vi.fn();
  const onRetryUpload = vi.fn().mockResolvedValue(undefined);

  render(
    <AssetEditorPanel
      selectedAsset={null}
      isSavingAsset={false}
      isDeletingCurrentAsset={false}
      assetMutationError=''
      uploadState='idle'
      uploadPhase={null}
      uploadError=''
      hasPendingUpload={false}
      onRetryUpload={onRetryUpload}
      onReplaceFile={onReplaceFile}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onStartCreate={onStartCreate}
      {...overrides}
    />
  );

  return { onCreate, onUpdate, onReplaceFile, onStartCreate, onRetryUpload };
}

describe('AssetEditorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminAssetShareLink.mockResolvedValue({
      assetId: 'asset-1',
      shareUrl: 'https://share.example.com/a',
      allowedDomains: ['example.com'],
    });
    mockGetOrCreateAdminAssetShareLink.mockResolvedValue({
      assetId: 'asset-1',
      shareUrl: 'https://share.example.com/a',
      allowedDomains: ['example.com'],
    });
    mockRotateAdminAssetShareLink.mockResolvedValue({
      assetId: 'asset-1',
      shareUrl: 'https://share.example.com/b',
      allowedDomains: ['example.com'],
    });
    mockRevokeAdminAssetShareLink.mockResolvedValue(undefined);
  });

  it('validates create form and enforces PDF uploads', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderEditor();

    await user.type(screen.getByLabelText('Title *'), 'New guide');
    await user.click(screen.getByRole('button', { name: 'Create asset' }));

    expect(screen.getByText('Select a PDF file to upload.')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();

    const fileInput = screen.getByLabelText('Upload PDF file');
    const invalidPdfFile = new File(['hello'], 'notes.pdf', { type: 'text/plain' });
    await user.upload(fileInput, invalidPdfFile);
    await user.click(screen.getByRole('button', { name: 'Create asset' }));

    expect(screen.getByText('Only PDF files are allowed.')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('submits create payload with content_language when Language is selected', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderEditor();

    await user.type(screen.getByLabelText('Title *'), 'New guide');
    const fileInput = screen.getByLabelText('Upload PDF file');
    const pdf = new File(['%PDF-1.4'], 'guide.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, pdf);
    await user.selectOptions(screen.getByLabelText('Language'), 'zh-HK');
    await user.click(screen.getByRole('button', { name: 'Create asset' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New guide',
          contentLanguage: 'zh-HK',
        }),
        pdf
      );
    });
  });

  it('submits create payload with client_tag when Client is selected', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderEditor();

    await user.type(screen.getByLabelText('Title *'), 'New guide');
    const fileInput = screen.getByLabelText('Upload PDF file');
    const pdf = new File(['%PDF-1.4'], 'guide.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, pdf);
    await user.selectOptions(screen.getByLabelText('Tag'), CLIENT_DOCUMENT_ASSET_TAG);
    await user.click(screen.getByRole('button', { name: 'Create asset' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New guide',
          clientTag: CLIENT_DOCUMENT_ASSET_TAG,
        }),
        pdf
      );
    });
  });

  it('shows create mode when no asset is selected', () => {
    renderEditor();

    expect(screen.getByRole('heading', { name: 'Create Asset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create asset' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Create a new PDF asset or select a row below to edit/)
    ).toBeInTheDocument();
  });

  it('returns to create mode when Cancel is clicked in edit mode', async () => {
    const user = userEvent.setup();
    const { onStartCreate } = renderEditor({ selectedAsset: SELECTED_ASSET });

    expect(screen.getByRole('heading', { name: 'Edit Asset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.getByText(/Cancel to create a new asset/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onStartCreate).toHaveBeenCalledTimes(1);
  });

  it('shows validation when save is clicked with no changes in edit mode', async () => {
    const user = userEvent.setup();
    renderEditor({ selectedAsset: SELECTED_ASSET });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('No changes to save.')).toBeInTheDocument();
  });

  it('submits update payload in edit mode', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor({ selectedAsset: SELECTED_ASSET });

    const titleInput = screen.getByLabelText('Title *');
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated title');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('asset-1', { title: 'Updated title' });
    });
  });

  it('submits client_tag when Client tag is selected on update', async () => {
    const user = userEvent.setup();
    const assetWithoutClient = createAdminAssetFixture({
      tags: [],
    });
    const { onUpdate } = renderEditor({ selectedAsset: assetWithoutClient });

    await user.selectOptions(screen.getByLabelText('Tag'), CLIENT_DOCUMENT_ASSET_TAG);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('asset-1', {
        clientTag: CLIENT_DOCUMENT_ASSET_TAG,
      });
    });
  });

  it('calls onReplaceFile before onUpdate when both metadata and replacement file change', async () => {
    const user = userEvent.setup();
    const callOrder: string[] = [];
    const onReplaceFile = vi.fn(async () => {
      callOrder.push('replace');
      return true;
    });
    const onUpdate = vi.fn(async () => {
      callOrder.push('update');
      return true;
    });
    renderEditor({ selectedAsset: SELECTED_ASSET, onReplaceFile, onUpdate });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });

    const titleInput = screen.getByLabelText('Title *');
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated title');

    const replaceInput = screen.getByLabelText('Replace PDF file');
    const pdf = new File(['%PDF-1.4'], 'new-guide.pdf', { type: 'application/pdf' });
    await user.upload(replaceInput, pdf);
    await user.click(screen.getByRole('button', { name: 'Save and replace' }));

    await waitFor(() => {
      expect(onReplaceFile).toHaveBeenCalledWith(pdf);
      expect(onUpdate).toHaveBeenCalled();
    });
    expect(callOrder).toEqual(['replace', 'update']);
  });

  it('skips metadata update when replace fails', async () => {
    const user = userEvent.setup();
    const onReplaceFile = vi.fn().mockResolvedValue(false);
    const onUpdate = vi.fn().mockResolvedValue(true);
    renderEditor({ selectedAsset: SELECTED_ASSET, onReplaceFile, onUpdate });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });

    const titleInput = screen.getByLabelText('Title *');
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated title');

    const replaceInput = screen.getByLabelText('Replace PDF file');
    const pdf = new File(['%PDF-1.4'], 'new-guide.pdf', { type: 'application/pdf' });
    await user.upload(replaceInput, pdf);
    await user.click(screen.getByRole('button', { name: 'Save and replace' }));

    await waitFor(() => {
      expect(onReplaceFile).toHaveBeenCalled();
    });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(
      screen.getByText(/File replacement did not finish, so metadata was not saved/)
    ).toBeInTheDocument();
  });

  it('shows finalize copy when uploadPhase is complete', () => {
    renderEditor({
      selectedAsset: SELECTED_ASSET,
      uploadState: 'uploading',
      uploadPhase: 'complete',
    });

    expect(screen.getByText('Finalizing file replacement...')).toBeInTheDocument();
  });

  it('does not show replace PDF control for expense-linked assets', async () => {
    const expenseAsset = createAdminAssetFixture({
      tags: [{ id: 't1', name: 'expense_attachment', color: null }],
    });
    renderEditor({ selectedAsset: expenseAsset });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });

    expect(screen.queryByLabelText('Replace PDF file')).not.toBeInTheDocument();
  });

  it('locks visibility for expense-linked assets', async () => {
    const expenseAsset = createAdminAssetFixture({
      visibility: 'restricted',
      tags: [{ id: 't1', name: 'expense_attachment', color: null }],
    });
    renderEditor({ selectedAsset: expenseAsset });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });

    expect(screen.getByLabelText('Visibility *')).toBeDisabled();
  });

  it('does not show replace PDF control for invoice-linked assets', async () => {
    const invoiceAsset = createAdminAssetFixture({
      tags: [{ id: 't1', name: 'customer_invoice', color: null }],
    });
    renderEditor({ selectedAsset: invoiceAsset });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });

    expect(screen.queryByLabelText('Replace PDF file')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Visibility *')).toBeDisabled();
    expect(
      screen.getByLabelText('Tag (linked to customer invoice; not editable)')
    ).toBeDisabled();
  });

  it('disables tag select and omits client_tag when asset is expense-linked', async () => {
    const user = userEvent.setup();
    const expenseAsset = createAdminAssetFixture({
      tags: [{ id: 't1', name: 'expense_attachment', color: null }],
    });
    const { onUpdate } = renderEditor({ selectedAsset: expenseAsset });

    expect(screen.getByLabelText('Tag (linked to expense; not editable)')).toBeDisabled();

    const titleInput = screen.getByLabelText('Title *');
    await user.clear(titleInput);
    await user.type(titleInput, 'Expense-linked title');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
      const payload = onUpdate.mock.calls[0][1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('clientTag');
      expect(Object.keys(payload)).toEqual(['title']);
    });
  });

  it('removes the deprecated resource-key helper copy', async () => {
    renderEditor({ selectedAsset: SELECTED_ASSET });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });

    expect(
      screen.queryByText('Optional slug for mapping public media form submissions to this asset.')
    ).not.toBeInTheDocument();
  });

  it('renders share-link domain allowlist as a full-width row in edit mode', async () => {
    renderEditor({ selectedAsset: SELECTED_ASSET });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });

    const allowlistInput = screen.getByLabelText('Share-link domain allowlist');
    expect(allowlistInput.closest('div')).toHaveClass('lg:col-span-2');
  });

  it('removes share-link helper copy and keeps save policy below textarea', async () => {
    renderEditor({ selectedAsset: SELECTED_ASSET });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });

    expect(
      screen.queryByText(
        'One domain per line (or comma-separated). Share links resolve only when Referer/Origin matches one of these domains.'
      )
    ).not.toBeInTheDocument();

    const allowlistInput = screen.getByLabelText('Share-link domain allowlist');
    const savePolicyButton = screen.getByRole('button', { name: 'Save domain policy' });
    const savePolicyRow = savePolicyButton.closest('div');
    expect(savePolicyRow).toHaveClass('flex');
    expect(savePolicyRow).toHaveClass('justify-end');

    const allDivs = Array.from(document.querySelectorAll('div'));
    const inputIndex = allDivs.findIndex((element) => element.contains(allowlistInput));
    const buttonRowIndex = allDivs.findIndex((element) => element === savePolicyRow);
    expect(buttonRowIndex).toBeGreaterThan(inputIndex);
  });

  it('runs copy, rotate, and revoke share-link actions', async () => {
    const user = userEvent.setup();
    renderEditor({ selectedAsset: SELECTED_ASSET });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => {
      expect(mockGetOrCreateAdminAssetShareLink).toHaveBeenCalledWith('asset-1', {
        allowedDomains: ['example.com'],
      });
    });

    await user.click(screen.getByRole('button', { name: 'Rotate link' }));
    await user.click(screen.getByRole('button', { name: 'Rotate' }));
    await waitFor(() => {
      expect(mockRotateAdminAssetShareLink).toHaveBeenCalledWith('asset-1', {
        allowedDomains: ['example.com'],
      });
    });

    await user.click(screen.getByRole('button', { name: 'Delete link' }));
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => {
      expect(mockRevokeAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });
  });
});
