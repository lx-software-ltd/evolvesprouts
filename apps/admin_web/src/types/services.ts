import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

function defineEnumValues<T extends string>() {
  return <U extends readonly T[]>(values: U & ([T] extends [U[number]] ? unknown : never)) => values;
}

export type ServiceType = ApiSchemas['ServiceType'];
export const SERVICE_TYPES = defineEnumValues<ServiceType>()(
  ['training_course', 'event', 'consultation', 'intro_call'] as const satisfies readonly ServiceType[]
);

/** Service templates that use consultation-style defaults (`consultation_details`). */
export function isConsultationLikeServiceType(serviceType: ServiceType): boolean {
  return serviceType === 'consultation' || serviceType === 'intro_call';
}

export type ServiceStatus = ApiSchemas['ServiceStatus'];
export const SERVICE_STATUSES = defineEnumValues<ServiceStatus>()(
  ['draft', 'published', 'archived'] as const satisfies readonly ServiceStatus[]
);

export type ServiceDeliveryMode = ApiSchemas['ServiceDeliveryMode'];
export const SERVICE_DELIVERY_MODES = defineEnumValues<ServiceDeliveryMode>()(
  ['online', 'in_person', 'hybrid'] as const satisfies readonly ServiceDeliveryMode[]
);

export type TrainingFormat = ApiSchemas['TrainingFormat'];
export const TRAINING_FORMATS = defineEnumValues<TrainingFormat>()(
  ['group', 'private'] as const satisfies readonly TrainingFormat[]
);

export type TrainingPricingUnit = ApiSchemas['TrainingPricingUnit'];
export const TRAINING_PRICING_UNITS = defineEnumValues<TrainingPricingUnit>()(
  ['per_person', 'per_family'] as const satisfies readonly TrainingPricingUnit[]
);

export type EventCategory = ApiSchemas['EventCategory'];
export const EVENT_CATEGORIES = defineEnumValues<EventCategory>()(
  ['workshop', 'webinar', 'open_house', 'community_meetup', 'other'] as const satisfies readonly EventCategory[]
);

const EVENT_CATEGORY_SET = new Set<string>(EVENT_CATEGORIES);

/**
 * Map API `event_category` to a value that matches `<option value>` entries.
 * Unknown values fall back to `workshop`.
 */
export function normalizeEventCategoryFromApi(raw: unknown): EventCategory {
  if (typeof raw !== 'string') {
    return 'workshop';
  }
  const normalized = raw.trim().toLowerCase();
  return EVENT_CATEGORY_SET.has(normalized) ? (normalized as EventCategory) : 'workshop';
}

export type ConsultationFormat = ApiSchemas['ConsultationFormat'];
export const CONSULTATION_FORMATS = defineEnumValues<ConsultationFormat>()(
  ['one_on_one', 'group'] as const satisfies readonly ConsultationFormat[]
);

export type ConsultationPricingModel = ApiSchemas['ConsultationPricingModel'];
export const CONSULTATION_PRICING_MODELS = defineEnumValues<ConsultationPricingModel>()(
  ['free', 'hourly', 'package'] as const satisfies readonly ConsultationPricingModel[]
);

const CONSULTATION_PRICING_MODEL_SET = new Set<string>(CONSULTATION_PRICING_MODELS);

/**
 * Map API `pricing_model` to a known enum value for controlled selects and display.
 * Unknown values fall back to `free`.
 */
export function normalizeConsultationPricingModelFromApi(raw: unknown): ConsultationPricingModel {
  if (typeof raw !== 'string') {
    return 'free';
  }
  const normalized = raw.trim().toLowerCase();
  return CONSULTATION_PRICING_MODEL_SET.has(normalized)
    ? (normalized as ConsultationPricingModel)
    : 'free';
}

export type InstanceStatus = ApiSchemas['InstanceStatus'];
export const INSTANCE_STATUSES = defineEnumValues<InstanceStatus>()(
  ['scheduled', 'open', 'full', 'in_progress', 'completed', 'cancelled'] as const satisfies readonly InstanceStatus[]
);

export type EventbriteSyncStatus = ApiSchemas['EventbriteSyncStatus'];
export const EVENTBRITE_SYNC_STATUSES = defineEnumValues<EventbriteSyncStatus>()(
  ['pending', 'syncing', 'synced', 'failed', 'skipped'] as const satisfies readonly EventbriteSyncStatus[]
);

const EVENTBRITE_SYNC_STATUS_SET = new Set<string>(EVENTBRITE_SYNC_STATUSES);

/**
 * Map API `eventbrite_sync_status` to a known enum value for display and typing.
 * Unknown values fall back to `pending`.
 */
export function normalizeEventbriteSyncStatusFromApi(raw: unknown): EventbriteSyncStatus {
  if (typeof raw !== 'string') {
    return 'pending';
  }
  const normalized = raw.trim().toLowerCase();
  return EVENTBRITE_SYNC_STATUS_SET.has(normalized)
    ? (normalized as EventbriteSyncStatus)
    : 'pending';
}

