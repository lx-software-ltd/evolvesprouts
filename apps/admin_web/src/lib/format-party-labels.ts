import { DISPLAY_PART_SEP } from '@/lib/format-separators';

/**
 * CRM contact line: `display name · email` when both exist; otherwise name, email, or id fallback.
 * Matches billing enrollment picker party labels for contact bill-to.
 */
export function formatContactNameEmailLabel(
  displayName: string,
  email: string | null | undefined,
  idFallback: string,
): string {
  const name = displayName.trim();
  const em = (email ?? '').trim();
  if (name) {
    return em ? `${name}${DISPLAY_PART_SEP}${em}` : name;
  }
  if (em) {
    return em;
  }
  return idFallback;
}

/** Admin CRM contact: first + last name trimmed, or empty string. */
export function formatAdminContactFullName(contact: {
  first_name?: string | null;
  last_name?: string | null;
}): string {
  return [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
}

/**
 * Select options and pickers: `name · email` when name is set; otherwise email or id.
 */
export function formatAdminContactPickerLabel(contact: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  id: string;
}): string {
  return formatContactNameEmailLabel(formatAdminContactFullName(contact), contact.email, contact.id);
}

/**
 * Family or organization party line: `entity · primary contact` when both exist (billing/enrollment convention).
 */
export function formatFamilyOrOrganizationPartyLabel(
  entityName: string | null | undefined,
  primaryContactName: string | null | undefined,
): string {
  const entity = entityName?.trim() ?? '';
  const primary = primaryContactName?.trim() ?? '';
  if (entity && primary) {
    return `${entity}${DISPLAY_PART_SEP}${primary}`;
  }
  if (entity) {
    return entity;
  }
  if (primary) {
    return primary;
  }
  return '';
}

/** Billing draft invoice enrollment picker — Party column: server `partyDisplayName` only. */
export function formatBillingEnrollmentPartyCell(row: {
  partyDisplayName?: string | null;
}): string {
  return row.partyDisplayName?.trim() ?? '';
}

/** Service enrollment list — Party cell: API label, else picker-derived labels by structural parent id. */
export function resolveEnrollmentListPartyLabel(
  enrollment: {
    partyDisplayName?: string | null;
    contactId?: string | null;
    familyId?: string | null;
    organizationId?: string | null;
  },
  labelByContactId: Map<string, string>,
  labelByFamilyId: Map<string, string>,
  labelByOrganizationId: Map<string, string>,
): string {
  const fromApi = enrollment.partyDisplayName?.trim();
  if (fromApi) {
    return fromApi;
  }
  const cid = enrollment.contactId?.trim();
  if (cid) {
    return labelByContactId.get(cid) ?? cid;
  }
  const fid = enrollment.familyId?.trim();
  if (fid) {
    return labelByFamilyId.get(fid) ?? fid;
  }
  const oid = enrollment.organizationId?.trim();
  if (oid) {
    return labelByOrganizationId.get(oid) ?? oid;
  }
  return '—';
}
