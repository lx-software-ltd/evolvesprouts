const STORAGE_KEY_PREFIX = 'evolvesprouts-form-session-id';

function storageKey(formSlug: string, contactId?: string | null): string {
  const contactPart = contactId?.trim().toLowerCase() ?? '';
  if (!contactPart) {
    return `${STORAGE_KEY_PREFIX}:${formSlug}`;
  }
  return `${STORAGE_KEY_PREFIX}:${formSlug}:${contactPart}`;
}

export function getOrCreateFormSessionId(
  formSlug: string,
  contactId?: string | null,
): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const key = storageKey(formSlug, contactId);
  const existing = window.sessionStorage.getItem(key)?.trim();
  if (existing) {
    return existing;
  }
  return resetFormSessionId(formSlug, contactId);
}

/** Mint a new session id and persist it for this form slug (shared-device handoff). */
export function resetFormSessionId(formSlug: string, contactId?: string | null): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(storageKey(formSlug, contactId), created);
  return created;
}
