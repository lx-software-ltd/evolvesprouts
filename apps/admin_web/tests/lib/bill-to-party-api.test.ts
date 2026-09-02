import { beforeEach, describe, expect, it, vi } from 'vitest';

const entityMocks = vi.hoisted(() => ({
  createAdminContact: vi.fn(),
  createAdminFamily: vi.fn(),
  createAdminOrganization: vi.fn(),
  listAdminFamilies: vi.fn(),
  listAdminOrganizations: vi.fn(),
  searchEntityContactsForPicker: vi.fn(),
}));

vi.mock('@/lib/entity-api', () => ({
  createAdminContact: entityMocks.createAdminContact,
  createAdminFamily: entityMocks.createAdminFamily,
  createAdminOrganization: entityMocks.createAdminOrganization,
  listAdminFamilies: entityMocks.listAdminFamilies,
  listAdminOrganizations: entityMocks.listAdminOrganizations,
  searchEntityContactsForPicker: entityMocks.searchEntityContactsForPicker,
}));

import {
  createBillToParty,
  isBillToPartyReady,
  searchBillToParties,
} from '@/lib/bill-to-party-api';

describe('bill-to-party-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats existing and long-enough create values as ready', () => {
    expect(isBillToPartyReady({ status: 'empty' }, 2)).toBe(false);
    expect(isBillToPartyReady({ status: 'create', query: 'A' }, 2)).toBe(false);
    expect(isBillToPartyReady({ status: 'create', query: 'Ada' }, 2)).toBe(true);
    expect(
      isBillToPartyReady({ status: 'existing', id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', label: 'Ada' }, 2),
    ).toBe(true);
  });

  it('searches contacts after two characters', async () => {
    entityMocks.searchEntityContactsForPicker.mockResolvedValue([
      { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', label: 'Pat Contact' },
    ]);
    await expect(searchBillToParties('contact', 'Pa')).resolves.toEqual([
      { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', label: 'Pat Contact' },
    ]);
    expect(entityMocks.searchEntityContactsForPicker).toHaveBeenCalledWith(
      { query: 'Pa', limit: 50 },
      undefined,
    );
  });

  it('creates a contact from a phone query', async () => {
    entityMocks.createAdminContact.mockResolvedValue({
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      first_name: '91234567',
      email: null,
    });
    await createBillToParty('contact', '91234567');
    expect(entityMocks.createAdminContact).toHaveBeenCalledWith({
      first_name: '91234567',
      contact_type: 'parent',
      source: 'manual',
      relationship_type: 'prospect',
      phone_region: 'HK',
      phone_number: '91234567',
    });
  });

  it('creates a contact with parent, manual, and prospect defaults', async () => {
    entityMocks.createAdminContact.mockResolvedValue({
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: null,
    });
    await expect(createBillToParty('contact', 'Ada Lovelace')).resolves.toMatchObject({
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    });
    expect(entityMocks.createAdminContact).toHaveBeenCalledWith({
      first_name: 'Ada',
      last_name: 'Lovelace',
      contact_type: 'parent',
      source: 'manual',
      relationship_type: 'prospect',
    });
  });

  it('creates a family from the typed name', async () => {
    entityMocks.createAdminFamily.mockResolvedValue({
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      family_name: 'Chan',
      members: [],
    });
    await createBillToParty('family', 'Chan');
    expect(entityMocks.createAdminFamily).toHaveBeenCalledWith({
      family_name: 'Chan',
      relationship_type: 'prospect',
    });
  });

  it('creates an organization as a company prospect', async () => {
    entityMocks.createAdminOrganization.mockResolvedValue({
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      name: 'Acme',
      members: [],
    });
    await createBillToParty('organization', 'Acme');
    expect(entityMocks.createAdminOrganization).toHaveBeenCalledWith({
      name: 'Acme',
      organization_type: 'company',
      relationship_type: 'prospect',
    });
  });

  it('creates a partner organization', async () => {
    entityMocks.createAdminOrganization.mockResolvedValue({
      id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      name: 'Partner Org',
      members: [],
    });
    await createBillToParty('partner', 'Partner Org');
    expect(entityMocks.createAdminOrganization).toHaveBeenCalledWith({
      name: 'Partner Org',
      organization_type: 'company',
      relationship_type: 'partner',
    });
  });
});
