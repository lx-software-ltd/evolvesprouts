import { render, screen, waitFor, within } from '@testing-library/react';
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
      {...overrides}
    />
  );

  return { onCreate, onUpdate, onReplaceFile, onRetryUpload };
}

describe('AssetEditorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminAssetShareLink.mockResolvedValue({
      assetId: 'asset-1',
      shareUrl: 'https://media.example.com/v1/assets/share/abc123token',
      allowedDomains: ['example.com'],
    });
    mockGetOrCreateAdminAssetShareLink.mockResolvedValue({
      assetId: 'asset-1',
      shareUrl: 'https://media.example.com/v1/assets/share/abc123token',
      allowedDomains: ['example.com'],
    });
    mockRotateAdminAssetShareLink.mockResolvedValue({
      assetId: 'asset-1',
      shareUrl: 'https://media.example.com/v1/assets/share/rotatedtoken',
      allowedDomains: ['example.com'],
    });
    mockRevokeAdminAssetShareLink.mockResolvedValue(undefined);
  });

  it('validates create form and enforces PDF uploads', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderEditor();

    await user.type(screen.getByLabelText('Title'), 'New guide');
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

    await user.type(screen.getByLabelText('Title'), 'New guide');
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

    await user.type(screen.getByLabelText('Title'), 'New guide');
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

  it('renders the create editor with no title, no Cancel, and the standard field grid', () => {
    renderEditor();

    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create asset' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByText(/select a row below to edit/)).not.toBeInTheDocument();

    const titleField = screen.getByLabelText('Title').closest('div');
    expect(titleField).toHaveClass('sm:col-span-2');
    expect(titleField?.parentElement).toHaveAttribute('data-columns', '4');
    expect(screen.getByLabelText('Description').closest('div')).toHaveClass('col-span-full');
    expect(screen.queryByRole('button', { name: /Share link/ })).toBeNull();
  });

  it('renders the edit editor with no title or Cancel and a collapsed Share link sub-accordion', () => {
    renderEditor({ selectedAsset: SELECTED_ASSET });

    // The only heading is the Share link sub-accordion trigger; no panel title.
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Share link']);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current file')).toHaveValue('infant-guide.pdf');
    expect(screen.getByRole('button', { name: /Share link/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('reports dirty state to the row guard and clears it on submit', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderEditor({ selectedAsset: SELECTED_ASSET, onDirtyChange });

    const titleInput = screen.getByLabelText('Title');
    await user.type(titleInput, '!');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });
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

    const titleInput = screen.getByLabelText('Title');
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

    const titleInput = screen.getByLabelText('Title');
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

    const titleInput = screen.getByLabelText('Title');
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

    expect(screen.getByLabelText('Visibility')).toBeDisabled();
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
    expect(screen.getByLabelText('Visibility')).toBeDisabled();
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

    const titleInput = screen.getByLabelText('Title');
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

  it('keeps the share-link controls inside the Share link sub-accordion in edit mode', async () => {
    const user = userEvent.setup();
    renderEditor({ selectedAsset: SELECTED_ASSET });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });

    await user.click(screen.getByRole('button', { name: /Share link/ }));

    const disclosure = screen.getByTestId('asset-share-link-asset-1-disclosure');
    expect(within(disclosure).getByLabelText('Share-link domain allowlist')).toBeInTheDocument();
    expect(within(disclosure).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(within(disclosure).getByRole('button', { name: 'Link for Email' })).toBeInTheDocument();
    expect(within(disclosure).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(within(disclosure).getByRole('button', { name: 'Delete links' })).toBeInTheDocument();
    expect(within(disclosure).queryByText('Links', { selector: 'label' })).not.toBeInTheDocument();
  });

  it('removes share-link helper copy and keeps save policy left-aligned below textarea', async () => {
    const user = userEvent.setup();
    renderEditor({ selectedAsset: SELECTED_ASSET });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });
    await user.click(screen.getByRole('button', { name: /Share link/ }));

    expect(
      screen.queryByText(
        'One domain per line (or comma-separated). Share links resolve only when Referer/Origin matches one of these domains.'
      )
    ).not.toBeInTheDocument();

    const allowlistInput = screen.getByLabelText('Share-link domain allowlist');
    const savePolicyButton = screen.getByRole('button', { name: 'Save policy' });
    const savePolicyRow = savePolicyButton.closest('div');
    expect(savePolicyRow).toHaveClass('flex');
    expect(savePolicyRow).toHaveClass('justify-start');

    const allDivs = Array.from(document.querySelectorAll('div'));
    const inputIndex = allDivs.findIndex((element) => element.contains(allowlistInput));
    const buttonRowIndex = allDivs.findIndex((element) => element === savePolicyRow);
    expect(buttonRowIndex).toBeGreaterThan(inputIndex);

    const shareSection = savePolicyButton.closest('.space-y-4');
    expect(shareSection).not.toBeNull();
    expect(shareSection).toHaveClass('space-y-4');
  });

  it('runs copy, refresh, and revoke share-link actions', async () => {
    const user = userEvent.setup();
    renderEditor({ selectedAsset: SELECTED_ASSET });

    await waitFor(() => {
      expect(mockGetAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });
    await user.click(screen.getByRole('button', { name: /Share link/ }));

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => {
      expect(mockGetOrCreateAdminAssetShareLink).toHaveBeenCalledWith('asset-1', {
        allowedDomains: ['example.com'],
      });
    });

    await user.click(screen.getByRole('button', { name: 'Link for Email' }));
    await waitFor(() => {
      expect(mockGetOrCreateAdminAssetShareLink).toHaveBeenCalledTimes(2);
    });

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await user.click(screen.getByRole('button', { name: 'Rotate' }));
    await waitFor(() => {
      expect(mockRotateAdminAssetShareLink).toHaveBeenCalledWith('asset-1', {
        allowedDomains: ['example.com'],
      });
    });

    await user.click(screen.getByRole('button', { name: 'Delete links' }));
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => {
      expect(mockRevokeAdminAssetShareLink).toHaveBeenCalledWith('asset-1');
    });
  });
});
