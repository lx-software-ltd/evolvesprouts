export const ADMIN_CONTACT_QUERY_PARAM = 'contact';

export function formatInboxConversationName(input: {
  contactName: string | null;
  profileName: string | null;
}): string {
  const contactName = input.contactName?.trim() ?? '';
  if (contactName) {
    return contactName;
  }
  return input.profileName?.trim() ?? '';
}

export function adminContactDeepLink(contactId: string): string {
  return `/contacts?${ADMIN_CONTACT_QUERY_PARAM}=${encodeURIComponent(contactId)}`;
}

export function readAdminContactQueryId(search: string): string {
  return new URLSearchParams(search).get(ADMIN_CONTACT_QUERY_PARAM)?.trim() ?? '';
}
