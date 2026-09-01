import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useEnrollmentParentPickers } from '@/hooks/use-enrollment-parent-pickers';

import type { components } from '@/types/generated/admin-api.generated';

type AdminContact = components['schemas']['AdminContact'];

vi.mock('@/lib/entity-api', () => ({
  listAdminContacts: vi.fn(),
  listEntityFamilyPicker: vi.fn(),
  listEntityOrganizationPicker: vi.fn(),
  listEntityPartnerOrganizationPicker: vi.fn(),
}));

function makeContact(overrides: Partial<AdminContact> & Pick<AdminContact, 'id' | 'first_name'>): AdminContact {
  return {
    email: null,
    instagram_handle: null,
    last_name: null,
    phone_region: null,
    phone_national_number: null,
    date_of_birth: null,
    location_id: null,
    location_summary: null,
    family_location_summary: null,
    organization_location_summary: null,
    source_detail: null,
    referral_contact_id: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    contact_type: 'parent',
    relationship_type: 'client',
    source: 'manual',
    mailchimp_status: 'pending',
    active: true,
    tag_ids: [],
    tags: [],
    family_ids: [],
    organization_ids: [],
    standalone_note_count: 0,
    has_completion_certificate: false,
    has_sales_conversation: false,
    has_service_instance: false,
    has_invoice: false,
    ...overrides,
  };
}

describe('useEnrollmentParentPickers', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('excludes contacts that belong to at least one family from contactOptions', async () => {
    const entityApi = await import('@/lib/entity-api');
    vi.mocked(entityApi.listEntityFamilyPicker).mockResolvedValue([]);
    vi.mocked(entityApi.listEntityOrganizationPicker).mockResolvedValue([]);
    vi.mocked(entityApi.listEntityPartnerOrganizationPicker).mockResolvedValue([]);
    vi.mocked(entityApi.listAdminContacts).mockResolvedValue({
      items: [
        makeContact({
          id: 'contact-in-family',
          first_name: 'InFamily',
          family_ids: ['family-1'],
        }),
        makeContact({
          id: 'contact-standalone',
          first_name: 'Standalone',
          family_ids: [],
        }),
      ],
      nextCursor: null,
      totalCount: 2,
    });

    const { result } = renderHook(() => useEnrollmentParentPickers(true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contactOptions).toEqual([
      { id: 'contact-standalone', label: expect.stringContaining('Standalone') },
    ]);
  });
});
