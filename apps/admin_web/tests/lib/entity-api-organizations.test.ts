import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAdminApiRequest } = vi.hoisted(() => ({
  mockAdminApiRequest: vi.fn(),
}));

vi.mock('@/lib/api-admin-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-admin-client')>(
    '@/lib/api-admin-client'
  );
  return {
    ...actual,
    adminApiRequest: mockAdminApiRequest,
  };
});

import {
  addAdminOrganizationMember,
  createAdminOrganization,
  deleteAdminOrganization,
  listAdminOrganizations,
  patchAdminOrganizationMember,
  removeAdminOrganizationMember,
  updateAdminOrganization,
} from '@/lib/entity-api';

const orgPayload = {
  id: 'partner-1',
  name: 'Alpha Partner',
  organization_type: 'company',
  relationship_type: 'partner',
  slug: 'alpha',
  website: null,
  location_id: null,
  location_summary: null,
  active: true,
  archived_at: null,
  created_at: null,
  updated_at: null,
  tag_ids: [],
  tags: [],
  members: [],
};

describe('entity-api organizations', () => {
  beforeEach(() => {
    mockAdminApiRequest.mockReset();
  });

  it('lists organisations without a relationship filter by default', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({ items: [], next_cursor: null, total_count: 0 });

    await listAdminOrganizations({ query: 'x' });

    const request = mockAdminApiRequest.mock.calls[0][0];
    expect(request.endpointPath).toBe('/v1/admin/organizations?query=x');
  });

  it('lists partners with relationship_type=partner and a clamped limit', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      items: [orgPayload],
      next_cursor: 'c1',
      total_count: 1,
    });

    const result = await listAdminOrganizations({
      query: 'alpha',
      active: 'true',
      relationshipType: 'partner',
      cursor: 'abc',
      limit: 10,
    });

    expect(result.totalCount).toBe(1);
    expect(result.nextCursor).toBe('c1');
    expect(result.items[0]).toMatchObject({ id: 'partner-1', relationship_type: 'partner' });

    const request = mockAdminApiRequest.mock.calls[0][0];
    expect(request.method).toBe('GET');
    expect(request.endpointPath).toBe(
      '/v1/admin/organizations?relationship_type=partner&query=alpha&active=true&cursor=abc&limit=10'
    );
  });

  it('lists vendors sorted by name', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({ items: [], next_cursor: null, total_count: 0 });

    await listAdminOrganizations({ relationshipType: 'vendor', sort: 'name', limit: 500 });

    const request = mockAdminApiRequest.mock.calls[0][0];
    expect(request.endpointPath).toBe('/v1/admin/organizations?relationship_type=vendor&sort=name&limit=100');
  });

  it('creates an organisation', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({ organization: orgPayload });

    await createAdminOrganization({
      name: 'Beta',
      organization_type: 'ngo',
      relationship_type: 'partner',
      website: null,
      location_id: null,
      tag_ids: [],
    });

    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/admin/organizations',
        method: 'POST',
        body: expect.objectContaining({
          name: 'Beta',
          relationship_type: 'partner',
        }),
      })
    );
  });

  it('updates and deletes an organisation', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({ organization: orgPayload });
    await updateAdminOrganization('partner-1', { name: 'Alpha Updated' });
    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/admin/organizations/partner-1',
        method: 'PATCH',
      })
    );

    mockAdminApiRequest.mockResolvedValueOnce(undefined);
    await deleteAdminOrganization('partner-1');
    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/admin/organizations/partner-1',
        method: 'DELETE',
        expectedSuccessStatuses: [204],
      })
    );
  });

  it('member wrappers call members routes', async () => {
    mockAdminApiRequest.mockResolvedValue({ organization: orgPayload });
    await addAdminOrganizationMember('partner-1', { contact_id: 'c1', is_primary_contact: false });
    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/admin/organizations/partner-1/members',
        method: 'POST',
      })
    );

    await removeAdminOrganizationMember('partner-1', 'm1');
    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/admin/organizations/partner-1/members/m1',
        method: 'DELETE',
      })
    );

    await patchAdminOrganizationMember('partner-1', 'm1', { is_primary_contact: true });
    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/admin/organizations/partner-1/members/m1',
        method: 'PATCH',
      })
    );
  });
});
