import { formatEntityVenueLocationLabel } from '@/lib/format';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

/** Shown after the contact name in the list when `family_ids` is non-empty. */
export const CONTACT_NAME_FAMILY_EMOJI = '👨‍👩‍👧';
/** Shown after the contact name in the list when `organization_ids` is non-empty. */
export const CONTACT_NAME_ORG_EMOJI = '🏢';
/** Shown after the contact name when `relationship_type` is `client`. */
export const CONTACT_NAME_CLIENT_EMOJI = '🤝';
/** Shown when the contact has at least one issued completion certificate. */
export const CONTACT_NAME_CERTIFICATE_EMOJI = '🎓';

export function contactNameListSuffix(row: ApiSchemas['AdminContact']): string {
  const parts: string[] = [];
  if (row.family_ids.length > 0) {
    parts.push(CONTACT_NAME_FAMILY_EMOJI);
  }
  if (row.organization_ids.length > 0) {
    parts.push(CONTACT_NAME_ORG_EMOJI);
  }
  if (row.relationship_type === 'client') {
    parts.push(CONTACT_NAME_CLIENT_EMOJI);
  }
  if (row.has_completion_certificate) {
    parts.push(CONTACT_NAME_CERTIFICATE_EMOJI);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export function linkedVenueReadOnlyLines(row: ApiSchemas['AdminContact']): {
  lines: string[];
  footerNote: string | null;
} {
  const lines: string[] = [];

  function pushLine(emoji: string, summary: ApiSchemas['EntityLocationVenueSummary'] | null) {
    if (!summary) {
      lines.push(`${emoji} Not set`);
      return;
    }
    lines.push(
      `${emoji} ${formatEntityVenueLocationLabel({
        id: summary.id,
        name: summary.name,
        address: summary.address,
        areaName: summary.area_name,
      })}`
    );
  }

  if (row.family_ids.length > 0) {
    pushLine(CONTACT_NAME_FAMILY_EMOJI, row.family_location_summary ?? null);
  }
  if (row.organization_ids.length > 0) {
    pushLine(CONTACT_NAME_ORG_EMOJI, row.organization_location_summary ?? null);
  }

  if (lines.length === 0) {
    return { lines: [], footerNote: null };
  }

  const footerNote =
    row.family_ids.length > 0 && row.organization_ids.length > 0
      ? 'Read-only. Edit addresses on the family and organisation records.'
      : row.family_ids.length > 0
        ? 'Read-only. Edit address on the family record.'
        : 'Read-only. Edit address on the organisation record.';

  return { lines, footerNote };
}

/** Stored handle has no leading ``@``. Empty input becomes ``null``. */
export function instagramHandleForStorage(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const stored = value.trim().replace(/^@+/, '').trim().toLowerCase();
  return stored || null;
}

/** Display-only ``@handle``. Does not change the stored value. */
export function formatInstagramHandleDisplay(value: string | null | undefined): string {
  const stored = instagramHandleForStorage(value);
  return stored ? `@${stored}` : '';
}

export function contactRowLabel(row: ApiSchemas['AdminContact']): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  if (name) {
    return name;
  }
  if (row.email?.trim()) {
    return row.email.trim();
  }
  return row.id;
}

/** Label of the member flagged as primary contact, or `null` when none is set. */
export function primaryMemberLabel(
  members: { is_primary_contact: boolean; contact_label?: string | null }[]
): string | null {
  const primary = members.find((member) => member.is_primary_contact);
  return primary?.contact_label?.trim() || null;
}