export type DiscountType = ApiSchemas['DiscountType'];
export const DISCOUNT_TYPES = defineEnumValues<DiscountType>()(
  ['percentage', 'absolute', 'referral'] as const satisfies readonly DiscountType[]
);

const DISCOUNT_TYPE_SET = new Set<string>(DISCOUNT_TYPES);

/**
 * Map API `discount_type` to a value that matches `<option value>` entries.
 * Non-string or unknown values fall back to `percentage` so native `<select>`
 * controlled values always match an option (avoids a "stuck" first option).
 */
export function normalizeDiscountTypeFromApi(raw: unknown): DiscountType {
  if (typeof raw !== 'string') {
    return 'percentage';
  }
  const normalized = raw.trim().toLowerCase();
  return DISCOUNT_TYPE_SET.has(normalized) ? (normalized as DiscountType) : 'percentage';
}

// Sibling defaults: backend `REFERRAL_DEFAULT_*` in `admin_services_payloads.py`.
export const REFERRAL_DEFAULT_DISCOUNT_VALUE = '0';
export const REFERRAL_DEFAULT_CURRENCY = 'HKD';

export type EnrollmentStatus = ApiSchemas['EnrollmentStatus'];
export const ENROLLMENT_STATUSES = defineEnumValues<EnrollmentStatus>()(
  ['registered', 'waitlisted', 'confirmed', 'cancelled', 'completed'] as const satisfies readonly EnrollmentStatus[]
);

export interface ServiceSummary {
  id: string;
  /** Number of instances for this service template (from API `instances_count`). */
  instancesCount: number;
  serviceType: ServiceType;
  title: string;
  /** Lowercase public service key from Aurora; null when unset. */
  serviceKey: string | null;
  /** Optional admin label for booking system or flow (free-form text). */
  bookingSystem: string | null;
  description: string | null;
  coverImageS3Key: string | null;
  deliveryMode: ServiceDeliveryMode;
  status: ServiceStatus;
  /** Optional slug-like tier id on the service template (shared by instances). */
  serviceTier: string | null;
  /** Optional default venue id (FK locations). */
  locationId: string | null;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
  trainingDetails: {
    pricingUnit: TrainingPricingUnit;
    defaultPrice: string | null;
    defaultCurrency: string | null;
  } | null;
  eventDetails: {
    eventCategory: EventCategory;
    defaultPrice: string | null;
    defaultCurrency: string;
  } | null;
  consultationDetails: {
    consultationFormat: ConsultationFormat;
    maxGroupSize: number | null;
    durationMinutes: number | null;
    pricingModel: ConsultationPricingModel;
    defaultHourlyRate: string | null;
    defaultPackagePrice: string | null;
    defaultPackageSessions: number | null;
    defaultCurrency: string | null;
  } | null;
}

export interface ServiceDetail extends ServiceSummary {
  tagIds: string[];
  assetIds: string[];
  trainingDetails: {
    pricingUnit: TrainingPricingUnit;
    defaultPrice: string | null;
    defaultCurrency: string | null;
  } | null;
  eventDetails: {
    eventCategory: EventCategory;
    defaultPrice: string | null;
    defaultCurrency: string;
  } | null;
  consultationDetails: {
    consultationFormat: ConsultationFormat;
    maxGroupSize: number | null;
    durationMinutes: number | null;
    pricingModel: ConsultationPricingModel;
    defaultHourlyRate: string | null;
    defaultPackagePrice: string | null;
    defaultPackageSessions: number | null;
    defaultCurrency: string | null;
  } | null;
}

export interface SessionSlot {
  id: string | null;
  instanceId: string | null;
  locationId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number | null;
}

/** Session slot row in instance create/edit forms (`datetime-local` wall times, no offset). */
export interface SessionSlotFormRow {
  id: string | null;
  instanceId: string | null;
  locationId: string | null;
  startsAtLocal: string | null;
  endsAtLocal: string | null;
  sortOrder: number | null;
}

export interface LocationSummary {
  id: string;
  name: string | null;
  areaId: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** True when an active partner CRM organisation references this venue. */
  lockedFromPartnerOrg: boolean;
  /** Display labels for linked partner organisations (same venue address). */
  partnerOrganizationLabels: string[];
  /** Partner organisation UUIDs for this venue (same order as labels). */
  partnerOrganizationIds: string[];
}

export type GeographicAreaLevel = ApiSchemas['GeographicArea']['level'];

export interface GeographicAreaSummary {
  id: string;
  parentId: string | null;
  name: string;
  level: GeographicAreaLevel;
  code: string | null;
  sovereignCountryId: string | null;
  active: boolean;
  displayOrder: number;
}

export interface VenueFilters {
  areaId: string;
  search: string;
}

export const DEFAULT_VENUE_FILTERS: VenueFilters = {
  areaId: '',
  search: '',
};

