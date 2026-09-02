import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAdminApiRequest } = vi.hoisted(() => ({
  mockAdminApiRequest: vi.fn(),
}));

vi.mock('@/lib/api-admin-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-admin-client')>(
    '@/lib/api-admin-client'
  );
  return {
    ...actual,
    adminApiRequest: mockAdminApiRequest,
  };
});

import {
  completeAdminAssetContentReplace,
  createAdminAsset,
  getUserAssetDownloadUrl,
  initAdminAssetContentReplace,
  listAdminAssetGrants,
  listAdminAssets,
  updateAdminAsset,
  uploadFileToPresignedUrl,
} from '@/lib/assets-api';

describe('assets-api', () => {
  beforeEach(() => {
    mockAdminApiRequest.mockReset();
    vi.mocked(fetch).mockReset();
  });

  it('lists assets using snake_case payload and query params', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'asset-1',
          title: 'Infant guide',
          description: null,
          asset_type: 'document',
          s3_key: 'assets/infant-guide.pdf',
          file_name: 'infant-guide.pdf',
          content_type: 'application/pdf',
          content_language: null,
          visibility: 'restricted',
          created_by: 'admin@example.com',
          created_at: '2026-02-27T00:00:00.000Z',
          updated_at: '2026-02-27T00:00:00.000Z',
          tags: [],
        },
      ],
      next_cursor: 'cursor-1',
      linked_tag_names: ['expense_attachment', 'custom_tag'],
    });

    const result = await listAdminAssets({
      query: '  infant ',
      visibility: 'restricted',
      assetType: 'document',
      cursor: 'abc',
      limit: 10,
    });

    expect(result.nextCursor).toBe('cursor-1');
    expect(result.linkedTagNames).toEqual(['expense_attachment', 'custom_tag']);
    expect(result.items[0]).toMatchObject({
      id: 'asset-1',
      assetType: 'document',
      s3Key: 'assets/infant-guide.pdf',
      fileName: 'infant-guide.pdf',
      resourceKey: null,
      contentLanguage: null,
      visibility: 'restricted',
    });

    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        endpointPath: expect.stringContaining('/v1/admin/assets?'),
      })
    );

    const request = mockAdminApiRequest.mock.calls[0][0];
    expect(request.endpointPath).toContain('query=infant');
    expect(request.endpointPath).toContain('visibility=restricted');
    expect(request.endpointPath).toContain('asset_type=document');
    expect(request.endpointPath).toContain('cursor=abc');
    expect(request.endpointPath).toContain('limit=10');
  });

  it('includes tag_name query param when filtering by tag', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      items: [],
      next_cursor: null,
    });

    await listAdminAssets({ tagName: 'expense_attachment' });

    const request = mockAdminApiRequest.mock.calls[0][0];
    expect(request.endpointPath).toContain('tag_name=expense_attachment');
  });

  it('includes tag_name for arbitrary linked tag filters', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      items: [],
      next_cursor: null,
    });

    await listAdminAssets({ tagName: 'custom_tag' });

    const request = mockAdminApiRequest.mock.calls[0][0];
    expect(request.endpointPath).toContain('tag_name=custom_tag');
  });

  it('creates asset with snake_case request body and parses upload details', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      asset: {
        id: 'asset-2',
        title: 'Nutrition PDF',
        description: null,
        asset_type: 'document',
        s3_key: 'assets/nutrition.pdf',
        file_name: 'nutrition.pdf',
        content_type: 'application/pdf',
        visibility: 'public',
        created_by: null,
        created_at: null,
        updated_at: null,
        tags: [],
      },
      upload_url: 'https://uploads.example.com/asset-2',
      upload_method: 'PUT',
      upload_headers: {
        'x-amz-acl': 'private',
      },
      expires_at: '2026-02-28T00:00:00.000Z',
    });

    const result = await createAdminAsset({
      title: '  Nutrition PDF  ',
      description: '  ',
      assetType: 'document',
      fileName: ' nutrition.pdf ',
      contentType: ' application/pdf ',
      visibility: 'public',
      clientTag: null,
    });

    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        endpointPath: '/v1/admin/assets',
        body: {
          title: 'Nutrition PDF',
          description: null,
          asset_type: 'document',
          file_name: 'nutrition.pdf',
          resource_key: null,
          content_type: 'application/pdf',
          visibility: 'public',
          client_tag: null,
        },
      })
    );

    expect(result.asset).toMatchObject({
      id: 'asset-2',
      title: 'Nutrition PDF',
      assetType: 'document',
    });
    expect(result.upload).toEqual({
      uploadUrl: 'https://uploads.example.com/asset-2',
      uploadMethod: 'PUT',
      uploadHeaders: { 'x-amz-acl': 'private' },
      expiresAt: '2026-02-28T00:00:00.000Z',
    });
  });

  it('creates asset with content_language when provided', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      asset: {
        id: 'asset-3',
        title: 'Guide',
        description: null,
        asset_type: 'document',
        s3_key: 'assets/guide.pdf',
        file_name: 'guide.pdf',
        content_type: 'application/pdf',
        content_language: 'zh-HK',
        visibility: 'public',
        created_by: null,
        created_at: null,
        updated_at: null,
        tags: [],
      },
      upload_url: null,
      upload_method: 'PUT',
      upload_headers: {},
      expires_at: null,
    });

    await createAdminAsset({
      title: 'Guide',
      description: null,
      assetType: 'document',
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      contentLanguage: 'zh-HK',
      visibility: 'public',
    });

    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ content_language: 'zh-HK' }),
      })
    );
  });

  it('updates asset with PATCH sending only keys present on the patch input', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      asset: {
        id: 'asset-1',
        title: 'Infant guide',
        description: null,
        asset_type: 'document',
        s3_key: 'assets/infant-guide.pdf',
        file_name: 'infant-guide.pdf',
        content_type: 'application/pdf',
        content_language: 'en',
        visibility: 'restricted',
        created_by: null,
        created_at: null,
        updated_at: null,
        tags: [],
      },
    });

    const updated = await updateAdminAsset('asset-1', { contentLanguage: 'en' });

    expect(updated?.contentLanguage).toBe('en');
    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        endpointPath: '/v1/admin/assets/asset-1',
        body: { content_language: 'en' },
      })
    );
  });

  it('skips PATCH when update patch is empty and returns current asset from GET', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      asset: {
        id: 'asset-1',
        title: 'Same',
        description: null,
        asset_type: 'document',
        s3_key: 'assets/same.pdf',
        file_name: 'same.pdf',
        content_type: 'application/pdf',
        content_language: null,
        visibility: 'restricted',
        created_by: null,
        created_at: null,
        updated_at: null,
        tags: [],
      },
    });

    const asset = await updateAdminAsset('asset-1', {});

    expect(asset?.title).toBe('Same');
    expect(mockAdminApiRequest).toHaveBeenCalledTimes(1);
    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        endpointPath: '/v1/admin/assets/asset-1',
      })
    );
  });

  it('fetches user asset download URL', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      asset_id: 'asset-1',
      download_url: 'https://cdn.example.com/signed',
      expires_at: '2026-02-28T00:00:00.000Z',
    });

    const url = await getUserAssetDownloadUrl('asset-1');

    expect(url).toBe('https://cdn.example.com/signed');
    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        endpointPath: '/v1/user/assets/asset-1/download',
      })
    );
  });

  it('parses grants list payload', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'grant-1',
          asset_id: 'asset-1',
          grant_type: 'organization',
          grantee_id: 'org-1',
          granted_by: 'admin@example.com',
          created_at: '2026-02-27T12:00:00.000Z',
        },
      ],
    });

    const grants = await listAdminAssetGrants('asset-1');
    expect(grants).toEqual([
      {
        id: 'grant-1',
        assetId: 'asset-1',
        grantType: 'organization',
        granteeId: 'org-1',
        grantedBy: 'admin@example.com',
        createdAt: '2026-02-27T12:00:00.000Z',
      },
    ]);
  });

  it('uploads file to presigned URL and sets Content-Type fallback', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    const file = new File(['pdf-content'], 'guide.pdf', { type: 'application/pdf' });
    await uploadFileToPresignedUrl({
      uploadUrl: 'https://uploads.example.com/asset-1',
      uploadMethod: 'PUT',
      uploadHeaders: {},
      file,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://uploads.example.com/asset-1',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Type': 'application/pdf',
        }),
        body: file,
      })
    );
  });

  it('throws upload error when presigned upload fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const file = new File(['pdf-content'], 'guide.pdf', { type: 'application/pdf' });
    await expect(
      uploadFileToPresignedUrl({
        uploadUrl: 'https://uploads.example.com/asset-1',
        file,
      })
    ).rejects.toThrow('Upload failed with status 500.');
  });

  it('initiates content replace with file_name and content_type', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      pending_s3_key: 'assets/asset-1/u1-new.pdf',
      upload_url: 'https://uploads.example.com/replace',
      upload_method: 'PUT',
      upload_headers: { 'Content-Type': 'application/pdf' },
      expires_at: '2026-02-28T00:00:00.000Z',
    });

    const result = await initAdminAssetContentReplace('asset-1', {
      fileName: ' new.pdf ',
      contentType: ' application/pdf ',
    });

    expect(result).toEqual({
      pendingS3Key: 'assets/asset-1/u1-new.pdf',
      uploadUrl: 'https://uploads.example.com/replace',
      uploadMethod: 'PUT',
      uploadHeaders: { 'Content-Type': 'application/pdf' },
      expiresAt: '2026-02-28T00:00:00.000Z',
    });
    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        endpointPath: '/v1/admin/assets/asset-1/content/init',
        body: {
          file_name: 'new.pdf',
          content_type: 'application/pdf',
        },
      })
    );
  });

  it('completes content replace with pending_s3_key', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      asset: {
        id: 'asset-1',
        title: 'Guide',
        description: null,
        asset_type: 'document',
        s3_key: 'assets/asset-1/u1-new.pdf',
        file_name: 'new.pdf',
        content_type: 'application/pdf',
        content_language: null,
        visibility: 'restricted',
        created_by: null,
        created_at: null,
        updated_at: null,
        tags: [],
      },
    });

    const asset = await completeAdminAssetContentReplace('asset-1', {
      pendingS3Key: 'assets/asset-1/u1-new.pdf',
      fileName: 'new.pdf',
      contentType: 'application/pdf',
    });

    expect(asset?.s3Key).toBe('assets/asset-1/u1-new.pdf');
    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        endpointPath: '/v1/admin/assets/asset-1/content/complete',
        body: {
          pending_s3_key: 'assets/asset-1/u1-new.pdf',
          file_name: 'new.pdf',
          content_type: 'application/pdf',
        },
      })
    );
  });
});
