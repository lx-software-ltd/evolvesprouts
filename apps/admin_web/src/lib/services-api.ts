import { clampAdminListLimit } from '@/lib/admin-list-limit';

import { adminApiRequest, isAbortRequestError } from './api-admin-client';

export { isAbortRequestError };
import {
  asBoolean,
  asNullableFiniteNumber,
  asNullableString,
  asNumber,
  asStringArray,
  unwrapPayload,
} from './api-payload';
import { isRecord } from './type-guards';

import type { components } from '@/types/generated/admin-api.generated';
import {
  normalizeConsultationPricingModelFromApi,
  normalizeDiscountTypeFromApi,
  normalizeEventbriteSyncStatusFromApi,
  normalizeEventCategoryFromApi,
  type DiscountCode,
  type DiscountCodeFilters,
  type Enrollment,
  type EnrollmentListFilters,
  type EventTicketTier,
  type PartnerOrgRef,
  type GeographicAreaSummary,
  type LocationSummary,
  type ServiceDetail,
  type ConsultationInstanceDetailsRow,
  type ServiceInstance,
  type ServiceListFilters,
  type ServiceSummary,
  type SessionSlot,
  type TrainingInstanceDetailsRow,
  type VenueFilters,
} from '@/types/services';

type ApiSchemas = components['schemas'];
type ApiServiceListResponse = ApiSchemas['ServiceListResponse'];
type ApiServiceResponse = ApiSchemas['ServiceResponse'];
type ApiServiceCoverImageUploadResponse = ApiSchemas['ServiceCoverImageUploadResponse'];
type ApiCreateServiceRequest = ApiSchemas['CreateServiceRequest'];
type ApiUpdateServiceRequest = ApiSchemas['UpdateServiceRequest'];
type ApiPartialUpdateServiceRequest = ApiSchemas['PartialUpdateServiceRequest'];
type ApiCreateInstanceRequest = ApiSchemas['CreateInstanceRequest'];
type ApiUpdateInstanceRequest = ApiSchemas['UpdateInstanceRequest'];
type ApiInstanceListResponse = ApiSchemas['InstanceListResponse'];
type ApiInstanceResponse = ApiSchemas['InstanceResponse'];
type ApiEnrollmentListResponse = ApiSchemas['EnrollmentListResponse'];
type ApiEnrollmentResponse = ApiSchemas['EnrollmentResponse'];
type ApiCreateEnrollmentRequest = ApiSchemas['CreateEnrollmentRequest'];
type ApiUpdateEnrollmentRequest = ApiSchemas['UpdateEnrollmentRequest'];
type ApiDiscountCodeListResponse = ApiSchemas['DiscountCodeListResponse'];
type ApiDiscountCodeResponse = ApiSchemas['DiscountCodeResponse'];
type ApiCreateDiscountCodeRequest = ApiSchemas['CreateDiscountCodeRequest'];
type ApiUpdateDiscountCodeRequest = ApiSchemas['UpdateDiscountCodeRequest'];
type ApiCreateCoverImageUploadRequest = ApiSchemas['CreateServiceCoverImageUploadRequest'];
type ApiLocationListResponse = ApiSchemas['LocationListResponse'];
type ApiLocationResponse = ApiSchemas['LocationResponse'];
type ApiGeographicAreaListResponse = ApiSchemas['GeographicAreaListResponse'];
type ApiCreateLocationRequest = ApiSchemas['CreateLocationRequest'];
type ApiUpdateLocationRequest = ApiSchemas['UpdateLocationRequest'];
type ApiPartialUpdateLocationRequest = ApiSchemas['PartialUpdateLocationRequest'];
type ApiGeocodeLocationRequest = ApiSchemas['GeocodeLocationRequest'];
type ApiGeocodeLocationResponse = ApiSchemas['GeocodeLocationResponse'];
type ApiDiscountCodeUsageSummaryResponse = ApiSchemas['DiscountCodeUsageSummaryResponse'];

function parseSessionSlot(value: unknown): SessionSlot {
  const item = isRecord(value) ? value : {};
  return {
    id: asNullableString(item.id),
    instanceId: asNullableString(item.instance_id),
    locationId: asNullableString(item.location_id),
    startsAt: asNullableString(item.starts_at),
    endsAt: asNullableString(item.ends_at),
    sortOrder: typeof item.sort_order === 'number' ? item.sort_order : null,
  };
}

