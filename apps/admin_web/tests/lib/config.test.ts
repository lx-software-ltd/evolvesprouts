import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type EnvSnapshot = NodeJS.ProcessEnv;

const ENV_KEYS = [
  'NEXT_PUBLIC_COGNITO_DOMAIN',
  'NEXT_PUBLIC_COGNITO_CLIENT_ID',
  'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
  'NEXT_PUBLIC_API_BASE_URL',
] as const;

function setConfigEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      process.env[key] = overrides[key];
    } else {
      delete process.env[key];
    }
  }
}

async function loadConfigModule(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  setConfigEnv(overrides);
  vi.resetModules();
  return import('@/lib/config');
}

describe('config helpers', () => {
  let originalEnv: EnvSnapshot;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('returns missing config errors', async () => {
    const config = await loadConfigModule({});
    expect(config.getConfigErrors()).toEqual([
      'NEXT_PUBLIC_COGNITO_DOMAIN is missing.',
      'NEXT_PUBLIC_COGNITO_CLIENT_ID is missing.',
      'NEXT_PUBLIC_COGNITO_USER_POOL_ID is missing.',
    ]);
  });

  it('normalizes absolute admin API base URL and trims trailing slashes', async () => {
    const config = await loadConfigModule({
      NEXT_PUBLIC_COGNITO_DOMAIN: 'auth.example.com',
      NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-id',
      NEXT_PUBLIC_COGNITO_USER_POOL_ID: 'pool-id',
      NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com/base/path///',
    });

    expect(config.getApiConfigError()).toBe('');
    expect(config.getApiBaseUrl()).toBe('https://api.example.com/base/path');
  });

  it('normalizes relative admin API base path', async () => {
    const config = await loadConfigModule({
      NEXT_PUBLIC_COGNITO_DOMAIN: 'auth.example.com',
      NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-id',
      NEXT_PUBLIC_COGNITO_USER_POOL_ID: 'pool-id',
      NEXT_PUBLIC_API_BASE_URL: '///prod///',
    });

    expect(config.getApiBaseUrl()).toBe('/prod');
  });

  it('returns validation error for invalid admin API base URL', async () => {
    const config = await loadConfigModule({
      NEXT_PUBLIC_COGNITO_DOMAIN: 'auth.example.com',
      NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-id',
      NEXT_PUBLIC_COGNITO_USER_POOL_ID: 'pool-id',
      NEXT_PUBLIC_API_BASE_URL: 'ftp://api.example.com',
    });

    expect(config.getApiConfigError()).toBe(
      'NEXT_PUBLIC_API_BASE_URL is invalid. Use an absolute URL or relative path.'
    );
    expect(() => config.getApiBaseUrl()).toThrow(
      'NEXT_PUBLIC_API_BASE_URL is invalid. Use an absolute URL or relative path.'
    );
  });

  it('normalizes cognito domain and applies https when protocol is missing', async () => {
    const config = await loadConfigModule({
      NEXT_PUBLIC_COGNITO_DOMAIN: 'auth.example.com///',
      NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-id',
      NEXT_PUBLIC_COGNITO_USER_POOL_ID: 'pool-id',
      NEXT_PUBLIC_API_BASE_URL: '/prod',
    });

    expect(config.getCognitoDomain()).toBe('https://auth.example.com');
  });

  it('returns HKD when admin default currency env is missing or invalid', async () => {
    delete process.env.NEXT_PUBLIC_ADMIN_DEFAULT_CURRENCY;
    vi.resetModules();
    const { getAdminDefaultCurrencyCode } = await import('@/lib/config');
    expect(getAdminDefaultCurrencyCode()).toBe('HKD');

    process.env.NEXT_PUBLIC_ADMIN_DEFAULT_CURRENCY = 'xx';
    vi.resetModules();
    const { getAdminDefaultCurrencyCode: readAgain } = await import('@/lib/config');
    expect(readAgain()).toBe('HKD');
  });

  it('normalizes admin default currency env to uppercase', async () => {
    process.env.NEXT_PUBLIC_ADMIN_DEFAULT_CURRENCY = ' usd ';
    vi.resetModules();
    const { getAdminDefaultCurrencyCode } = await import('@/lib/config');
    expect(getAdminDefaultCurrencyCode()).toBe('USD');
  });

  it('extracts the public site hostname from the configured base URL', async () => {
    process.env.NEXT_PUBLIC_PUBLIC_SITE_BASE_URL = 'https://www.example.com/path/';
    vi.resetModules();
    const { getPublicSiteHostname } = await import('@/lib/config');
    expect(getPublicSiteHostname()).toBe('www.example.com');
  });

  it('returns an empty public site hostname when the base URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_PUBLIC_SITE_BASE_URL;
    vi.resetModules();
    const { getPublicSiteHostname } = await import('@/lib/config');
    expect(getPublicSiteHostname()).toBe('');
  });
});
