'use client';

import { useEffect, useMemo, useState } from 'react';

import { ADMIN_API_MAX_LIST_LIMIT } from '@/lib/admin-list-query';
import {
  listAdminContacts,
  listEntityFamilyPicker,
  listEntityOrganizationPicker,
  listEntityPartnerOrganizationPicker,
} from '@/lib/entity-api';
import { formatAdminContactFullName, formatAdminContactPickerLabel } from '@/lib/format';
import { DEFAULT_CONTACT_LIST_FILTERS } from '@/types/entity-list';

import type { components } from '@/types/generated/admin-api.generated';

type AdminContact = components['schemas']['AdminContact'];

export interface EnrollmentParentPickerOption {
  id: string;
  label: string;
}

function formatContactSortKey(contact: AdminContact): string {
  const name = formatAdminContactFullName(contact);
  return (name || contact.email || contact.id).toLowerCase();
}

export function useEnrollmentParentPickers(canCreate: boolean) {
  const [contacts, setContacts] = useState<AdminContact[]>([]);
  const [families, setFamilies] = useState<EnrollmentParentPickerOption[]>([]);
  const [organizations, setOrganizations] = useState<EnrollmentParentPickerOption[]>([]);
  const [partnerOrganizations, setPartnerOrganizations] = useState<EnrollmentParentPickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canCreate) {
      setContacts([]);
      setFamilies([]);
      setOrganizations([]);
      setPartnerOrganizations([]);
      setLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

        const [familyItems, orgItems, partnerOrgItems] = await Promise.all([
          listEntityFamilyPicker(signal),
          listEntityOrganizationPicker(undefined, signal),
          listEntityPartnerOrganizationPicker(signal),
        ]);

        const sortedFamilies = [...familyItems].sort((a, b) =>
          collator.compare(a.label.toLowerCase(), b.label.toLowerCase())
        );
        const sortedOrgs = [...orgItems].sort((a, b) =>
          collator.compare(a.label.toLowerCase(), b.label.toLowerCase())
        );
        const sortedPartnerOrgs = [...partnerOrgItems].sort((a, b) =>
          collator.compare(a.label.toLowerCase(), b.label.toLowerCase())
        );

        setFamilies(sortedFamilies.map((row) => ({ id: row.id, label: row.label })));
        setOrganizations(sortedOrgs.map((row) => ({ id: row.id, label: row.label })));
        setPartnerOrganizations(sortedPartnerOrgs.map((row) => ({ id: row.id, label: row.label })));

        const contactRows: AdminContact[] = [];
        let cursor: string | null = null;
        do {
          const page = await listAdminContacts(
            {
              ...DEFAULT_CONTACT_LIST_FILTERS,
              cursor,
              limit: ADMIN_API_MAX_LIST_LIMIT,
            },
            signal
          );
          contactRows.push(...page.items);
          cursor = page.nextCursor;
        } while (cursor);

        contactRows.sort((a, b) => collator.compare(formatContactSortKey(a), formatContactSortKey(b)));
        const enrollmentEligibleContacts = contactRows.filter(
          (c) => (c.family_ids?.length ?? 0) === 0
        );
        setContacts(enrollmentEligibleContacts);
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load parent options.';
        setError(message);
        setContacts([]);
        setFamilies([]);
        setOrganizations([]);
        setPartnerOrganizations([]);
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [canCreate]);

  const contactOptions = useMemo<EnrollmentParentPickerOption[]>(
    () => contacts.map((c) => ({ id: c.id, label: formatAdminContactPickerLabel(c) })),
    [contacts]
  );

  const labelByContactId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of contactOptions) {
      map.set(row.id, row.label);
    }
    return map;
  }, [contactOptions]);

  const labelByFamilyId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of families) {
      map.set(row.id, row.label);
    }
    return map;
  }, [families]);

  const labelByOrganizationId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of organizations) {
      map.set(row.id, row.label);
    }
    return map;
  }, [organizations]);

  const labelByPartnerOrganizationId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of partnerOrganizations) {
      map.set(row.id, row.label);
    }
    return map;
  }, [partnerOrganizations]);

  return {
    contactOptions,
    families,
    organizations,
    partnerOrganizations,
    loading,
    error,
    labelByContactId,
    labelByFamilyId,
    labelByOrganizationId,
    labelByPartnerOrganizationId,
  };
}