function parseTicketTier(value: unknown): EventTicketTier {
  const item = isRecord(value) ? value : {};
  return {
    id: asNullableString(item.id),
    instanceId: asNullableString(item.instance_id),
    name: asNullableString(item.name) ?? '',
    description: asNullableString(item.description),
    price: asNullableString(item.price) ?? '0',
    currency: asNullableString(item.currency) ?? 'HKD',
    maxQuantity: typeof item.max_quantity === 'number' ? item.max_quantity : null,
    sortOrder: typeof item.sort_order === 'number' ? item.sort_order : null,
  };
}

function parseTrainingInstanceDetailsRow(
  value: unknown
): TrainingInstanceDetailsRow | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    trainingFormat: (asNullableString(value.training_format) ??
      'group') as TrainingInstanceDetailsRow['trainingFormat'],
    price: asNullableString(value.price) ?? '0',
    currency: asNullableString(value.currency) ?? 'HKD',
    pricingUnit: (asNullableString(value.pricing_unit) ??
      'per_person') as TrainingInstanceDetailsRow['pricingUnit'],
  };
}

function parseConsultationInstanceDetailsRow(
  value: unknown
): ConsultationInstanceDetailsRow | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    pricingModel: (asNullableString(value.pricing_model) ??
      'free') as ConsultationInstanceDetailsRow['pricingModel'],
    price: asNullableString(value.price),
    currency: asNullableString(value.currency) ?? 'HKD',
    packageSessions:
      typeof value.package_sessions === 'number' ? value.package_sessions : null,
  };
}

function parsePartnerOrganization(value: unknown): PartnerOrgRef | null {
  const item = isRecord(value) ? value : {};
  const id = asNullableString(item.id);
  if (!id) {
    return null;
  }
  return {
    id,
    name: asNullableString(item.name) ?? '',
    active: !asBoolean(item.archived, false),
    locationId: asNullableString(item.location_id),
  };
}

function parseLocationSummary(value: unknown): LocationSummary {
  const item = isRecord(value) ? value : {};
  return {
    id: asNullableString(item.id) ?? '',
    name: asNullableString(item.name),
    areaId: asNullableString(item.area_id) ?? '',
    address: asNullableString(item.address),
    lat: asNullableFiniteNumber(item.lat),
    lng: asNullableFiniteNumber(item.lng),
    createdAt: asNullableString(item.created_at),
    updatedAt: asNullableString(item.updated_at),
    lockedFromPartnerOrg: asBoolean(item.locked_from_partner_org, false),
    partnerOrganizationLabels: asStringArray(item.partner_organization_labels),
    partnerOrganizationIds: asStringArray(item.partner_organization_ids),
  };
}

function parseGeographicAreaSummary(value: unknown): GeographicAreaSummary {
  const item = isRecord(value) ? value : {};
  return {
    id: asNullableString(item.id) ?? '',
    parentId: asNullableString(item.parent_id),
    name: asNullableString(item.name) ?? '',
    level: (asNullableString(item.level) ?? 'district') as GeographicAreaSummary['level'],
    code: asNullableString(item.code),
    sovereignCountryId: asNullableString(item.sovereign_country_id),
    active: asBoolean(item.active, true),
    displayOrder: asNumber(item.display_order, 0),
  };
}

function parseServiceSummary(value: unknown): ServiceSummary {
  const item = isRecord(value) ? value : {};
  const trainingRaw = isRecord(item.training_details) ? item.training_details : null;
  const eventRaw = isRecord(item.event_details) ? item.event_details : null;
  const consultationRaw = isRecord(item.consultation_details) ? item.consultation_details : null;
  return {
    id: asNullableString(item.id) ?? '',
    instancesCount: asNumber(item.instances_count, 0),
    serviceType: (asNullableString(item.service_type) ?? 'training_course') as ServiceSummary['serviceType'],
    title: asNullableString(item.title) ?? '',
    serviceKey: asNullableString(item.service_key),
    bookingSystem: asNullableString(item.booking_system),
    description: asNullableString(item.description),
    coverImageS3Key: asNullableString(item.cover_image_s3_key),
    deliveryMode: (asNullableString(item.delivery_mode) ?? 'online') as ServiceSummary['deliveryMode'],
    status: (asNullableString(item.status) ?? 'draft') as ServiceSummary['status'],
    serviceTier: asNullableString(item.service_tier),
    locationId: asNullableString(item.location_id),
    createdBy: asNullableString(item.created_by) ?? '',
    createdAt: asNullableString(item.created_at),
    updatedAt: asNullableString(item.updated_at),
    trainingDetails: trainingRaw
      ? {
          pricingUnit: (asNullableString(trainingRaw.pricing_unit) ??
            'per_person') as NonNullable<ServiceSummary['trainingDetails']>['pricingUnit'],
          defaultPrice: asNullableString(trainingRaw.default_price),
          defaultCurrency: asNullableString(trainingRaw.default_currency),
        }
      : null,
    eventDetails: eventRaw
      ? {
          eventCategory: normalizeEventCategoryFromApi(eventRaw.event_category),
          defaultPrice: asNullableString(eventRaw.default_price),
          defaultCurrency: asNullableString(eventRaw.default_currency) ?? 'HKD',
        }
      : null,
    consultationDetails: consultationRaw
      ? {
          consultationFormat: (asNullableString(consultationRaw.consultation_format) ??
            'one_on_one') as NonNullable<ServiceSummary['consultationDetails']>['consultationFormat'],
          maxGroupSize:
            typeof consultationRaw.max_group_size === 'number' ? consultationRaw.max_group_size : null,
          durationMinutes:
            typeof consultationRaw.duration_minutes === 'number' ? consultationRaw.duration_minutes : null,
          pricingModel: normalizeConsultationPricingModelFromApi(consultationRaw.pricing_model),
          defaultHourlyRate: asNullableString(consultationRaw.default_hourly_rate),
          defaultPackagePrice: asNullableString(consultationRaw.default_package_price),
          defaultPackageSessions:
            typeof consultationRaw.default_package_sessions === 'number'
              ? consultationRaw.default_package_sessions
              : null,
          defaultCurrency: asNullableString(consultationRaw.default_currency),
        }
      : null,
  };
}

