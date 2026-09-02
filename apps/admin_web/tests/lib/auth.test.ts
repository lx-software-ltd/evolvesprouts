import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const AUTH_ENV = {
  NEXT_PUBLIC_COGNITO_DOMAIN: 'auth.example.com',
  NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-id',
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: 'user-pool-id',
  NEXT_PUBLIC_API_BASE_URL: '/prod',
} as const;

function setAuthEnv() {
  Object.entries(AUTH_ENV).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

function base64UrlEncode(value: string) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJwt(payload: Record<string, unknown>) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

async function loadAuthModule() {
  setAuthEnv();
  vi.resetModules();
  return import('@/lib/auth');
}

const TOKEN_STORAGE_KEY = 'admin_auth_tokens';

/**
 * Loads the auth module together with the secure-storage helpers from the same
 * module registry so encrypt/decrypt share the same in-memory key, then returns
 * helpers for seeding and reading the encrypted token blob in tests.
 */
async function loadAuthWithStorage() {
  const auth = await loadAuthModule();
  const secureStorage = await import('@/lib/secure-storage');

  return {
    auth,
    async seedStoredTokens(tokens: {
      accessToken: string;
      idToken: string;
      refreshToken?: string;
      expiresAt: number;
    }) {
      await auth.storeTokensFromPasswordless(tokens);
    },
    async readStoredTokens() {
      const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const decrypted = await secureStorage.decryptFromBase64(raw);
      return decrypted ? JSON.parse(decrypted) : null;
    },
  };
}

describe('auth helpers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    setAuthEnv();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
  });

  it('parses user profile from JWT claims', async () => {
    const auth = await loadAuthModule();
    const idToken = createJwt({
      email: 'admin@example.com',
      sub: 'user-sub-123',
      'cognito:groups': ['admins', 'ops'],
      auth_time: 1_700_000_000,
    });
    const accessToken = createJwt({});

    const profile = auth.getUserProfile({
      accessToken,
      idToken,
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600_000,
    });

    expect(profile.email).toBe('admin@example.com');
    expect(profile.subject).toBe('user-sub-123');
    expect(profile.groups).toEqual(['admins', 'ops']);
    expect(profile.lastAuthTime).toBe('2023-11-14T22:13:20.000Z');
  });

  it('hasStaffAdminAccess is true for admin, manager, or instructor', async () => {
    const auth = await loadAuthModule();
    expect(auth.hasStaffAdminAccess([])).toBe(false);
    expect(auth.hasStaffAdminAccess(['guest'])).toBe(false);
    expect(auth.hasStaffAdminAccess(['admin'])).toBe(true);
    expect(auth.hasStaffAdminAccess(['manager'])).toBe(true);
    expect(auth.hasStaffAdminAccess(['instructor'])).toBe(true);
    expect(auth.hasStaffAdminAccess(['manager', 'other'])).toBe(true);
  });

  it('returns current tokens when not near expiry', async () => {
    const { auth, seedStoredTokens } = await loadAuthWithStorage();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const fetchMock = vi.mocked(fetch);

    await seedStoredTokens({
      accessToken: 'access',
      idToken: 'id',
      refreshToken: 'refresh',
      expiresAt: 1_700_000_200_000,
    });

    const tokens = await auth.ensureFreshTokens();

    expect(tokens).toEqual({
      accessToken: 'access',
      idToken: 'id',
      refreshToken: 'refresh',
      expiresAt: 1_700_000_200_000,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it('does not persist tokens as clear text in localStorage', async () => {
    const { seedStoredTokens } = await loadAuthWithStorage();

    await seedStoredTokens({
      accessToken: 'secret-access',
      idToken: 'secret-id',
      refreshToken: 'secret-refresh',
      expiresAt: 1_700_000_200_000,
    });

    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
    expect(raw).not.toBe('');
    expect(raw).not.toContain('secret-access');
    expect(raw).not.toContain('secret-id');
    expect(raw).not.toContain('secret-refresh');
  });

  it('refreshes expired tokens using refresh token and stores new values', async () => {
    const { auth, seedStoredTokens, readStoredTokens } = await loadAuthWithStorage();
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const fetchMock = vi.mocked(fetch);

    await seedStoredTokens({
      accessToken: 'old-access',
      idToken: 'old-id',
      refreshToken: 'old-refresh',
      expiresAt: 1_700_000_010_000,
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        id_token: 'new-id',
        refresh_token: 'new-refresh',
        expires_in: 600,
      }),
    } as Response);

    const refreshed = await auth.ensureFreshTokens();

    expect(refreshed).toMatchObject({
      accessToken: 'new-access',
      idToken: 'new-id',
      refreshToken: 'new-refresh',
    });

    const stored = (await readStoredTokens()) ?? {};
    expect(stored.accessToken).toBe('new-access');
    expect(stored.idToken).toBe('new-id');
    expect(stored.refreshToken).toBe('new-refresh');
  });

  it('shares one Cognito refresh across concurrent callers', async () => {
    const { auth, seedStoredTokens } = await loadAuthWithStorage();
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const fetchMock = vi.mocked(fetch);

    await seedStoredTokens({
      accessToken: 'old-access',
      idToken: 'old-id',
      refreshToken: 'old-refresh',
      expiresAt: 1_700_000_010_000,
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'new-access', id_token: 'new-id', expires_in: 600 }),
    } as Response);

    const [first, second, third] = await Promise.all([
      auth.ensureFreshTokens(),
      auth.ensureFreshTokens(),
      auth.ensureFreshTokens(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first?.idToken).toBe('new-id');
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('reads decrypted tokens from memory after the first load', async () => {
    const { auth, seedStoredTokens } = await loadAuthWithStorage();
    const secureStorage = await import('@/lib/secure-storage');
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const decryptSpy = vi.spyOn(secureStorage, 'decryptFromBase64');

    await seedStoredTokens({
      accessToken: 'access',
      idToken: 'id',
      refreshToken: 'refresh',
      expiresAt: 1_700_000_200_000,
    });

    await auth.ensureFreshTokens();
    await auth.ensureFreshTokens();
    expect(decryptSpy).not.toHaveBeenCalled();

    window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY }));
    const reloaded = await auth.ensureFreshTokens();
    expect(decryptSpy).toHaveBeenCalledTimes(1);
    expect(reloaded?.idToken).toBe('id');
  });

  it('stores tokens from passwordless flow', async () => {
    const { seedStoredTokens, readStoredTokens } = await loadAuthWithStorage();

    await seedStoredTokens({
      accessToken: 'pwd-access',
      idToken: 'pwd-id',
      refreshToken: 'pwd-refresh',
      expiresAt: 1_700_000_200_000,
    });

    const stored = await readStoredTokens();
    expect(stored).toEqual({
      accessToken: 'pwd-access',
      idToken: 'pwd-id',
      refreshToken: 'pwd-refresh',
      expiresAt: 1_700_000_200_000,
    });
  });
});
