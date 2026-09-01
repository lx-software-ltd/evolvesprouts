import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { createLocation, geocodeVenueAddress, updateLocationPartial } = vi.hoisted(() => ({
  createLocation: vi.fn(),
  geocodeVenueAddress: vi.fn(),
  updateLocationPartial: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/services-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services-api')>('@/lib/services-api');
  return {
    ...actual,
    createLocation,
    geocodeVenueAddress,
    updateLocationPartial,
  };
});

import { ContactsPanel } from '@/components/admin/contacts/contacts-panel';

import type { useAdminEntityContacts } from '@/hooks/use-admin-entity-contacts';
import type { components } from '@/types/generated/admin-api.generated';

vi.mock('@/hooks/use-confirm-dialog', () => ({
  useConfirmDialog: () => [
    {
      open: false,
      title: '',
      description: '',
      onConfirm: () => {},
      onCancel: () => {},
    },
    () => Promise.resolve(true),
  ],
}));

vi.mock('@/lib/entity-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/entity-api')>();
  return {
    ...actual,
    listEntityFamilyPicker: vi.fn().mockResolvedValue([]),
    listEntityOrganizationPicker: vi.fn().mockResolvedValue([]),
  };
});

const noopRefresh = vi.fn().mockResolvedValue(undefined);

