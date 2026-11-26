import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnsureFreshTokens, mockGetApiBaseUrl } = vi.hoisted(() => ({
  mockEnsureFreshTokens: vi.fn(),
  mockGetApiBaseUrl: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  ensureFreshTokens: mockEnsureFreshTokens,
}));

vi.mock('@/lib/config', () => ({
  getApiBaseUrl: mockGetApiBaseUrl,
}));

import { AdminApiError, adminApiRequest, isAbortRequestError } from '@/lib/api-admin-client';

describe('adminApiRequest', () => {
  beforeEach(() => {
    mockEnsureFreshTokens.mockReset();
    mockGetApiBaseUrl.mockReset();
    vi.mocked(fetch).mockReset();

    mockEnsureFreshTokens.mockResolvedValue({
      idToken: 'id-token',
    });
    mockGetApiBaseUrl.mockReturnValue('https://api.example.com');
  });

  it('sends authorized request and returns parsed payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    } as Response);

    const payload = await adminApiRequest({
      endpointPath: 'v1/admin/assets',
      method: 'POST',
      body: { title: 'Guide' },
    });

    expect(payload).toEqual({ success: true });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/admin/assets',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Guide' }),
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer id-token',
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('does not repeat the error when detail copies it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'Bad Request', detail: 'Bad Request' }),
    } as Response);

    await expect(
      adminApiRequest({
        endpointPath: '/v1/admin/assets',
        method: 'GET',
      })
    ).rejects.toMatchObject({
      name: 'AdminApiError',
      statusCode: 400,
      message: 'Bad Request',
    });
  });

  it('throws AdminApiError with extracted message on API failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: 'Forbidden', detail: 'Missing role' }),
    } as Response);

    await expect(
      adminApiRequest({
        endpointPath: '/v1/admin/assets',
        method: 'GET',
      })
    ).rejects.toMatchObject({
      name: 'AdminApiError',
      statusCode: 403,
      message: 'Forbidden (Missing role)',
    });
  });

  it('throws when response status is not in expected success statuses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 202,
      text: async () => '{}',
    } as Response);

    await expect(
      adminApiRequest({
        endpointPath: '/v1/admin/assets',
        expectedSuccessStatuses: [200],
      })
    ).rejects.toMatchObject({
      name: 'AdminApiError',
      statusCode: 202,
      message: 'Admin API request returned unexpected status: 202',
    });
  });

  it('throws clear errors for invalid endpoint and missing session', async () => {
    await expect(
      adminApiRequest({
        endpointPath: '   ',
      })
    ).rejects.toThrow('Admin API endpoint path is invalid.');

    mockEnsureFreshTokens.mockResolvedValueOnce(null);
    await expect(
      adminApiRequest({
        endpointPath: '/v1/admin/assets',
      })
    ).rejects.toThrow('Your session has expired. Please sign in again.');
  });

  it('detects AbortError instances', () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';

    expect(isAbortRequestError(abortError)).toBe(true);
    expect(isAbortRequestError(new Error('other'))).toBe(false);
  });

  it('exposes AdminApiError payload and statusCode', () => {
    const error = new AdminApiError({
      statusCode: 400,
      payload: { detail: 'Invalid input' },
      message: 'Bad request',
    });

    expect(error.statusCode).toBe(400);
    expect(error.payload).toEqual({ detail: 'Invalid input' });
    expect(error.message).toBe('Bad request');
  });
});
