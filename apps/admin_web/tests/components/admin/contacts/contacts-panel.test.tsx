import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { createLocation, geocodeVenueAddress, updateLocationPartial, getAdminContact, listAdminContactNotes } =
  vi.hoisted(() => ({
    createLocation: vi.fn(),
    geocodeVenueAddress: vi.fn(),
    updateLocationPartial: vi.fn().mockResolvedValue(null),
    getAdminContact: vi.fn(),
    listAdminContactNotes: vi.fn().mockResolvedValue([]),
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
    getAdminContact,
    listAdminContactNotes,
  };
});

type AdminContact = components['schemas']['AdminContact'];

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

function buildContact(overrides: Partial<AdminContact> = {}): AdminContact {
  return {
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
    family_location_summary: null,
    organization_location_summary: null,
    standalone_note_count: 0,
    has_completion_certificate: false,
    has_sales_conversation: false,
    has_service_instance: false,
    has_invoice: false,
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

type PanelProps = Partial<Parameters<typeof ContactsPanel>[0]>;

function renderPanel(props: PanelProps = {}) {
  return render(
    <ContactsPanel
      contacts={buildContactsHook()}
      adminUsers={[]}
      onPatchStandaloneNoteCount={vi.fn()}
      tags={[]}
      locations={[]}
      geographicAreas={[]}
      areasLoading={false}
      refreshLocations={noopRefresh}
      {...props}
    />
  );
}

async function openMoreActions(user: ReturnType<typeof userEvent.setup>, rowTestId: string) {
  const row = screen.getByTestId(rowTestId);
  await user.click(within(row).getByRole('button', { name: 'More actions' }));
  return screen.getByRole('menu', { name: 'More actions' });
}

describe('ContactsPanel', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/contacts');
    getAdminContact.mockReset();
    listAdminContactNotes.mockClear();
  });

  it('starts with the table only and opens a draft row from the + button', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Contact' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Contacts' })).toBeInTheDocument();
    expect(screen.getByText('No contacts match the current filters.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New contact' }));

    expect(window.location.search).toBe('?contact=new');
    const draftRow = screen.getByTestId('admin-row-new');
    expect(draftRow).toHaveAttribute('data-draft', 'true');
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create contact' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New contact' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'New contact' }));
    expect(window.location.search).toBe('');
    await waitFor(() => {
      expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    });
  });

  it('submits create with relationship types that exclude vendor and collapses the draft', async () => {
    const user = userEvent.setup();
    const createContact = vi.fn().mockResolvedValue(null);
    const contacts = buildContactsHook({ createContact });
    const refreshFamilyOrgLists = vi.fn().mockResolvedValue(undefined);

    renderPanel({ contacts, refreshFamilyOrgLists });

    await user.click(screen.getByRole('button', { name: 'New contact' }));
    await user.type(screen.getByLabelText('First name'), 'Jane');
    await user.type(screen.getByLabelText('Job title'), 'Head teacher');
    await user.click(screen.getByRole('button', { name: 'Create contact' }));

    expect(createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'Jane',
        relationship_type: 'prospect',
        contact_type: 'parent',
        job_title: 'Head teacher',
      })
    );
    await waitFor(() => {
      expect(refreshFamilyOrgLists).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
  });

  it('loads the next page when Load more is available', async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn().mockResolvedValue(undefined);
    renderPanel({ contacts: buildContactsHook({ hasMore: true, loadMore }) });

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(loadMore).toHaveBeenCalled();
  });

  it('shows family and organisation emoji after the name when the contact is linked', () => {
    const familyOnly = buildContact({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      first_name: 'Ann',
      last_name: 'Family',
      family_ids: ['fam-1'],
    });
    const orgOnly = buildContact({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      first_name: 'Bob',
      last_name: 'Org',
      organization_ids: ['org-1'],
    });
    const both = buildContact({
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      first_name: 'Pat',
      last_name: 'Both',
      family_ids: ['fam-2'],
      organization_ids: ['org-2'],
    });
    renderPanel({ contacts: buildContactsHook({ contacts: [familyOnly, orgOnly, both] }) });

    expect(screen.getByText(/Ann Family/)).toHaveTextContent('Ann Family 👨‍👩‍👧');
    expect(screen.getByText(/Bob Org/)).toHaveTextContent('Bob Org 🏢');
    expect(screen.getByText(/Pat Both/)).toHaveTextContent('Pat Both 👨‍👩‍👧 🏢');
  });

  it('shows client emoji after the name when relationship_type is client', () => {
    const clientOnly = buildContact({
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      first_name: 'Cara',
      last_name: 'Client',
      relationship_type: 'client',
    });
    const clientInFamily = buildContact({
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      first_name: 'Finn',
      last_name: 'FamilyClient',
      family_ids: ['fam-1'],
      relationship_type: 'client',
    });
    renderPanel({ contacts: buildContactsHook({ contacts: [clientOnly, clientInFamily] }) });

    expect(screen.getByText(/Cara Client/)).toHaveTextContent('Cara Client 🤝');
    expect(screen.getByText(/Finn FamilyClient/)).toHaveTextContent(
      'Finn FamilyClient 👨‍👩‍👧 🤝'
    );
  });

  it('shows certificate emoji when has_completion_certificate is true', () => {
    const row = buildContact({
      id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      first_name: 'Grad',
      last_name: 'uate',
      has_completion_certificate: true,
    });
    renderPanel({ contacts: buildContactsHook({ contacts: [row] }) });
    expect(screen.getByText(/Grad uate/)).toHaveTextContent('Grad uate 🎓');
  });

  it('keeps Notes inline and moves related-record links into the More actions menu', async () => {
    const user = userEvent.setup();
    const withLinks = buildContact({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      first_name: 'Linked',
      last_name: 'Person',
      relationship_type: 'client',
      has_sales_conversation: true,
      sales_conversation_channel: 'instagram',
      has_service_instance: true,
      has_invoice: true,
      standalone_note_count: 3,
    });
    const withoutLinks = buildContact({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      first_name: 'Plain',
      last_name: 'Person',
      sales_conversation_channel: null,
    });

    renderPanel({ contacts: buildContactsHook({ contacts: [withLinks, withoutLinks] }) });

    const linkedRow = screen.getByTestId(`admin-row-${withLinks.id}`);
    const inlineButtons = within(linkedRow).getAllByRole('button');
    expect(inlineButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Expand Linked Person',
      'Contact notes',
      'More actions',
    ]);
    expect(within(linkedRow).getByRole('button', { name: 'Contact notes' })).toHaveTextContent('3');

    const menu = await openMoreActions(user, `admin-row-${withLinks.id}`);
    expect(within(menu).getByRole('menuitem', { name: 'Sales conversations' })).toHaveAttribute(
      'href',
      '/sales?tab=instagram&contact=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    );
    expect(within(menu).getByRole('menuitem', { name: 'Service instances' })).toHaveAttribute(
      'href',
      '/services?contact=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    );
    expect(within(menu).getByRole('menuitem', { name: 'Invoices' })).toHaveAttribute(
      'href',
      '/assets?tag=customer_invoice&query=Linked+Person'
    );
    expect(within(menu).getByRole('menuitem', { name: 'Archive contact' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Delete contact' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    const plainMenu = await openMoreActions(user, `admin-row-${withoutLinks.id}`);
    expect(within(plainMenu).queryByRole('menuitem', { name: 'Sales conversations' })).not.toBeInTheDocument();
    expect(within(plainMenu).queryByRole('menuitem', { name: 'Service instances' })).not.toBeInTheDocument();
    expect(within(plainMenu).queryByRole('menuitem', { name: 'Invoices' })).not.toBeInTheDocument();
    expect(within(plainMenu).getAllByRole('menuitem')).toHaveLength(2);
  });

  it('expands a row into the editor and syncs the open record to the URL', async () => {
    const user = userEvent.setup();
    const ann = buildContact({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', first_name: 'Ann', last_name: 'Lee' });
    const bob = buildContact({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', first_name: 'Bob', last_name: 'Ray', email: 'bob@example.com' });
    renderPanel({ contacts: buildContactsHook({ contacts: [ann, bob] }) });

    await user.click(screen.getByText('Ann Lee'));

    expect(window.location.search).toBe(`?contact=${ann.id}`);
    expect(screen.getByTestId(`admin-row-${ann.id}`)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('First name')).toHaveValue('Ann');
    expect(screen.getByRole('button', { name: 'Update contact' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

    await user.click(screen.getByText('Bob Ray'));

    expect(window.location.search).toBe(`?contact=${bob.id}`);
    expect(screen.getByTestId(`admin-row-${ann.id}`)).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => {
      expect(screen.getByLabelText('First name')).toHaveValue('Bob');
    });
    expect(screen.getByLabelText('Email')).toHaveValue('bob@example.com');

    await user.click(screen.getByRole('button', { name: 'Collapse Bob Ray' }));
    expect(window.location.search).toBe('');
  });

  it('asks before discarding unsaved edits when switching rows', async () => {
    const user = userEvent.setup();
    const ann = buildContact({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', first_name: 'Ann', last_name: 'Lee' });
    const bob = buildContact({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', first_name: 'Bob', last_name: 'Ray' });
    renderPanel({ contacts: buildContactsHook({ contacts: [ann, bob] }) });

    await user.click(screen.getByText('Ann Lee'));
    await user.type(screen.getByLabelText('Last name'), 'x');
    await user.click(screen.getByText('Bob Ray'));

    const dialog = screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
    expect(window.location.search).toBe(`?contact=${ann.id}`);

    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Last name')).toHaveValue('Leex');

    await user.click(screen.getByText('Bob Ray'));
    await user.click(
      within(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).getByRole('button', {
        name: 'Discard changes',
      })
    );
    expect(window.location.search).toBe(`?contact=${bob.id}`);
    await waitFor(() => {
      expect(screen.getByLabelText('Last name')).toHaveValue('Ray');
    });
  });

  it('opens the row with the Notes disclosure from the notes action', async () => {
    const user = userEvent.setup();
    const row = buildContact({ standalone_note_count: 2 });
    renderPanel({ contacts: buildContactsHook({ contacts: [row] }) });

    await user.click(screen.getByRole('button', { name: 'Contact notes' }));

    expect(screen.getByTestId(`admin-row-${row.id}`)).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Notes/ })).toHaveAttribute('aria-expanded', 'true');
    });
    await waitFor(() => {
      expect(listAdminContactNotes).toHaveBeenCalledWith(row.id, expect.any(AbortSignal));
    });
    // Notes are a nested table-first list: `+` opens the draft row with the composer.
    expect(screen.getByRole('region', { name: 'Notes' })).toHaveAttribute('data-embedded', 'true');
    expect(screen.queryByRole('textbox', { name: 'New note' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New note' }));
    expect(screen.getByRole('textbox', { name: 'New note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Notes ·/ })).not.toBeInTheDocument();
  });

  it('shows read-only family and organisation venue lines in the Location box when the row is expanded', async () => {
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
    const row = buildContact({
      first_name: 'Pat',
      last_name: 'Both',
      family_ids: ['fam-1'],
      organization_ids: ['org-1'],
      family_location_summary: summary,
      organization_location_summary: summary,
    });
    renderPanel({ contacts: buildContactsHook({ contacts: [row] }) });

    await user.click(screen.getByText('Pat Both'));
    await user.click(screen.getByRole('button', { name: /^Location/ }));

    expect(screen.getAllByText(/👨‍👩‍👧 1 Road · Hong Kong/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/🏢 1 Road · Hong Kong/).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText('Read-only. Edit addresses on the family and organisation records.')
    ).toBeInTheDocument();
  });

  it('calls deleteContact from the More actions menu when Delete is confirmed', async () => {
    const user = userEvent.setup();
    const deleteContact = vi.fn().mockResolvedValue(undefined);
    const refreshFamilyOrgLists = vi.fn().mockResolvedValue(undefined);
    const row = buildContact();
    renderPanel({
      contacts: buildContactsHook({ deleteContact, contacts: [row] }),
      refreshFamilyOrgLists,
    });

    const menu = await openMoreActions(user, `admin-row-${row.id}`);
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete contact' }));

    await waitFor(() => {
      expect(deleteContact).toHaveBeenCalledWith(row.id);
    });
    await waitFor(() => {
      expect(refreshFamilyOrgLists).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId(`admin-row-${row.id}`)).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows list error from the hook above the table', async () => {
    renderPanel({ contacts: buildContactsHook({ error: 'Failed to load contacts' }) });

    await waitFor(() => {
      expect(screen.getByText('Failed to load contacts')).toBeInTheDocument();
    });
  });

  it('shows read-only location summary when contact is linked to family', async () => {
    const user = userEvent.setup();
    const row = buildContact({
      family_ids: ['fam-1'],
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
    });
    renderPanel({ contacts: buildContactsHook({ contacts: [row] }), geographicAreas: [hkArea] });

    await user.click(screen.getByText('Ann Lee'));
    await user.click(screen.getByRole('button', { name: /^Location/ }));

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

    renderPanel({ contacts: buildContactsHook({ createContact }), geographicAreas: [hkArea] });

    await user.click(screen.getByRole('button', { name: 'New contact' }));
    await user.click(screen.getByRole('button', { name: /^Location/ }));
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
    renderPanel({ contacts: buildContactsHook({ createContact }), geographicAreas: [hkArea] });

    await user.click(screen.getByRole('button', { name: 'New contact' }));
    await user.click(screen.getByRole('button', { name: /^Location/ }));
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
    const row = buildContact({
      id: '22222222-2222-2222-2222-222222222222',
      first_name: 'Bob',
      last_name: null,
      location_id: 'loc-1',
      location_summary: null,
    });
    renderPanel({
      contacts: buildContactsHook({ updateContact, contacts: [row] }),
      locations: [
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
      ],
      geographicAreas: [hkArea],
      refreshFamilyOrgLists,
    });

    await user.click(screen.getByText('Bob'));
    await user.click(screen.getByRole('button', { name: /^Location/ }));
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
    expect(window.location.search).toBe(`?contact=${row.id}`);
  });

  it('does not render the Mailchimp sync card on the contacts list', () => {
    renderPanel({ refreshFamilyOrgLists: vi.fn() });
    expect(screen.queryByTestId('mailchimp-sync-card')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Contacts' })).toBeInTheDocument();
  });

  it('expands the matching contact from the contact query param', async () => {
    const row = buildContact({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      first_name: 'Ann',
      last_name: 'Family',
    });
    window.history.replaceState(null, '', `/contacts?contact=${row.id}`);
    renderPanel({ contacts: buildContactsHook({ contacts: [row] }) });

    await waitFor(() => {
      expect(screen.getByLabelText('First name')).toHaveValue('Ann');
    });
    expect(screen.getByLabelText('Last name')).toHaveValue('Family');
    expect(screen.getByTestId(`admin-row-${row.id}`)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Update contact' })).toBeInTheDocument();
    expect(getAdminContact).not.toHaveBeenCalled();
  });

  it('fetches and pins a deep-linked contact that is not in the loaded pages', async () => {
    const listed = buildContact({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', first_name: 'Ann', last_name: 'Lee' });
    const pinned = buildContact({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', first_name: 'Zed', last_name: 'Far' });
    getAdminContact.mockResolvedValue(pinned);
    window.history.replaceState(null, '', `/contacts?contact=${pinned.id}`);

    renderPanel({ contacts: buildContactsHook({ contacts: [listed] }) });

    await waitFor(() => {
      expect(getAdminContact).toHaveBeenCalledWith(pinned.id);
    });
    await waitFor(() => {
      expect(screen.getByLabelText('First name')).toHaveValue('Zed');
    });
    const rows = screen.getAllByRole('row').filter((row) => row.getAttribute('data-testid')?.startsWith('admin-row-') && !row.getAttribute('data-testid')?.endsWith('-detail'));
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      `admin-row-${pinned.id}`,
      `admin-row-${listed.id}`,
    ]);
  });

  it('collapses the deep link when the contact cannot be loaded', async () => {
    getAdminContact.mockRejectedValue(new Error('missing'));
    window.history.replaceState(null, '', '/contacts?contact=99999999-9999-9999-9999-999999999999');

    renderPanel({ contacts: buildContactsHook({ contacts: [buildContact()] }) });

    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
  });
});