function parseServiceDetail(value: unknown): ServiceDetail {
  const item = isRecord(value) ? value : {};
  const summary = parseServiceSummary(item);
  const trainingDetails = isRecord(item.training_details)
    ? {
        pricingUnit: (asNullableString(item.training_details.pricing_unit) ??
          'per_person') as NonNullable<ServiceDetail['trainingDetails']>['pricingUnit'],
        defaultPrice: asNullableString(item.training_details.default_price),
        defaultCurrency: asNullableString(item.training_details.default_currency),
      }
    : null;
  const eventDetails = isRecord(item.event_details)
    ? {
        eventCategory: normalizeEventCategoryFromApi(item.event_details.event_category),
        defaultPrice: asNullableString(item.event_details.default_price),
        defaultCurrency: asNullableString(item.event_details.default_currency) ?? 'HKD',
      }
    : null;
  const consultationDetails = isRecord(item.consultation_details)
    ? {
        consultationFormat: (asNullableString(item.consultation_details.consultation_format) ??
          'one_on_one') as NonNullable<ServiceDetail['consultationDetails']>['consultationFormat'],
        maxGroupSize:
          typeof item.consultation_details.max_group_size === 'number'
            ? item.consultation_details.max_group_size
            : null,
        durationMinutes:
          typeof item.consultation_details.duration_minutes === 'number'
            ? item.consultation_details.duration_minutes
            : null,
        pricingModel: normalizeConsultationPricingModelFromApi(item.consultation_details.pricing_model),
        defaultHourlyRate: asNullableString(item.consultation_details.default_hourly_rate),
        defaultPackagePrice: asNullableString(item.consultation_details.default_package_price),
        defaultPackageSessions:
          typeof item.consultation_details.default_package_sessions === 'number'
            ? item.consultation_details.default_package_sessions
            : null,
        defaultCurrency: asNullableString(item.consultation_details.default_currency),
      }
    : null;
  return {
    ...summary,
    tagIds: Array.isArray(item.tag_ids)
      ? item.tag_ids.filter((entry): entry is string => typeof entry === 'string')
      : [],
    assetIds: Array.isArray(item.asset_ids)
      ? item.asset_ids.filter((entry): entry is string => typeof entry === 'string')
      : [],
    trainingDetails,
    eventDetails,
    consultationDetails,
  };
}

function requireNonEmptyApiString(
  value: unknown,
  fieldName: string,
  context: string,
): string {
  const parsed = asNullableString(value);
  if (!parsed || !parsed.trim()) {
    throw new Error(`Admin services API response missing ${fieldName} for ${context}.`);
  }
  return parsed;
}