function buildContactsHook(
  overrides: Partial<ReturnType<typeof useAdminEntityContacts>> = {}
): ReturnType<typeof useAdminEntityContacts> {
  return {
    contacts: [],
    filters: { query: '', active: 'true' as const, contact_type: '' as const },
    setFilter: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: '',
    loadMore: vi.fn(),
    totalCount: 0,
    isSaving: false,
    createContact: vi.fn().mockResolvedValue(null),
    updateContact: vi.fn().mockResolvedValue(null),
    deleteContact: vi.fn().mockResolvedValue(undefined),
    patchContactStandaloneNoteCount: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

const hkArea = {
  id: 'area-hk',
  parentId: null,
  name: 'Hong Kong',
  level: 'country' as const,
  code: 'HK',
  sovereignCountryId: null,
  active: true,
  displayOrder: 0,
};

describe('ContactsPanel', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/contacts');
  });

  it('submits create with relationship types that exclude vendor', async () => {
    const user = userEvent.setup();
    const createContact = vi.fn().mockResolvedValue(null);
    const contacts = buildContactsHook({ createContact });
    const refreshFamilyOrgLists = vi.fn().mockResolvedValue(undefined);

    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        refreshFamilyOrgLists={refreshFamilyOrgLists}
      />
    );

    await user.type(screen.getByLabelText('First name'), 'Jane');
    await user.click(screen.getByRole('button', { name: 'Create contact' }));

    expect(createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'Jane',
        relationship_type: 'prospect',
        contact_type: 'parent',
      })
    );
    await waitFor(() => {
      expect(refreshFamilyOrgLists).toHaveBeenCalledTimes(1);
    });
  });

  it('loads the next page when Load more is available', async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn().mockResolvedValue(undefined);
    const contacts = buildContactsHook({ hasMore: true, loadMore });

    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(loadMore).toHaveBeenCalled();
  });

  it('shows family and organisation emoji after the name when the contact is linked', () => {
    const baseRow = {
      id: '11111111-1111-1111-1111-111111111111',
      email: null,
      instagram_handle: null,
      phone_region: null,
      phone_national_number: null,
      phone_e164: null,
      contact_type: 'parent' as const,
      relationship_type: 'prospect' as const,
      source: 'manual' as const,
      mailchimp_status: 'pending' as const,
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      tag_ids: [],
      tags: [],
      standalone_note_count: 0,
      has_completion_certificate: false,
      has_sales_conversation: false,
      has_service_instance: false,
      has_invoice: false,
    };
    const familyOnly: components['schemas']['AdminContact'] = {
      ...baseRow,
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      first_name: 'Ann',
      last_name: 'Family',
      family_ids: ['fam-1'],
      organization_ids: [],
      family_location_summary: null,
      organization_location_summary: null,
    };
    const orgOnly: components['schemas']['AdminContact'] = {
      ...baseRow,
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      first_name: 'Bob',
      last_name: 'Org',
      family_ids: [],
      organization_ids: ['org-1'],
      family_location_summary: null,
      organization_location_summary: null,
    };
    const both: components['schemas']['AdminContact'] = {
      ...baseRow,
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      first_name: 'Pat',
      last_name: 'Both',
      family_ids: ['fam-2'],
      organization_ids: ['org-2'],
      family_location_summary: null,
      organization_location_summary: null,
    };
    const contacts = buildContactsHook({ contacts: [familyOnly, orgOnly, both] });

    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
      />
    );

    expect(screen.getByText(/Ann Family/)).toHaveTextContent('Ann Family 👨‍👩‍👧');
    expect(screen.getByText(/Bob Org/)).toHaveTextContent('Bob Org 🏢');
    expect(screen.getByText(/Pat Both/)).toHaveTextContent('Pat Both 👨‍👩‍👧 🏢');
  });

  it('shows client emoji after the name when relationship_type is client', () => {
    const baseRow = {
      id: '11111111-1111-1111-1111-111111111111',
      email: null,
      instagram_handle: null,
      phone_region: null,
      phone_national_number: null,
      phone_e164: null,
      contact_type: 'parent' as const,
      relationship_type: 'prospect' as const,
      source: 'manual' as const,
      mailchimp_status: 'pending' as const,
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      tag_ids: [],
      tags: [],
      standalone_note_count: 0,
      has_completion_certificate: false,
      has_sales_conversation: false,
      has_service_instance: false,
      has_invoice: false,
    };
    const clientOnly: components['schemas']['AdminContact'] = {
      ...baseRow,
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      first_name: 'Cara',
      last_name: 'Client',
      family_ids: [],
      organization_ids: [],
      family_location_summary: null,
      organization_location_summary: null,
      relationship_type: 'client',
    };
    const clientInFamily: components['schemas']['AdminContact'] = {
      ...baseRow,
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      first_name: 'Finn',
      last_name: 'FamilyClient',
      family_ids: ['fam-1'],
      organization_ids: [],
      family_location_summary: null,
      organization_location_summary: null,
      relationship_type: 'client',
    };
    const contacts = buildContactsHook({ contacts: [clientOnly, clientInFamily] });

    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
      />
    );

    expect(screen.getByText(/Cara Client/)).toHaveTextContent('Cara Client 🤝');
    expect(screen.getByText(/Finn FamilyClient/)).toHaveTextContent(
      'Finn FamilyClient 👨‍👩‍👧 🤝'
    );
  });

  it('shows certificate emoji when has_completion_certificate is true', () => {
    const row: components['schemas']['AdminContact'] = {
      id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      email: null,
      instagram_handle: null,
      phone_region: null,
      phone_national_number: null,
      phone_e164: null,
      contact_type: 'parent',
      relationship_type: 'prospect',
      source: 'manual',
      mailchimp_status: 'pending',
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      tag_ids: [],
      tags: [],
      standalone_note_count: 0,
      has_completion_certificate: true,
      has_sales_conversation: false,
      has_service_instance: false,
      has_invoice: false,
      first_name: 'Grad',
      last_name: 'uate',
      family_ids: [],
      organization_ids: [],
      family_location_summary: null,
      organization_location_summary: null,
    };
    render(
      <ContactsPanel
        contacts={buildContactsHook({ contacts: [row] })}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
      />
    );
    expect(screen.getByText(/Grad uate/)).toHaveTextContent('Grad uate 🎓');
  });

  it('shows related-record operation links only when those records exist', () => {
    const withLinks: components['schemas']['AdminContact'] = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      first_name: 'Linked',
      last_name: 'Person',
      email: null,
      instagram_handle: null,
      phone_region: null,
      phone_national_number: null,
      phone_e164: null,
      contact_type: 'parent',
      relationship_type: 'client',
      source: 'manual',
      mailchimp_status: 'pending',
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      tag_ids: [],
      tags: [],
      family_ids: [],
      organization_ids: [],
      family_location_summary: null,
      organization_location_summary: null,
      standalone_note_count: 0,
      has_completion_certificate: false,
      has_sales_conversation: true,
      sales_conversation_channel: 'instagram',
      has_service_instance: true,
      has_invoice: true,
    };
    const withoutLinks: components['schemas']['AdminContact'] = {
      ...withLinks,
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      first_name: 'Plain',
      last_name: 'Person',
      has_sales_conversation: false,
      sales_conversation_channel: null,
      has_service_instance: false,
      has_invoice: false,
    };

    render(
      <ContactsPanel
        contacts={buildContactsHook({ contacts: [withLinks, withoutLinks] })}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
      />
    );

    const salesLink = screen.getByRole('link', { name: 'Sales conversations' });
    expect(salesLink).toHaveAttribute(
      'href',
      '/sales?tab=instagram&contact=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    );
    expect(salesLink).toHaveClass('h-8', 'px-3');
    expect(screen.getByRole('link', { name: 'Service instances' })).toHaveAttribute(
      'href',
      '/services?contact=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    );
    expect(screen.getByRole('link', { name: 'Invoices' })).toHaveAttribute(
      'href',
      '/assets?tag=customer_invoice&query=Linked+Person'
    );
    expect(screen.getAllByRole('link', { name: 'Sales conversations' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Service instances' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Invoices' })).toHaveLength(1);
  });

  it('shows read-only family and organisation venue lines in the Location box when the row is selected', async () => {
    const user = userEvent.setup();
    const summary = {
      id: 'loc-1',
      name: 'Studio',
      area_id: 'area-hk',
      area_name: 'Hong Kong',
      address: '1 Road',
      lat: 22.1,
      lng: 114.2,
    };
    const row: components['schemas']['AdminContact'] = {
      id: '11111111-1111-1111-1111-111111111111',
      first_name: 'Pat',
      last_name: 'Both',
      email: null,
      instagram_handle: null,
      phone_region: null,
      phone_national_number: null,
      phone_e164: null,
      contact_type: 'parent',
      relationship_type: 'prospect',
      source: 'manual',
      mailchimp_status: 'pending',
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      tag_ids: [],
      tags: [],
      family_ids: ['fam-1'],
      organization_ids: ['org-1'],
      family_location_summary: summary,
      organization_location_summary: summary,
      standalone_note_count: 0,
      has_completion_certificate: false,
      has_sales_conversation: false,
      has_service_instance: false,
      has_invoice: false,
    };
    const contacts = buildContactsHook({ contacts: [row] });

    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
      />
    );

    await user.click(screen.getByText('Pat Both'));
    await user.click(screen.getByText('Location', { selector: 'summary' }));

    const familyLines = screen.getAllByText(/👨‍👩‍👧 1 Road · Hong Kong/);
    expect(familyLines.length).toBeGreaterThanOrEqual(1);
    const orgLines = screen.getAllByText(/🏢 1 Road · Hong Kong/);
    expect(orgLines.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText('Read-only. Edit addresses on the family and organisation records.')
    ).toBeInTheDocument();
  });

  it('calls deleteContact when Delete is confirmed', async () => {
    const user = userEvent.setup();
    const deleteContact = vi.fn().mockResolvedValue(undefined);
    const refreshFamilyOrgLists = vi.fn().mockResolvedValue(undefined);
    const row: components['schemas']['AdminContact'] = {
      id: '11111111-1111-1111-1111-111111111111',
      first_name: 'Ann',
      last_name: 'Lee',
      email: null,
      instagram_handle: null,
      phone_region: null,
      phone_national_number: null,
      phone_e164: null,
      contact_type: 'parent',
      relationship_type: 'prospect',
      source: 'manual',
      mailchimp_status: 'pending',
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      tag_ids: [],
      tags: [],
      family_ids: [],
      organization_ids: [],
      standalone_note_count: 0,
      has_completion_certificate: false,
      has_sales_conversation: false,
      has_service_instance: false,
      has_invoice: false,
    };
    const contacts = buildContactsHook({
      deleteContact,
      contacts: [row],
    });

    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        refreshFamilyOrgLists={refreshFamilyOrgLists}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Delete contact' }));

    expect(deleteContact).toHaveBeenCalledWith(row.id);
    await waitFor(() => {
      expect(refreshFamilyOrgLists).toHaveBeenCalledTimes(1);
    });
  });

  it('shows list error from the hook in the table card', async () => {
    const contacts = buildContactsHook({ error: 'Failed to load contacts' });

    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load contacts')).toBeInTheDocument();
    });
  });

  it('shows read-only location summary when contact is linked to family', async () => {
    const user = userEvent.setup();
    const row: components['schemas']['AdminContact'] = {
      id: '11111111-1111-1111-1111-111111111111',
      first_name: 'Ann',
      last_name: 'Lee',
      email: null,
      instagram_handle: null,
      phone_region: null,
      phone_national_number: null,
      phone_e164: null,
      contact_type: 'parent',
      relationship_type: 'prospect',
      source: 'manual',
      mailchimp_status: 'pending',
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      tag_ids: [],
      tags: [],
      family_ids: ['fam-1'],
      organization_ids: [],
      location_id: 'loc-1',
      location_summary: {
        id: 'loc-1',
        name: 'Studio',
        area_id: 'area-hk',
        area_name: 'Hong Kong',
        address: '1 Road',
        lat: 22.1,
        lng: 114.2,
      },
      family_location_summary: {
        id: 'loc-1',
        name: 'Studio',
        area_id: 'area-hk',
        area_name: 'Hong Kong',
        address: '1 Road',
        lat: 22.1,
        lng: 114.2,
      },
      organization_location_summary: null,
      standalone_note_count: 0,
      has_completion_certificate: false,
      has_sales_conversation: false,
      has_service_instance: false,
      has_invoice: false,
    };
    const contacts = buildContactsHook({ contacts: [row] });

    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[hkArea]}
        areasLoading={false}
        refreshLocations={noopRefresh}
      />
    );

    await user.click(screen.getByText('Ann Lee'));
    await user.click(screen.getByText('Location', { selector: 'summary' }));

    expect(screen.getAllByText(/👨‍👩‍👧 1 Road · Hong Kong/).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText('Location is managed on the linked family or organisation.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('includes location_id on create after filling location and creating the contact', async () => {
    const user = userEvent.setup();
    const createContact = vi.fn().mockResolvedValue(null);
    const contacts = buildContactsHook({ createContact });

    createLocation.mockResolvedValue({
      id: 'loc-new',
      name: null,
      areaId: 'area-hk',
      address: '1 Test Road',
      lat: 22.3193,
      lng: 114.1694,
      createdAt: null,
      updatedAt: null,
      lockedFromPartnerOrg: false,
      partnerOrganizationLabels: [],
      partnerOrganizationIds: [],
    });
    geocodeVenueAddress.mockResolvedValue({
      lat: 22.3193,
      lng: 114.1694,
      displayName: null,
    });

    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[hkArea]}
        areasLoading={false}
        refreshLocations={noopRefresh}
      />
    );

    await user.click(screen.getByText('Location', { selector: 'summary' }));
    await user.type(screen.getByLabelText('First name'), 'Jane');
    await user.selectOptions(screen.getByLabelText('Geographic area'), 'area-hk');
    await user.type(screen.getByLabelText('Address'), '1 Test Road');
    await user.click(screen.getByRole('button', { name: 'Fill coordinates from address' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Latitude')).toHaveValue('22.3193');
    });

    await user.click(screen.getByRole('button', { name: 'Create contact' }));

    await waitFor(() => {
      expect(createLocation).toHaveBeenCalledWith(
        expect.objectContaining({
          area_id: 'area-hk',
          address: '1 Test Road',
          lat: 22.3193,
          lng: 114.1694,
          name: null,
        })
      );
    });
    expect(createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'Jane',
        location_id: 'loc-new',
      })
    );
    expect(screen.queryByRole('button', { name: 'Save location' })).not.toBeInTheDocument();
  });

  it('disables Create contact when the location draft is invalid', async () => {
    const user = userEvent.setup();
    const createContact = vi.fn().mockResolvedValue(null);
    const contacts = buildContactsHook({ createContact });

    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[hkArea]}
        areasLoading={false}
        refreshLocations={noopRefresh}
      />
    );

    await user.click(screen.getByText('Location', { selector: 'summary' }));
    await user.type(screen.getByLabelText('First name'), 'Jane');
    await user.selectOptions(screen.getByLabelText('Geographic area'), 'area-hk');
    await user.type(screen.getByLabelText('Latitude'), '22.3');

    expect(screen.getByRole('button', { name: 'Create contact' })).toBeDisabled();
    expect(createContact).not.toHaveBeenCalled();
  });

  it('sends location_id null on update after Clear', async () => {
    const user = userEvent.setup();
    const updateContact = vi.fn().mockResolvedValue(null);
    const refreshFamilyOrgLists = vi.fn().mockResolvedValue(undefined);
    const row: components['schemas']['AdminContact'] = {
      id: '22222222-2222-2222-2222-222222222222',
      first_name: 'Bob',
      last_name: null,
      email: null,
      instagram_handle: null,
      phone_region: null,
      phone_national_number: null,
      phone_e164: null,
      contact_type: 'parent',
      relationship_type: 'prospect',
      source: 'manual',
      mailchimp_status: 'pending',
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      tag_ids: [],
      tags: [],
      family_ids: [],
      organization_ids: [],
      location_id: 'loc-1',
      location_summary: null,
      standalone_note_count: 0,
      has_completion_certificate: false,
      has_sales_conversation: false,
      has_service_instance: false,
      has_invoice: false,
    };
    const contacts = buildContactsHook({
      updateContact,
      contacts: [row],
    });

    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[
          {
            id: 'loc-1',
            name: null,
            areaId: 'area-hk',
            address: 'X',
            lat: null,
            lng: null,
            createdAt: null,
            updatedAt: null,
            lockedFromPartnerOrg: false,
            partnerOrganizationLabels: [],
            partnerOrganizationIds: [],
          },
        ]}
        geographicAreas={[hkArea]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        refreshFamilyOrgLists={refreshFamilyOrgLists}
      />
    );

    await user.click(screen.getByText('Bob'));
    await user.click(screen.getByText('Location', { selector: 'summary' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'Update contact' }));

    expect(updateContact).toHaveBeenCalledWith(
      row.id,
      expect.objectContaining({
        location_id: null,
      })
    );
    expect(updateLocationPartial).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(refreshFamilyOrgLists).toHaveBeenCalledTimes(1);
    });
  });

  it('does not render the Mailchimp sync card on the contacts list', () => {
    const contacts = buildContactsHook();
    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
        refreshFamilyOrgLists={vi.fn()}
      />
    );
    expect(screen.queryByRole('heading', { name: 'Mailchimp sync' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contact' })).toBeInTheDocument();
  });

  it('opens the matching contact in the editor from the contact query param', async () => {
    window.history.replaceState(null, '', '/contacts?contact=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    const row: components['schemas']['AdminContact'] = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      first_name: 'Ann',
      last_name: 'Family',
      email: null,
      instagram_handle: null,
      phone_region: null,
      phone_national_number: null,
      phone_e164: null,
      contact_type: 'parent',
      relationship_type: 'prospect',
      source: 'manual',
      mailchimp_status: 'pending',
      active: true,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      tag_ids: [],
      tags: [],
      standalone_note_count: 0,
      has_completion_certificate: false,
      has_sales_conversation: false,
      has_service_instance: false,
      has_invoice: false,
      family_ids: [],
      organization_ids: [],
      family_location_summary: null,
      organization_location_summary: null,
    };
    const contacts = buildContactsHook({ contacts: [row] });

    render(
      <ContactsPanel
        contacts={contacts}
        adminUsers={[]}
        onPatchStandaloneNoteCount={vi.fn()}
        tags={[]}
        locations={[]}
        geographicAreas={[]}
        areasLoading={false}
        refreshLocations={noopRefresh}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('First name')).toHaveValue('Ann');
    });
    expect(screen.getByLabelText('Last name')).toHaveValue('Family');
    expect(screen.getByRole('button', { name: 'Update contact' })).toBeInTheDocument();
  });
});
