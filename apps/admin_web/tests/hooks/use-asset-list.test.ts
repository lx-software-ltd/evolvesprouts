import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListAdminAssets } = vi.hoisted(() => ({
  mockListAdminAssets: vi.fn(),
}));

vi.mock('@/lib/assets-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/assets-api')>('@/lib/assets-api');
  return {
    ...actual,
    listAdminAssets: mockListAdminAssets,
  };
});

import { useAssetList } from '@/hooks/use-asset-list';
import { CLIENT_DOCUMENT_ASSET_TAG, CUSTOMER_INVOICE_ASSET_TAG } from '@/types/assets';

function setLocation(pathAndQuery: string) {
  window.history.replaceState(null, '', pathAndQuery);
}

describe('useAssetList', () => {
  beforeEach(() => {
    setLocation('/assets');
    mockListAdminAssets.mockReset();
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
});