export function parseInstance(value: unknown): ServiceInstance {
  const item = isRecord(value) ? value : {};
  const parentTypeRaw = asNullableString(item.parent_service_type);
  const slug = requireNonEmptyApiString(item.slug, 'slug', 'service instance');
  const resolvedSlug = requireNonEmptyApiString(
    item.resolved_slug,
    'resolved_slug',
    'service instance',
  );
  return {
    id: asNullableString(item.id) ?? '',
    serviceId: asNullableString(item.service_id) ?? '',
    parentServiceTitle: asNullableString(item.parent_service_title),
    parentServiceTier: asNullableString(item.parent_service_tier),
    parentServiceType: parentTypeRaw
      ? (parentTypeRaw as ServiceInstance['parentServiceType'])
      : null,
    parentServiceKey: asNullableString(item.parent_service_key),
    title: asNullableString(item.title),
    slug,
    description: asNullableString(item.description),
    coverImageS3Key: asNullableString(item.cover_image_s3_key),
    status: (asNullableString(item.status) ?? 'scheduled') as ServiceInstance['status'],
    deliveryMode: (asNullableString(item.delivery_mode) ?? null) as ServiceInstance['deliveryMode'],
    locationId: asNullableString(item.location_id),
    maxCapacity: typeof item.max_capacity === 'number' ? item.max_capacity : null,
    capacityLeftOverride:
      typeof item.capacity_left_override === 'number' ? item.capacity_left_override : null,
    capacityLeftEffective:
      typeof item.capacity_left_effective === 'number' ? item.capacity_left_effective : null,
    capacityEnrolledCount:
      typeof item.capacity_enrolled_count === 'number' ? item.capacity_enrolled_count : 0,
    waitlistEnabled: asBoolean(item.waitlist_enabled, false),
    eventbriteSyncStatus: normalizeEventbriteSyncStatusFromApi(item.eventbrite_sync_status),
    externalUrl: asNullableString(item.external_url),
    partnerOrganizations: Array.isArray(item.partner_organizations)
      ? item.partner_organizations
          .map((entry) => parsePartnerOrganization(entry))
          .filter((row): row is PartnerOrgRef => row !== null)
      : [],
    instructorId: asNullableString(item.instructor_id),
    cohort: asNullableString(item.cohort),
    notes: asNullableString(item.notes),
    tagIds: Array.isArray(item.tag_ids)
      ? item.tag_ids.filter((entry): entry is string => typeof entry === 'string')
      : [],
    createdBy: asNullableString(item.created_by) ?? '',
    createdAt: asNullableString(item.created_at),
    updatedAt: asNullableString(item.updated_at),
    resolvedTitle: asNullableString(item.resolved_title),
    resolvedSlug,
    resolvedDescription: asNullableString(item.resolved_description),
    resolvedCoverImageS3Key: asNullableString(item.resolved_cover_image_s3_key),
    resolvedDeliveryMode: asNullableString(item.resolved_delivery_mode),
    resolvedLocationId: asNullableString(item.resolved_location_id),
    sessionSlots: Array.isArray(item.session_slots)
      ? item.session_slots.map((entry) => parseSessionSlot(entry))
      : [],
    trainingDetails: parseTrainingInstanceDetailsRow(item.training_details),
    resolvedTrainingDetails:
      parseTrainingInstanceDetailsRow(item.resolved_training_details) ??
      parseTrainingInstanceDetailsRow(item.training_details),
    eventTicketTiers: Array.isArray(item.event_ticket_tiers)
      ? item.event_ticket_tiers.map((entry) => parseTicketTier(entry))
      : [],
    resolvedEventTicketTiers:
      Array.isArray(item.resolved_event_ticket_tiers) &&
      item.resolved_event_ticket_tiers.length > 0
        ? item.resolved_event_ticket_tiers.map((entry) => parseTicketTier(entry))
        : Array.isArray(item.event_ticket_tiers)
          ? item.event_ticket_tiers.map((entry) => parseTicketTier(entry))
          : [],
    consultationDetails: parseConsultationInstanceDetailsRow(item.consultation_details),
    resolvedConsultationDetails:
      parseConsultationInstanceDetailsRow(item.resolved_consultation_details) ??
      parseConsultationInstanceDetailsRow(item.consultation_details),
  };
}

function parseEnrollment(value: unknown): Enrollment {
  const item = isRecord(value) ? value : {};
  return {
    id: asNullableString(item.id) ?? '',
    instanceId: asNullableString(item.instance_id) ?? '',
    contactId: asNullableString(item.contact_id),
    familyId: asNullableString(item.family_id),
    organizationId: asNullableString(item.organization_id),
    ticketTierId: asNullableString(item.ticket_tier_id),
    discountCodeId: asNullableString(item.discount_code_id),
    status: (asNullableString(item.status) ?? 'registered') as Enrollment['status'],
    amountPaid: asNullableString(item.amount_paid),
    currency: asNullableString(item.currency),
    enrolledAt: asNullableString(item.enrolled_at),
    cancelledAt: asNullableString(item.cancelled_at),
    notes: asNullableString(item.notes),
    createdBy: asNullableString(item.created_by) ?? '',
    createdAt: asNullableString(item.created_at),
    updatedAt: asNullableString(item.updated_at),
    partyDisplayName: asNullableString(item.party_display_name),
    scheduledStartAt: asNullableString(item.scheduled_start_at),
  };
}

