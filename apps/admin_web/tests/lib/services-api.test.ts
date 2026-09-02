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
  createServiceCoverImageUpload,
  listDiscountCodes,
  listAllVenueAndPartnerLocations,
  listLocations,
  listServices,
  parseInstance,
} from '@/lib/services-api';

describe('services-api', () => {
  beforeEach(() => {
    mockAdminApiRequest.mockReset();
  });

  it('lists services and maps snake_case payload', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'service-1',
          service_type: 'training_course',
          title: 'Sleep workshop',
          description: null,
          cover_image_s3_key: null,
          delivery_mode: 'online',
          status: 'draft',
          created_by: 'admin-1',
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
          training_details: {
            pricing_unit: 'per_family',
            default_price: '120.50',
            default_currency: 'HKD',
          },
        },
      ],
      next_cursor: 'cursor-1',
      total_count: 1,
    });

    const result = await listServices({
      serviceType: 'training_course',
      status: 'draft',
      search: 'sleep',
      cursor: 'abc',
      limit: 10,
    });

    expect(result.totalCount).toBe(1);
    expect(result.nextCursor).toBe('cursor-1');
    expect(result.items[0]).toMatchObject({
      id: 'service-1',
      serviceType: 'training_course',
      deliveryMode: 'online',
      status: 'draft',
      trainingDetails: {
        pricingUnit: 'per_family',
        defaultPrice: '120.50',
        defaultCurrency: 'HKD',
      },
    });

    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        endpointPath: expect.stringContaining('/v1/admin/services?'),
      })
    );
    const request = mockAdminApiRequest.mock.calls[0][0];
    expect(request.endpointPath).toContain('service_type=training_course');
    expect(request.endpointPath).toContain('status=draft');
    expect(request.endpointPath).toContain('search=sleep');
    expect(request.endpointPath).toContain('cursor=abc');
    expect(request.endpointPath).toContain('limit=10');
  });

  it('maps event_details on service list rows when present', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'service-event-1',
          service_type: 'event',
          title: 'Open day',
          description: null,
          cover_image_s3_key: null,
          delivery_mode: 'in_person',
          status: 'published',
          created_by: 'admin-1',
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
          training_details: null,
          event_details: {
            event_category: 'open_house',
            default_price: '25.00',
            default_currency: 'USD',
          },
        },
      ],
      next_cursor: null,
      total_count: 1,
    });

    const result = await listServices({
      serviceType: 'event',
      status: 'published',
      search: '',
      cursor: null,
      limit: 20,
    });

    expect(result.items[0]).toMatchObject({
      id: 'service-event-1',
      serviceType: 'event',
      eventDetails: {
        eventCategory: 'open_house',
        defaultPrice: '25.00',
        defaultCurrency: 'USD',
      },
    });
  });

  it('maps consultation_details on service list rows when present', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'service-consult-1',
          service_type: 'consultation',
          title: 'Coaching',
          description: null,
          cover_image_s3_key: null,
          delivery_mode: 'hybrid',
          status: 'published',
          created_by: 'admin-1',
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
          training_details: null,
          event_details: null,
          consultation_details: {
            consultation_format: 'one_on_one',
            max_group_size: null,
            duration_minutes: 45,
            pricing_model: 'hourly',
            default_hourly_rate: '350',
            default_package_price: null,
            default_package_sessions: null,
            default_currency: 'HKD',
          },
        },
      ],
      next_cursor: null,
      total_count: 1,
    });

    const result = await listServices({
      serviceType: 'consultation',
      status: 'published',
      search: '',
      cursor: null,
      limit: 20,
    });

    expect(result.items[0]).toMatchObject({
      id: 'service-consult-1',
      serviceType: 'consultation',
      consultationDetails: {
        consultationFormat: 'one_on_one',
        pricingModel: 'hourly',
        defaultHourlyRate: '350',
        defaultCurrency: 'HKD',
      },
    });
  });

  it('creates cover-image upload URL and maps response', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      upload_url: 'https://uploads.example.com/path',
      upload_method: 'PUT',
      upload_headers: {
        'Content-Type': 'image/jpeg',
      },
      s3_key: 'media/services/service-1/cover/file.jpg',
      expires_at: '2026-03-02T00:00:00.000Z',
      service: {
        id: 'service-1',
        cover_image_s3_key: 'media/services/service-1/cover/file.jpg',
      },
    });

    const result = await createServiceCoverImageUpload('service-1', {
      file_name: 'cover.jpg',
      content_type: 'image/jpeg',
    });

    expect(result.uploadUrl).toBe('https://uploads.example.com/path');
    expect(result.uploadMethod).toBe('PUT');
    expect(result.s3Key).toContain('media/services/service-1/cover/');
    expect(result.service.id).toBe('service-1');

    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        endpointPath: '/v1/admin/services/service-1/cover-image',
        body: {
          file_name: 'cover.jpg',
          content_type: 'image/jpeg',
        },
      })
    );
  });

  it('normalizes discount_type from listDiscountCodes (string casing and non-string)', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'dc-1',
          code: 'A',
          description: null,
          discount_type: 'REFERRAL',
          discount_value: '0',
          currency: 'HKD',
          valid_from: null,
          valid_until: null,
          service_id: null,
          instance_id: null,
          max_uses: null,
          current_uses: 0,
          active: true,
          created_by: 'u',
          created_at: null,
          updated_at: null,
        },
        {
          id: 'dc-2',
          code: 'B',
          description: null,
          discount_type: 'unknown_kind',
          discount_value: '10',
          currency: 'HKD',
          valid_from: null,
          valid_until: null,
          service_id: null,
          instance_id: null,
          max_uses: null,
          current_uses: 0,
          active: true,
          created_by: 'u',
          created_at: null,
          updated_at: null,
        },
      ],
      next_cursor: null,
      total_count: 2,
    });

    const result = await listDiscountCodes({ limit: 50 });

    expect(result.items[0].discountType).toBe('referral');
    expect(result.items[1].discountType).toBe('percentage');
  });

  it('parses venue coordinates from number or string response', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'loc-1',
          name: 'A',
          area_id: '00000000-0000-0000-0000-000000000001',
          address: '1 Rd',
          lat: 22.3193,
          lng: 114.1694,
          created_at: null,
          updated_at: null,
        },
        {
          id: 'loc-2',
          name: 'B',
          area_id: '00000000-0000-0000-0000-000000000002',
          address: '2 Rd',
          lat: '33.3',
          lng: '55.5',
          created_at: null,
          updated_at: null,
        },
      ],
      next_cursor: null,
      total_count: 2,
    });

    const result = await listLocations({ limit: 50 });

    expect(result.items[0].lat).toBe(22.3193);
    expect(result.items[0].lng).toBe(114.1694);
    expect(result.items[1].lat).toBe(33.3);
    expect(result.items[1].lng).toBe(55.5);
  });

  it('maps partner_organization_ids on location list items', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'loc-ids',
          name: null,
          area_id: '00000000-0000-0000-0000-000000000001',
          address: '1 Rd',
          lat: null,
          lng: null,
          created_at: null,
          updated_at: null,
          locked_from_partner_org: true,
          partner_organization_labels: ['Alpha'],
          partner_organization_ids: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
        },
      ],
      next_cursor: null,
      total_count: 1,
    });

    const result = await listLocations({ limit: 50 });
    expect(result.items[0].partnerOrganizationIds).toEqual(['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
    expect(result.items[0].partnerOrganizationLabels).toEqual(['Alpha']);
  });

  it('adds exclude_addresses when listLocations requests family/org address exclusion', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      items: [],
      next_cursor: null,
      total_count: 0,
    });

    await listLocations({ limit: 50, excludeAddresses: true });

    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        endpointPath: '/v1/admin/locations?exclude_addresses=true&limit=50',
      })
    );
  });

  it('listAllVenueAndPartnerLocations merges exclude_addresses pages with partner-labelled locations', async () => {
    const venueRow = {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Hall',
      area_id: '00000000-0000-0000-0000-000000000001',
      address: '2 Rd',
      lat: null,
      lng: null,
      created_at: null,
      updated_at: null,
      locked_from_partner_org: false,
      partner_organization_labels: [],
      partner_organization_ids: [],
    };
    const partnerOnlyRow = {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Partner HQ',
      area_id: '00000000-0000-0000-0000-000000000001',
      address: '3 Rd',
      lat: null,
      lng: null,
      created_at: null,
      updated_at: null,
      locked_from_partner_org: true,
      partner_organization_labels: ['Acme Partner'],
      partner_organization_ids: ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    };

    mockAdminApiRequest
      .mockResolvedValueOnce({
        items: [venueRow],
        next_cursor: null,
        total_count: 1,
      })
      .mockResolvedValueOnce({
        items: [partnerOnlyRow, venueRow],
        next_cursor: null,
        total_count: 2,
      });

    const merged = await listAllVenueAndPartnerLocations();

    expect(mockAdminApiRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        endpointPath: '/v1/admin/locations?exclude_addresses=true&limit=100',
      })
    );
    expect(mockAdminApiRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        endpointPath: '/v1/admin/locations?limit=100',
      })
    );
    expect(merged.map((l) => l.id)).toEqual([
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
    ]);
  });

  it('parseInstance maps core admin API instance shape', () => {
    const parsed = parseInstance({
      id: 'inst-booking-1',
      service_id: 'svc-1',
      parent_service_title: 'Consult',
      parent_service_tier: null,
      parent_service_type: 'consultation',
      parent_service_key: 'family-consultation-essentials',
      title: 'Booking',
      slug: 'booking-slug',
      description: null,
      cover_image_s3_key: null,
      status: 'open',
      delivery_mode: null,
      location_id: null,
      max_capacity: 1,
      waitlist_enabled: false,
      eventbrite_sync_status: 'skipped',
      external_url: null,
      partner_organizations: [],
      instructor_id: null,
      cohort: null,
      notes: null,
      tag_ids: [],
      created_by: 'admin-sub',
      created_at: '2026-03-01T10:00:00Z',
      updated_at: '2026-03-01T10:00:00Z',
      resolved_title: 'Booking',
      resolved_slug: 'booking-slug',
      resolved_description: null,
      resolved_cover_image_s3_key: null,
      resolved_delivery_mode: null,
      resolved_location_id: null,
      session_slots: [],
      training_details: null,
      resolved_training_details: null,
      event_ticket_tiers: [],
      resolved_event_ticket_tiers: [],
      consultation_details: null,
      resolved_consultation_details: null,
    });
    expect(parsed.slug).toBe('booking-slug');
    expect(parsed.serviceId).toBe('svc-1');
    expect(parsed.parentServiceKey).toBe('family-consultation-essentials');
    expect(parsed.eventbriteSyncStatus).toBe('skipped');
  });

  it('parseInstance defaults eventbrite_sync_status to pending when omitted', () => {
    const parsed = parseInstance({
      id: 'inst-eb-default',
      service_id: 'svc-1',
      parent_service_title: null,
      parent_service_tier: null,
      parent_service_type: 'event',
      parent_service_key: null,
      title: null,
      slug: 'eb-default-slug',
      description: null,
      cover_image_s3_key: null,
      status: 'scheduled',
      delivery_mode: null,
      location_id: null,
      max_capacity: null,
      waitlist_enabled: false,
      external_url: null,
      partner_organizations: [],
      instructor_id: null,
      cohort: null,
      notes: null,
      tag_ids: [],
      created_by: 'admin-sub',
      created_at: '2026-03-01T10:00:00Z',
      updated_at: '2026-03-01T10:00:00Z',
      resolved_title: null,
      resolved_slug: 'eb-default-slug',
      resolved_description: null,
      resolved_cover_image_s3_key: null,
      resolved_delivery_mode: null,
      resolved_location_id: null,
      session_slots: [],
      training_details: null,
      resolved_training_details: null,
      event_ticket_tiers: [],
      resolved_event_ticket_tiers: [],
      consultation_details: null,
      resolved_consultation_details: null,
    });
    expect(parsed.eventbriteSyncStatus).toBe('pending');
  });
});
