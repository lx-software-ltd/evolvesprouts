'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';

import { ContactsPanel } from '@/components/admin/contacts/contacts-panel';
import { FamiliesPanel } from '@/components/admin/contacts/families-panel';
import { MailchimpSyncCard } from '@/components/admin/contacts/mailchimp-sync-card';
import { OrganizationsPanel } from '@/components/admin/contacts/organizations-panel';
import { AdminPageErrorBanner } from '@/components/admin/admin-page-error-banner';
import { AdminTabStrip } from '@/components/ui/admin-tab-strip';
import { formatAdminContactPickerLabel } from '@/lib/format';
import {
  useSharedEntityTags,
  useSharedGeographicAreas,
  useSharedPickerLocations,
} from '@/hooks/use-admin-catalog';
import { useAdminEntityContacts } from '@/hooks/use-admin-entity-contacts';
import { useAdminUsers } from '@/hooks/use-admin-users';
import { useAdminEntityFamilies } from '@/hooks/use-admin-entity-families';
import { useAdminEntityOrganizations } from '@/hooks/use-admin-entity-organizations';
import { useQueryTabState } from '@/hooks/use-query-tab-state';

const TAB_ITEMS = [
  { key: 'contacts', label: 'Contacts' },
  { key: 'families', label: 'Families' },
  { key: 'organizations', label: 'Organisations' },
  { key: 'mailchimp', label: 'Mailchimp' },
] as const;

type ContactsView = (typeof TAB_ITEMS)[number]['key'];

const CONTACTS_TAB_KEYS: readonly ContactsView[] = TAB_ITEMS.map(
  (item) => item.key
);
const DEFAULT_CONTACTS_VIEW: ContactsView = 'contacts';

export function ContactsPage() {
  const [activeView, setActiveView] = useQueryTabState<ContactsView>(
    CONTACTS_TAB_KEYS,
    DEFAULT_CONTACTS_VIEW
  );
  const tagsCatalog = useSharedEntityTags();
  const locationsCatalog = useSharedPickerLocations();
  const areasCatalog = useSharedGeographicAreas();
  const tags = tagsCatalog.items;
  const locations = locationsCatalog.items;
  const geographicAreas = areasCatalog.items;
  const pickerLoading =
    tagsCatalog.isLoading || locationsCatalog.isLoading || areasCatalog.isLoading;
  const pickerError = tagsCatalog.error || locationsCatalog.error || areasCatalog.error;

  const contacts = useAdminEntityContacts();
  const adminUsers = useAdminUsers();
  const families = useAdminEntityFamilies();
  const organizations = useAdminEntityOrganizations();
  const { refetch: refetchFamilies } = families;
  const { refetch: refetchOrganizations } = organizations;
  const { refetch: refetchLocations } = locationsCatalog;

  const patchStandaloneNoteCountRef = useRef(contacts.patchContactStandaloneNoteCount);
  useLayoutEffect(() => {
    patchStandaloneNoteCountRef.current = contacts.patchContactStandaloneNoteCount;
  });
  const stablePatchStandaloneNoteCount = useCallback((contactId: string, count: number) => {
    patchStandaloneNoteCountRef.current(contactId, count);
  }, []);

  const refreshFamilyOrgLists = useCallback(async () => {
    await Promise.all([refetchFamilies(), refetchOrganizations()]);
  }, [refetchFamilies, refetchOrganizations]);

  const refreshLocations = useCallback(async () => {
    await refetchLocations();
  }, [refetchLocations]);

  const contactOptions = useMemo(() => {
    return contacts.contacts.map((c) => ({
      id: c.id,
      label: formatAdminContactPickerLabel(c),
    }));
  }, [contacts.contacts]);

  const contactsForMembership = useMemo(
    () =>
      contacts.contacts.map((c) => ({
        id: c.id,
        contact_type: c.contact_type,
        family_ids: c.family_ids,
        organization_ids: c.organization_ids,
      })),
    [contacts.contacts]
  );

  const hasAnyError =
    pickerError ||
    contacts.error ||
    families.error ||
    organizations.error;

  return (
    <div className='space-y-4'>
      <AdminPageErrorBanner title='Contacts' message={hasAnyError} />

      <AdminTabStrip
        items={TAB_ITEMS}
        activeKey={activeView}
        onChange={setActiveView}
        aria-label='Contacts section views'
      />

      {activeView === 'contacts' ? (
        <ContactsPanel
          contacts={contacts}
          adminUsers={adminUsers.users}
          onPatchStandaloneNoteCount={stablePatchStandaloneNoteCount}
          tags={tags}
          locations={locations}
          geographicAreas={geographicAreas}
          areasLoading={pickerLoading}
          refreshLocations={refreshLocations}
          refreshFamilyOrgLists={refreshFamilyOrgLists}
        />
      ) : activeView === 'families' ? (
        <FamiliesPanel
          families={families}
          tags={tags}
          locations={locations}
          geographicAreas={geographicAreas}
          areasLoading={pickerLoading}
          refreshLocations={refreshLocations}
          contactOptions={contactOptions}
          contactsForMembership={contactsForMembership}
        />
      ) : activeView === 'organizations' ? (
        <OrganizationsPanel
          organizations={organizations}
          tags={tags}
          locations={locations}
          geographicAreas={geographicAreas}
          areasLoading={pickerLoading}
          refreshLocations={refreshLocations}
          contactOptions={contactOptions}
          contactsForMembership={contactsForMembership}
        />
      ) : (
        <MailchimpSyncCard />
      )}
    </div>
  );
}