function parseDiscountCode(value: unknown): DiscountCode {
  const item = isRecord(value) ? value : {};
  return {
    id: asNullableString(item.id) ?? '',
    code: asNullableString(item.code) ?? '',
    description: asNullableString(item.description),
    discountType: normalizeDiscountTypeFromApi(item.discount_type),
    discountValue: asNullableString(item.discount_value) ?? '0',
    currency: asNullableString(item.currency),
    validFrom: asNullableString(item.valid_from),
    validUntil: asNullableString(item.valid_until),
    serviceId: asNullableString(item.service_id),
    instanceId: asNullableString(item.instance_id),
    maxUses: typeof item.max_uses === 'number' ? item.max_uses : null,
    currentUses: asNumber(item.current_uses, 0),
    active: asBoolean(item.active, false),
    createdBy: asNullableString(item.created_by) ?? '',
    createdAt: asNullableString(item.created_at),
    updatedAt: asNullableString(item.updated_at),
  };
}

function buildServiceListQuery(params: Partial<ServiceListFilters> & { cursor?: string | null; limit?: number }) {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.serviceType) query.set('service_type', params.serviceType);
  if (params.status) query.set('status', params.status);
  if (params.search?.trim()) query.set('search', params.search.trim());
  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

export async function listGeographicAreas(
  params: { flat?: boolean; activeOnly?: boolean } = {},
  signal?: AbortSignal
): Promise<GeographicAreaSummary[]> {
  const query = new URLSearchParams();
  if (params.flat) query.set('flat', 'true');
  if (params.activeOnly === false) query.set('active_only', 'false');
  const queryString = query.toString();
  const payload = await adminApiRequest<ApiGeographicAreaListResponse>({
    endpointPath: `/v1/admin/geographic-areas${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return Array.isArray(root.items) ? root.items.map((entry) => parseGeographicAreaSummary(entry)) : [];
}

export async function listLocations(
  params: Partial<VenueFilters> & {
    cursor?: string | null;
    limit?: number;
    /** When true, omit locations used as a non-archived family or organisation venue. */
    excludeAddresses?: boolean;
  },
  signal?: AbortSignal
): Promise<{ items: LocationSummary[]; nextCursor: string | null; totalCount: number }> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.areaId) query.set('area_id', params.areaId);
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.excludeAddresses) query.set('exclude_addresses', 'true');
  const queryString = query.toString();

  const payload = await adminApiRequest<ApiLocationListResponse>({
    endpointPath: `/v1/admin/locations${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return {
    items: Array.isArray(root.items) ? root.items.map((entry) => parseLocationSummary(entry)) : [],
    nextCursor: asNullableString(root.next_cursor),
    totalCount: asNumber(root.total_count, 0),
  };
}

export async function listAllLocations(signal?: AbortSignal): Promise<LocationSummary[]> {
  const all: LocationSummary[] = [];
  let cursor: string | null = null;
  do {
    const page = await listLocations(
      {
        cursor,
        limit: clampAdminListLimit(100),
      },
      signal
    );
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

/**
 * Locations suitable for service instances: standalone venues (not used as a
 * family or non-partner org address) plus any location linked to an active
 * partner organisation (those may be excluded from the venue-only query).
 */
export async function listAllVenueAndPartnerLocations(signal?: AbortSignal): Promise<LocationSummary[]> {
  const byId = new Map<string, LocationSummary>();

  let venueCursor: string | null = null;
  do {
    const page = await listLocations(
      {
        cursor: venueCursor,
        limit: clampAdminListLimit(100),
        excludeAddresses: true,
      },
      signal
    );
    for (const loc of page.items) {
      byId.set(loc.id, loc);
    }
    venueCursor = page.nextCursor;
  } while (venueCursor);

  let allCursor: string | null = null;
  do {
    const page = await listLocations(
      {
        cursor: allCursor,
        limit: clampAdminListLimit(100),
      },
      signal
    );
    for (const loc of page.items) {
      if (loc.partnerOrganizationLabels.length > 0) {
        byId.set(loc.id, loc);
      }
    }
    allCursor = page.nextCursor;
  } while (allCursor);

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface GeocodeLocationResult {
  lat: number;
  lng: number;
  displayName: string | null;
}

export async function geocodeVenueAddress(
  body: ApiGeocodeLocationRequest,
  signal?: AbortSignal
): Promise<GeocodeLocationResult> {
  const payload = await adminApiRequest<ApiGeocodeLocationResponse>({
    endpointPath: '/v1/admin/locations/geocode',
    method: 'POST',
    body,
    signal,
  });
  const root = unwrapPayload(payload);
  const lat = typeof root.lat === 'number' ? root.lat : NaN;
  const lng = typeof root.lng === 'number' ? root.lng : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Geocoding response was invalid.');
  }
  return {
    lat,
    lng,
    displayName: asNullableString(root.display_name),
  };
}

export async function createLocation(body: ApiCreateLocationRequest): Promise<LocationSummary | null> {
  const payload = await adminApiRequest<ApiLocationResponse>({
    endpointPath: '/v1/admin/locations',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  const root = unwrapPayload(payload);
  return root.location ? parseLocationSummary(root.location) : null;
}

export async function updateLocation(
  id: string,
  body: ApiUpdateLocationRequest
): Promise<LocationSummary | null> {
  const payload = await adminApiRequest<ApiLocationResponse>({
    endpointPath: `/v1/admin/locations/${id}`,
    method: 'PUT',
    body,
  });
  const root = unwrapPayload(payload);
  return root.location ? parseLocationSummary(root.location) : null;
}

export async function updateLocationPartial(
  id: string,
  body: ApiPartialUpdateLocationRequest
): Promise<LocationSummary | null> {
  const payload = await adminApiRequest<ApiLocationResponse>({
    endpointPath: `/v1/admin/locations/${id}`,
    method: 'PATCH',
    body,
  });
  const root = unwrapPayload(payload);
  return root.location ? parseLocationSummary(root.location) : null;
}

export async function deleteLocation(id: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/locations/${id}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 204],
  });
}

export async function listServices(
  params: Partial<ServiceListFilters> & { cursor?: string | null; limit?: number },
  signal?: AbortSignal
): Promise<{ items: ServiceSummary[]; nextCursor: string | null; totalCount: number }> {
  const payload = await adminApiRequest<ApiServiceListResponse>({
    endpointPath: `/v1/admin/services${buildServiceListQuery(params)}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return {
    items: Array.isArray(root.items) ? root.items.map((entry) => parseServiceSummary(entry)) : [],
    nextCursor: asNullableString(root.next_cursor),
    totalCount: asNumber(root.total_count, 0),
  };
}

export interface ServiceDiscountCodeUsageSummary {
  totalCurrentUses: number;
  referencingCodeCount: number;
}

function parseDiscountCodeUsageSummary(value: unknown): ServiceDiscountCodeUsageSummary | null {
  const item = isRecord(value) ? value : {};
  return {
    totalCurrentUses: asNumber(item.total_current_uses, 0),
    referencingCodeCount: asNumber(item.referencing_code_count, 0),
  };
}

export interface DiscountCodeUsageSummaryResult {
  summary: ServiceDiscountCodeUsageSummary | null;
  error: Error | null;
}

export async function getServiceDiscountCodeUsageSummary(
  serviceId: string,
  signal?: AbortSignal,
): Promise<DiscountCodeUsageSummaryResult> {
  try {
    const payload = await adminApiRequest<ApiDiscountCodeUsageSummaryResponse>({
      endpointPath: `/v1/admin/services/${serviceId}/discount-code-usage-summary`,
      method: 'GET',
      signal,
    });
    const root = unwrapPayload(payload);
    return { summary: parseDiscountCodeUsageSummary(root), error: null };
  } catch (caught) {
    if (isAbortRequestError(caught)) {
      throw caught;
    }
    const error = caught instanceof Error ? caught : new Error(String(caught));
    return { summary: null, error };
  }
}

export async function getService(id: string, signal?: AbortSignal): Promise<ServiceDetail | null> {
  const payload = await adminApiRequest<ApiServiceResponse>({
    endpointPath: `/v1/admin/services/${id}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return root.service ? parseServiceDetail(root.service) : null;
}

export async function createService(body: ApiCreateServiceRequest): Promise<ServiceDetail | null> {
  const payload = await adminApiRequest<ApiServiceResponse>({
    endpointPath: '/v1/admin/services',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  const root = unwrapPayload(payload);
  return root.service ? parseServiceDetail(root.service) : null;
}

export async function updateService(
  id: string,
  body: ApiUpdateServiceRequest | ApiPartialUpdateServiceRequest,
  partial = false
): Promise<ServiceDetail | null> {
  const payload = await adminApiRequest<ApiServiceResponse>({
    endpointPath: `/v1/admin/services/${id}`,
    method: partial ? 'PATCH' : 'PUT',
    body,
  });
  const root = unwrapPayload(payload);
  return root.service ? parseServiceDetail(root.service) : null;
}

export async function deleteService(id: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/services/${id}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 204],
  });
}

export async function createServiceCoverImageUpload(
  serviceId: string,
  body: ApiCreateCoverImageUploadRequest
): Promise<{
  uploadUrl: string | null;
  uploadMethod: string;
  uploadHeaders: Record<string, string>;
  s3Key: string | null;
  expiresAt: string | null;
  service: { id: string | null; coverImageS3Key: string | null };
}> {
  const payload = await adminApiRequest<ApiServiceCoverImageUploadResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/cover-image`,
    method: 'POST',
    body,
  });
  const root = unwrapPayload(payload);
  const service = isRecord(root.service) ? root.service : {};
  return {
    uploadUrl: asNullableString(root.upload_url),
    uploadMethod: asNullableString(root.upload_method) ?? 'PUT',
    uploadHeaders: isRecord(root.upload_headers)
      ? Object.fromEntries(
          Object.entries(root.upload_headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        )
      : {},
    s3Key: asNullableString(root.s3_key),
    expiresAt: asNullableString(root.expires_at),
    service: {
      id: asNullableString(service.id),
      coverImageS3Key: asNullableString(service.cover_image_s3_key),
    },
  };
}

function buildInstanceListQuery(params: { status?: string; cursor?: string | null; limit?: number }) {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.status) query.set('status', params.status);
  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function buildGlobalInstanceListQuery(params: {
  status?: string;
  cursor?: string | null;
  limit?: number;
  serviceId?: string | null;
  serviceType?: string | null;
  contactId?: string | null;
  familyId?: string | null;
  organizationId?: string | null;
}) {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.status) query.set('status', params.status);
  if (params.serviceId?.trim()) query.set('service_id', params.serviceId.trim());
  if (params.serviceType?.trim()) query.set('service_type', params.serviceType.trim());
  if (params.contactId?.trim()) query.set('contact_id', params.contactId.trim());
  if (params.familyId?.trim()) query.set('family_id', params.familyId.trim());
  if (params.organizationId?.trim()) query.set('organization_id', params.organizationId.trim());
  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

export async function listInstances(
  serviceId: string,
  params: { status?: string; cursor?: string | null; limit?: number },
  signal?: AbortSignal
): Promise<{ items: ServiceInstance[]; nextCursor: string | null; totalCount: number }> {
  const payload = await adminApiRequest<ApiInstanceListResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances${buildInstanceListQuery(params)}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return {
    items: Array.isArray(root.items) ? root.items.map((entry) => parseInstance(entry)) : [],
    nextCursor: asNullableString(root.next_cursor),
    totalCount: asNumber(root.total_count, 0),
  };
}

export async function listAllInstances(
  params: {
    status?: string;
    cursor?: string | null;
    limit?: number;
    serviceId?: string | null;
    serviceType?: string | null;
    contactId?: string | null;
    familyId?: string | null;
    organizationId?: string | null;
  },
  signal?: AbortSignal
): Promise<{ items: ServiceInstance[]; nextCursor: string | null; totalCount: number }> {
  const payload = await adminApiRequest<ApiInstanceListResponse>({
    endpointPath: `/v1/admin/services/instances${buildGlobalInstanceListQuery(params)}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return {
    items: Array.isArray(root.items) ? root.items.map((entry) => parseInstance(entry)) : [],
    nextCursor: asNullableString(root.next_cursor),
    totalCount: asNumber(root.total_count, 0),
  };
}

export async function getInstance(
  serviceId: string,
  instanceId: string,
  signal?: AbortSignal
): Promise<ServiceInstance | null> {
  const payload = await adminApiRequest<ApiInstanceResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return root.instance ? parseInstance(root.instance) : null;
}

export async function createInstance(
  serviceId: string,
  body: ApiCreateInstanceRequest
): Promise<ServiceInstance | null> {
  const payload = await adminApiRequest<ApiInstanceResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances`,
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  const root = unwrapPayload(payload);
  return root.instance ? parseInstance(root.instance) : null;
}

export async function updateInstance(
  serviceId: string,
  instanceId: string,
  body: ApiUpdateInstanceRequest
): Promise<ServiceInstance | null> {
  const payload = await adminApiRequest<ApiInstanceResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}`,
    method: 'PUT',
    body,
  });
  const root = unwrapPayload(payload);
  return root.instance ? parseInstance(root.instance) : null;
}

export async function deleteInstance(serviceId: string, instanceId: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 204],
  });
}

