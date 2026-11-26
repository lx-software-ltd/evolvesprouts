const API_BASE_URL_ENV = 'NEXT_PUBLIC_API_BASE_URL';
const API_KEY_ENV = 'NEXT_PUBLIC_TRAINING_API_KEY';
const API_KEY_FALLBACK_ENV = 'NEXT_PUBLIC_WWW_CRM_API_KEY';
const API_PREFIX = '/api';

export function resolveTrainingApiConfig():
  | { baseUrl: string; apiKey: string }
  | null {
  const apiKey =
    process.env[API_KEY_ENV]?.trim() ||
    process.env[API_KEY_FALLBACK_ENV]?.trim() ||
    '';
  const baseUrl = normalizeTrainingApiBaseUrl(process.env[API_BASE_URL_ENV]?.trim() ?? '');
  if (!apiKey || !baseUrl) {
    return null;
  }
  return { baseUrl, apiKey };
}

export function normalizeTrainingApiBaseUrl(raw: string): string {
  if (!raw) {
    return '';
  }
  if (raw === API_PREFIX || raw.startsWith(`${API_PREFIX}/`)) {
    return API_PREFIX;
  }
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname.replace(/\/$/, '') || '';
    if (pathname !== API_PREFIX) {
      return '';
    }
    return `${parsed.origin}${API_PREFIX}`;
  } catch {
    return '';
  }
}