export interface EventTicketTier {
  id: string | null;
  instanceId: string | null;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  maxQuantity: number | null;
  sortOrder: number | null;
}

/** Partner org on an event instance (`active` is false when archived in CRM). */
export interface PartnerOrgRef {
  id: string;
  name: string;
  active: boolean;
  /** Partner organization venue id when set (FK locations). */
  locationId: string | null;
}

export interface ServiceInstance {
  id: string;
  serviceId: string;
  parentServiceTitle: string | null;
  parentServiceTier: string | null;
  parentServiceType: ServiceType | null;
  /** Parent service public key when set on the service row. */
  parentServiceKey: string | null;
  title: string | null;
  /** Public instance slug from Aurora (required). */
  slug: string;
  description: string | null;
  coverImageS3Key: string | null;
  status: InstanceStatus;
  deliveryMode: ServiceDeliveryMode | null;
  locationId: string | null;
  maxCapacity: number | null;
  /** Raw DB column; display-only soft cap (nullable int ≥ 0). */
  capacityLeftOverride: number | null;
  /** Effective spots remaining for display when maxCapacity is set. */
  capacityLeftEffective: number | null;
  /** Enrollments that count toward capacity (registered, confirmed, completed). From admin API. */
  capacityEnrolledCount?: number;
  waitlistEnabled: boolean;
  /** Eventbrite async publish pipeline state from admin instance payloads. */
  eventbriteSyncStatus: EventbriteSyncStatus;
  externalUrl: string | null;
  partnerOrganizations: PartnerOrgRef[];
  instructorId: string | null;
  cohort: string | null;
  notes: string | null;
  tagIds: string[];
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
  resolvedTitle: string | null;
  resolvedSlug: string;
  resolvedDescription: string | null;
  resolvedCoverImageS3Key: string | null;
  resolvedDeliveryMode: string | null;
  /** Admin-only inherited venue (instance location, else service default). Public calendar ignores this. */
  resolvedLocationId: string | null;
  sessionSlots: SessionSlot[];
  trainingDetails: TrainingInstanceDetailsRow | null;
  /** Effective training pricing including parent service defaults. */
  resolvedTrainingDetails: TrainingInstanceDetailsRow | null;
  eventTicketTiers: EventTicketTier[];
  /** Effective event tiers for display including parent service defaults. */
  resolvedEventTicketTiers: EventTicketTier[];
  consultationDetails: ConsultationInstanceDetailsRow | null;
  /** Effective consultation pricing including parent service defaults. */
  resolvedConsultationDetails: ConsultationInstanceDetailsRow | null;
  /** False when this row is a per-booking child instance (consultation / intro). */
  isTemplate?: boolean;
  /** Parent template instance id when this row is a per-booking child. */
  parentInstanceId?: string | null;
}

export type TrainingInstanceDetailsRow = {
  trainingFormat: TrainingFormat;
  price: string;
  currency: string;
  pricingUnit: TrainingPricingUnit;
};

export type ConsultationInstanceDetailsRow = {
  pricingModel: ConsultationPricingModel;
  price: string | null;
  currency: string;
  packageSessions: number | null;
};

export interface Enrollment {
  id: string;
  instanceId: string;
  contactId: string | null;
  familyId: string | null;
  organizationId: string | null;
  ticketTierId: string | null;
  discountCodeId: string | null;
  status: EnrollmentStatus;
  amountPaid: string | null;
  currency: string | null;
  enrolledAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
  /** Server-computed party label (contact `name · email`, family/org `entity · primary` when applicable). */
  partyDisplayName?: string | null;
  /** Present when the admin enrollment list includes instance scheduled-start metadata. */
  scheduledStartAt?: string | null;
}

export interface DiscountCode {
  id: string;
  code: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: string;
  currency: string | null;
  validFrom: string | null;
  validUntil: string | null;
  serviceId: string | null;
  instanceId: string | null;
  maxUses: number | null;
  currentUses: number;
  active: boolean;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ServiceListFilters {
  serviceType: ServiceType | '';
  status: ServiceStatus | '';
  search: string;
}

export const DEFAULT_SERVICE_LIST_FILTERS: ServiceListFilters = {
  serviceType: '',
  status: 'published',
  search: '',
};

export interface InstanceListFilters {
  status: InstanceStatus | '';
}

export const DEFAULT_INSTANCE_LIST_FILTERS: InstanceListFilters = {
  status: '',
};

export interface EnrollmentListFilters {
  status: EnrollmentStatus | '';
}

export const DEFAULT_ENROLLMENT_LIST_FILTERS: EnrollmentListFilters = {
  status: '',
};

export type DiscountCodeScopeFilter = '' | 'unscoped' | 'service' | 'instance';

export interface DiscountCodeFilters {
  active: '' | 'true' | 'false';
  search: string;
  scope: DiscountCodeScopeFilter;
}

export const DEFAULT_DISCOUNT_CODE_FILTERS: DiscountCodeFilters = {
  active: '',
  search: '',
  scope: '',
};
