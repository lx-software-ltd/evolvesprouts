import {
  createAdminContact,
  createAdminFamily,
  createAdminOrganization,
  listAdminFamilies,
  listAdminOrganizations,
  searchEntityContactsForPicker,
  type EntityPickerListItem,
} from '@/lib/entity-api';
import { formatAdminContactPickerLabel, formatFamilyOrOrganizationPartyLabel } from '@/lib/format';
import { parseContactSearchQuery } from '@/lib/parse-contact-search-query';
import { contactPhoneRequestFields } from '@/lib/phone-request';

export type BillToPartyKind = 'contact' | 'family' | 'organization' | 'partner';

export type BillToPartyValue =
  | { status: 'empty' }
  | { status: 'existing'; id: string; label: string }
  | { status: 'create'; query: string };

export function isBillToPartyReady(value: BillToPartyValue, minChars: number): boolean {
  if (value.status === 'existing') {
    return value.id.trim() !== '';
  }
  if (value.status === 'create') {
    return value.query.trim().length >= minChars;
  }
  return false;
}

function primaryMemberLabel(
  members: { is_primary_contact: boolean; contact_label?: string | null }[] | undefined,
): string | null {
  const primary = members?.find((m) => m.is_primary_contact);
  return primary?.contact_label?.trim() || null;
}

function familyRowLabel(row: { id: string; family_name: string; members?: { is_primary_contact: boolean; contact_label?: string | null }[] }): string {
  return (
    formatFamilyOrOrganizationPartyLabel(row.family_name, primaryMemberLabel(row.members)) ||
    row.family_name ||
    row.id
  );
}

function organizationRowLabel(row: {
  id: string;
  name: string;
  members?: { is_primary_contact: boolean; contact_label?: string | null }[];
}): string {
  return formatFamilyOrOrganizationPartyLabel(row.name, primaryMemberLabel(row.members)) || row.name || row.id;
}

export async function searchBillToParties(
  kind: BillToPartyKind,
  query: string,
  signal?: AbortSignal,
): Promise<EntityPickerListItem[]> {
  const q = query.trim();
  if (q.length < 2) {
    return [];
  }
  if (kind === 'contact') {
    const items = await searchEntityContactsForPicker({ query: q, limit: 50 }, signal);
    return items.map((item) => ({ id: item.id, label: item.label }));
  }
  if (kind === 'family') {
    const page = await listAdminFamilies({ query: q, active: 'true', limit: 50 }, signal);
    return page.items.map((row) => ({ id: row.id, label: familyRowLabel(row) }));
  }
  if (kind === 'partner') {
    const page = await listAdminOrganizations(
      { query: q, active: 'true', relationshipType: 'partner', limit: 50 },
      signal
    );
    return page.items.map((row) => ({ id: row.id, label: organizationRowLabel(row) }));
  }
  const page = await listAdminOrganizations({ query: q, active: 'true', limit: 50 }, signal);
  return page.items.map((row) => ({ id: row.id, label: organizationRowLabel(row) }));
}

export async function createBillToParty(
  kind: BillToPartyKind,
  query: string,
): Promise<EntityPickerListItem> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('Enter a bill-to party.');
  }
  if (kind === 'contact') {
    const parsed = parseContactSearchQuery(trimmed);
    const body: Parameters<typeof createAdminContact>[0] = {
      first_name: parsed.firstName,
      contact_type: 'parent',
      source: 'manual',
      relationship_type: 'prospect',
    };
    if (parsed.lastName) {
      body.last_name = parsed.lastName;
    }
    if (parsed.email) {
      body.email = parsed.email;
    }
    if (parsed.phoneNational) {
      const phone = contactPhoneRequestFields(parsed.phoneRegion ?? 'HK', parsed.phoneNational);
      if (phone.phone_number) {
        body.phone_region = phone.phone_region;
        body.phone_number = phone.phone_number;
      }
    }
    const created = await createAdminContact(body);
    if (!created?.id) {
      throw new Error('Create contact failed.');
    }
    return { id: created.id, label: formatAdminContactPickerLabel(created) };
  }
  if (kind === 'family') {
    const created = await createAdminFamily({
      family_name: trimmed.slice(0, 150),
      relationship_type: 'prospect',
    });
    if (!created?.id) {
      throw new Error('Create family failed.');
    }
    return { id: created.id, label: familyRowLabel(created) };
  }
  if (kind === 'partner') {
    const created = await createAdminOrganization({
      name: trimmed.slice(0, 255),
      organization_type: 'company',
      relationship_type: 'partner',
    });
    if (!created?.id) {
      throw new Error('Create partner failed.');
    }
    return { id: created.id, label: organizationRowLabel(created) };
  }
  const created = await createAdminOrganization({
    name: trimmed.slice(0, 255),
    organization_type: 'company',
    relationship_type: 'prospect',
  });
  if (!created?.id) {
    throw new Error('Create organization failed.');
  }
  return { id: created.id, label: organizationRowLabel(created) };
}
