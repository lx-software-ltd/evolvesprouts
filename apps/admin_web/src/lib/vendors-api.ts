import {
  createAdminOrganization,
  listAdminOrganizations,
  updateAdminOrganization,
  type AdminOrganizationRow,
} from './entity-api';

import type { Vendor, VendorFilters } from '@/types/vendors';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];
type ApiCreateOrganizationRequest = ApiSchemas['CreateAdminOrganizationRequest'];
type ApiUpdateOrganizationRequest = ApiSchemas['UpdateAdminOrganizationRequest'];

/** Finance view-model for organisations with `relationship_type: vendor`. */
export function vendorFromOrganization(row: AdminOrganizationRow): Vendor {
  return {
    id: row.id,
    name: row.name,
    website: row.website ?? null,
    active: row.active,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function listAdminVendors(
  params: Partial<VendorFilters> & { cursor?: string | null; limit?: number },
  signal?: AbortSignal
): Promise<{ items: Vendor[]; nextCursor: string | null; totalCount: number }> {
  const page = await listAdminOrganizations(
    {
      query: params.query,
      active: params.active,
      relationshipType: 'vendor',
      sort: 'name',
      cursor: params.cursor,
      limit: params.limit,
    },
    signal
  );
  return { ...page, items: page.items.map(vendorFromOrganization) };
}

export async function createAdminVendor(body: ApiCreateOrganizationRequest): Promise<Vendor | null> {
  const organization = await createAdminOrganization(body);
  return organization ? vendorFromOrganization(organization) : null;
}

export async function updateAdminVendor(
  vendorId: string,
  body: ApiUpdateOrganizationRequest
): Promise<Vendor | null> {
  const organization = await updateAdminOrganization(vendorId, body);
  return organization ? vendorFromOrganization(organization) : null;
}