export async function listEnrollments(
  serviceId: string,
  instanceId: string,
  params: Partial<EnrollmentListFilters> & { cursor?: string | null; limit?: number },
  signal?: AbortSignal
): Promise<{ items: Enrollment[]; nextCursor: string | null; totalCount: number }> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.status) query.set('status', params.status);
  const queryString = query.toString();
  const payload = await adminApiRequest<ApiEnrollmentListResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}/enrollments${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return {
    items: Array.isArray(root.items) ? root.items.map((entry) => parseEnrollment(entry)) : [],
    nextCursor: asNullableString(root.next_cursor),
    totalCount: asNumber(root.total_count, 0),
  };
}

export async function createEnrollment(
  serviceId: string,
  instanceId: string,
  body: ApiCreateEnrollmentRequest
): Promise<Enrollment | null> {
  const payload = await adminApiRequest<ApiEnrollmentResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}/enrollments`,
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  const root = unwrapPayload(payload);
  return root.enrollment ? parseEnrollment(root.enrollment) : null;
}

export async function updateEnrollment(
  serviceId: string,
  instanceId: string,
  enrollmentId: string,
  body: ApiUpdateEnrollmentRequest
): Promise<Enrollment | null> {
  const payload = await adminApiRequest<ApiEnrollmentResponse>({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}/enrollments/${enrollmentId}`,
    method: 'PATCH',
    body,
  });
  const root = unwrapPayload(payload);
  return root.enrollment ? parseEnrollment(root.enrollment) : null;
}

