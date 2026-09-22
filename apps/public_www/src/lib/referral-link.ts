const REF_PARAM = 'ref';
const DISCOUNT_PARAM = 'discount';
const DISCOUNT_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Uppercase discount or referral token. Null when empty or not slug-safe. */
export function normalizeDiscountCode(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || !DISCOUNT_CODE_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.toUpperCase();
}

/**
 * Query value for `name`, matched case-insensitively.
 * Null when the parameter is absent. An empty string means the parameter is present but blank.
 */
export function readSearchParam(search: string, name: string): string | null {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const key = [...params.keys()].find((candidate) => candidate.toLowerCase() === name);
  if (!key) {
    return null;
  }
  return params.get(key)?.trim() ?? '';
}

/**
 * Read a referral/discount code from a query string (`?ref=` or `?discount=`).
 * `ref` wins when both are present. Matching is case-insensitive for param names.
 */
export function readReferralCodeFromSearch(search: string): string | null {
  const chosen = readSearchParam(search, REF_PARAM) ?? readSearchParam(search, DISCOUNT_PARAM);
  if (!chosen) {
    return null;
  }
  return normalizeDiscountCode(chosen);
}
