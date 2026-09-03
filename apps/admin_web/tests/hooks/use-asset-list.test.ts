import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListAdminAssets, mockGetAdminAsset } = vi.hoisted(() => ({
  mockListAdminAssets: vi.fn(),
  mockGetAdminAsset: vi.fn(),
}));

vi.mock('@/lib/assets-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/assets-api')>('@/lib/assets-api');
  return {
    ...actual,
    listAdminAssets: mockListAdminAssets,
    getAdminAsset: mockGetAdminAsset,
  };
});

import { ADMIN_ASSET_QUERY_PARAM, useAssetList } from '@/hooks/use-asset-list';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { CLIENT_DOCUMENT_ASSET_TAG, CUSTOMER_INVOICE_ASSET_TAG } from '@/types/assets';

import { createAdminAssetFixture } from '../fixtures/assets';

function setLocation(pathAndQuery: string) {
  window.history.replaceState(null, '', pathAndQuery);
}

function currentAssetParam(): string | null {
  return new URLSearchParams(window.location.search).get(ADMIN_ASSET_QUERY_PARAM);
}

describe('useAssetList', () => {
  beforeEach(() => {
    setLocation('/assets');
    mockListAdminAssets.mockReset();
    mockGetAdminAsset.mockReset();
    mockGetAdminAsset.mockRejectedValue(new Error('not found'));
    mockListAdminAssets.mockResolvedValue({
      items: [],
      nextCursor: null,
      linkedTagNames: [CLIENT_DOCUMENT_ASSET_TAG, CUSTOMER_INVOICE_ASSET_TAG],
    });
  });

  afterEach(() => {
    setLocation('/assets');
  });

  it('defaults to the client document tag when the URL has no filters', async () => {
    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(mockListAdminAssets).toHaveBeenCalled();
    });

    expect(result.current.filters).toEqual({
      query: '',
      visibility: '',
      tagName: CLIENT_DOCUMENT_ASSET_TAG,
    });
    expect(mockListAdminAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '',
        tagName: CLIENT_DOCUMENT_ASSET_TAG,
        assetType: 'document',
      })
    );
  });

  it('seeds tag and search from the assets invoice deep-link query', async () => {
    setLocation('/assets?tag=customer_invoice&query=Linked+Person');

    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(mockListAdminAssets).toHaveBeenCalled();
    });

    expect(result.current.filters.tagName).toBe(CUSTOMER_INVOICE_ASSET_TAG);
    expect(result.current.filters.query).toBe('Linked Person');
    expect(mockListAdminAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'Linked Person',
        tagName: CUSTOMER_INVOICE_ASSET_TAG,
        assetType: 'document',
      })
    );
  });

  it('applies a user-selected tag filter without resetting to the Client default', async () => {
    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(mockListAdminAssets).toHaveBeenCalled();
    });

    mockListAdminAssets.mockClear();
    act(() => {
      result.current.setTagNameFilter(CUSTOMER_INVOICE_ASSET_TAG);
    });

    await waitFor(() => {
      expect(result.current.filters.tagName).toBe(CUSTOMER_INVOICE_ASSET_TAG);
    });
    expect(mockListAdminAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        tagName: CUSTOMER_INVOICE_ASSET_TAG,
      })
    );
  });

  it('lists all tags when the user clears the tag filter', async () => {
    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(result.current.filters.tagName).toBe(CLIENT_DOCUMENT_ASSET_TAG);
    });

    mockListAdminAssets.mockClear();
    act(() => {
      result.current.setTagNameFilter('');
    });

    await waitFor(() => {
      expect(result.current.filters.tagName).toBe('');
    });
    expect(mockListAdminAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        tagName: '',
      })
    );
  });

  it('keeps a user-typed search query when the URL has no query param', async () => {
    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(mockListAdminAssets).toHaveBeenCalled();
    });

    act(() => {
      result.current.setQueryFilter('nutrition');
    });

    await waitFor(() => {
      expect(result.current.filters.query).toBe('nutrition');
    });
  });

  it('applies a later URL change to tag and query', async () => {
    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(mockListAdminAssets).toHaveBeenCalled();
    });

    mockListAdminAssets.mockClear();
    act(() => {
      setLocation('/assets?tag=customer_invoice&query=Linked+Org');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(result.current.filters.query).toBe('Linked Org');
    });
    expect(result.current.filters.tagName).toBe(CUSTOMER_INVOICE_ASSET_TAG);
    expect(mockListAdminAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'Linked Org',
        tagName: CUSTOMER_INVOICE_ASSET_TAG,
      })
    );
  });

  it('starts in create mode and does not auto-select the first listed asset', async () => {
    const first = createAdminAssetFixture({ id: 'asset-first', title: 'First' });
    const second = createAdminAssetFixture({ id: 'asset-second', title: 'Second' });
    mockListAdminAssets.mockResolvedValue({
      items: [first, second],
      nextCursor: null,
      linkedTagNames: [CLIENT_DOCUMENT_ASSET_TAG],
    });

    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(result.current.assets).toEqual([first, second]);
    });

    expect(result.current.selectedAssetId).toBeNull();
    expect(result.current.selectedAsset).toBeNull();
  });

  it('selects a row for edit and returns to create mode when selection is cleared', async () => {
    const first = createAdminAssetFixture({ id: 'asset-first', title: 'First' });
    const second = createAdminAssetFixture({ id: 'asset-second', title: 'Second' });
    mockListAdminAssets.mockResolvedValue({
      items: [first, second],
      nextCursor: null,
      linkedTagNames: [CLIENT_DOCUMENT_ASSET_TAG],
    });

    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(result.current.assets).toHaveLength(2);
    });

    act(() => {
      result.current.selectAsset('asset-second');
    });

    expect(result.current.selectedAssetId).toBe('asset-second');
    expect(result.current.selectedAsset).toEqual(second);
    expect(result.current.expanded.expandedId).toBe('asset-second');
    expect(currentAssetParam()).toBe('asset-second');

    act(() => {
      result.current.clearSelectedAsset();
    });

    expect(result.current.selectedAssetId).toBeNull();
    expect(result.current.selectedAsset).toBeNull();
    expect(currentAssetParam()).toBeNull();
  });

  it('opens the draft row without selecting an asset', async () => {
    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(mockListAdminAssets).toHaveBeenCalled();
    });

    act(() => {
      result.current.expanded.openDraft();
    });

    expect(result.current.expanded.isDraftOpen).toBe(true);
    expect(result.current.expanded.expandedId).toBe(DRAFT_RECORD_ID);
    expect(result.current.selectedAssetId).toBeNull();
    expect(result.current.selectedAsset).toBeNull();
  });

  it('restores a deep-linked asset that is not in the loaded pages by fetching and pinning it', async () => {
    const first = createAdminAssetFixture({ id: 'asset-first', title: 'First' });
    const pinned = createAdminAssetFixture({ id: 'asset-pinned', title: 'Pinned' });
    mockListAdminAssets.mockResolvedValue({
      items: [first],
      nextCursor: null,
      linkedTagNames: [CLIENT_DOCUMENT_ASSET_TAG],
    });
    mockGetAdminAsset.mockResolvedValue(pinned);
    setLocation(`/assets?${ADMIN_ASSET_QUERY_PARAM}=asset-pinned`);

    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(result.current.pinnedAsset).toEqual(pinned);
    });

    expect(mockGetAdminAsset).toHaveBeenCalledWith('asset-pinned');
    expect(result.current.selectedAssetId).toBe('asset-pinned');
    expect(result.current.selectedAsset).toEqual(pinned);
    expect(result.current.assets).toEqual([first]);
  });

  it('collapses a selection that cannot be resolved', async () => {
    const first = createAdminAssetFixture({ id: 'asset-first', title: 'First' });
    mockListAdminAssets.mockResolvedValue({
      items: [first],
      nextCursor: null,
      linkedTagNames: [CLIENT_DOCUMENT_ASSET_TAG],
    });

    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(result.current.assets).toEqual([first]);
    });

    act(() => {
      result.current.selectAsset('asset-missing');
    });

    await waitFor(() => {
      expect(mockGetAdminAsset).toHaveBeenCalledWith('asset-missing');
    });
    await waitFor(() => {
      expect(result.current.expanded.expandedId).toBeNull();
    });
    expect(result.current.selectedAssetId).toBeNull();
    expect(result.current.selectedAsset).toBeNull();
  });

  it('asks before switching rows while the editor has unsaved changes', async () => {
    const first = createAdminAssetFixture({ id: 'asset-first', title: 'First' });
    const second = createAdminAssetFixture({ id: 'asset-second', title: 'Second' });
    mockListAdminAssets.mockResolvedValue({
      items: [first, second],
      nextCursor: null,
      linkedTagNames: [CLIENT_DOCUMENT_ASSET_TAG],
    });

    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(result.current.assets).toHaveLength(2);
    });

    act(() => {
      result.current.selectAsset('asset-first');
    });
    act(() => {
      result.current.setEditorDirty(true);
    });
    act(() => {
      result.current.selectAsset('asset-second');
    });

    expect(result.current.expanded.discardPrompt.open).toBe(true);
    expect(result.current.selectedAssetId).toBe('asset-first');

    act(() => {
      result.current.expanded.discardPrompt.confirm();
    });

    expect(result.current.selectedAssetId).toBe('asset-second');
  });

  it('clears selection when the selected asset is no longer in the list', async () => {
    const remaining = createAdminAssetFixture({ id: 'asset-remaining', title: 'Remaining' });
    mockListAdminAssets.mockResolvedValue({
      items: [
        createAdminAssetFixture({ id: 'asset-gone', title: 'Gone' }),
        remaining,
      ],
      nextCursor: null,
      linkedTagNames: [CLIENT_DOCUMENT_ASSET_TAG],
    });

    const { result } = renderHook(() => useAssetList());

    await waitFor(() => {
      expect(result.current.assets).toHaveLength(2);
    });

    act(() => {
      result.current.selectAsset('asset-gone');
    });

    expect(result.current.selectedAssetId).toBe('asset-gone');

    act(() => {
      result.current.applyDeletedAsset('asset-gone');
    });

    expect(result.current.selectedAssetId).toBeNull();
    expect(result.current.selectedAsset).toBeNull();
    expect(result.current.assets).toEqual([remaining]);
  });
});