export async function deleteEnrollment(
  serviceId: string,
  instanceId: string,
  enrollmentId: string
): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/services/${serviceId}/instances/${instanceId}/enrollments/${enrollmentId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 204],
  });
}

const ENROLLMENT_DISCOUNT_OPTIONS_PAGE_LIMIT = 200;

/**
 * Discount codes applicable when creating/editing an enrollment for one instance:
 * global (unscoped), service-scoped for `serviceId`, and instance-scoped for `instanceId`.
 */
export async function listEnrollmentDiscountOptions(
  serviceId: string,
  instanceId: string,
  signal?: AbortSignal
): Promise<DiscountCode[]> {
  const base = { active: 'true' as const, limit: ENROLLMENT_DISCOUNT_OPTIONS_PAGE_LIMIT };
  const [unscoped, forService, forInstance] = await Promise.all([
    listDiscountCodes({ ...base, scope: 'unscoped' }, signal),
    listDiscountCodes({ ...base, scope: 'service', service_id: serviceId }, signal),
    listDiscountCodes({ ...base, scope: 'instance', instance_id: instanceId }, signal),
  ]);
  const byId = new Map<string, DiscountCode>();
  for (const row of [...unscoped.items, ...forService.items, ...forInstance.items]) {
    if (row.id) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { sensitivity: 'base' })
  );
}

