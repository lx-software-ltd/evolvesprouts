import {
  asBoolean,
  asNullableFiniteNumber,
  asNullableString,
  asNumber,
  asStringArray,
} from './api-payload';
import { isRecord } from './type-guards';

import {
  normalizeConsultationPricingModelFromApi,
  normalizeDiscountTypeFromApi,
  normalizeEventbriteSyncStatusFromApi,
  normalizeEventCategoryFromApi,
  type DiscountCode,
  type Enrollment,
  type EventTicketTier,
  type PartnerOrgRef,
  type GeographicAreaSummary,
  type LocationSummary,
  type ServiceDetail,
  type ConsultationInstanceDetailsRow,
  type ServiceInstance,
  type ServiceSummary,
  type SessionSlot,
  type TrainingInstanceDetailsRow,
} from '@/types/services';

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

export {
  parseDiscountCode,
  parseEnrollment,
  parseGeographicAreaSummary,
  parseLocationSummary,
  parseServiceDetail,
  parseServiceSummary,
};