export async function listDiscountCodes(
  params: Partial<DiscountCodeFilters> & {
    cursor?: string | null;
    limit?: number;
    service_id?: string;
    instance_id?: string;
  },
  signal?: AbortSignal
): Promise<{ items: DiscountCode[]; nextCursor: string | null; totalCount: number }> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (typeof params.limit === 'number') query.set('limit', `${clampAdminListLimit(params.limit)}`);
  if (params.active) query.set('active', params.active);
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.scope) query.set('scope', params.scope);
  if (params.service_id?.trim()) query.set('service_id', params.service_id.trim());
  if (params.instance_id?.trim()) query.set('instance_id', params.instance_id.trim());
  const queryString = query.toString();
  const payload = await adminApiRequest<ApiDiscountCodeListResponse>({
    endpointPath: `/v1/admin/discount-codes${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return {
    items: Array.isArray(root.items) ? root.items.map((entry) => parseDiscountCode(entry)) : [],
    nextCursor: asNullableString(root.next_cursor),
    totalCount: asNumber(root.total_count, 0),
  };
}

export async function createDiscountCode(
  body: ApiCreateDiscountCodeRequest
): Promise<DiscountCode | null> {
  const payload = await adminApiRequest<ApiDiscountCodeResponse>({
    endpointPath: '/v1/admin/discount-codes',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  const root = unwrapPayload(payload);
  return root.discount_code ? parseDiscountCode(root.discount_code) : null;
}

export async function updateDiscountCode(
  codeId: string,
  body: ApiUpdateDiscountCodeRequest
): Promise<DiscountCode | null> {
  const payload = await adminApiRequest<ApiDiscountCodeResponse>({
    endpointPath: `/v1/admin/discount-codes/${codeId}`,
    method: 'PUT',
    body,
  });
  const root = unwrapPayload(payload);
  return root.discount_code ? parseDiscountCode(root.discount_code) : null;
}

export async function deleteDiscountCode(codeId: string): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/discount-codes/${codeId}`,
    method: 'DELETE',
    expectedSuccessStatuses: [200, 204],
  });
}
