import type { BookingTopicsFieldConfig } from '@/components/sections/booking-modal/types';
import type {
  EventsContent,
  Locale,
} from '@/content';
import {
  readCandidateText,
  readOptionalText,
  toRecord,
} from '@/content/content-field-utils';
import {
  type CrmApiClient,
  buildCrmApiUrl,
  createPublicCrmApiClient,
  CrmApiRequestError,
  isAbortRequestError,
} from '@/lib/crm-api-client';
import { reportInternalError } from '@/lib/internal-error-reporting';
import { formatCohortValue, normalizeCurrencyPrefixForDisplay } from '@/lib/format';
import { ROUTES } from '@/lib/routes';
import {
  appendTimeZoneLabel,
  formatHeroFullDateLine,
  formatSiteCompactDate,
  formatSiteTimeOfDay,
  formatSiteTimeZoneShortName,
} from '@/lib/site-datetime';
import {
  getLandingPageContent,
  isValidLandingPageSlug,
} from '@/lib/landing-pages';
import { isHttpHref } from '@/lib/url-utils';

type EventStatus = 'open' | 'fully_booked';

export const EVENTS_API_PATH = '/v1/calendar/public';
/**
 * `service_key` for `GET /v1/calendar/public` when loading My Best Auntie training
 * course cohorts (matches CRM `services.key` for the MBA training course offering).
 */
export const MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY =
  'my-best-auntie-training-course';

/** Timeout for server-side / static-export calendar fetches (events, MBA, landing pages). */
export const CALENDAR_PUBLIC_BUILD_FETCH_TIMEOUT_MS = 15_000;

/**
 * Timeout for client-side calendar fetches (`useLandingPageCalendar`, availability slot
 * pickers). Must outlast an admin Lambda cold start (~6.5s observed: ~3.8s init + ~2.7s
 * first request); 5s aborted mid cold start and made low-traffic slot pickers fail on
 * first visit. Aligned with {@link CALENDAR_PUBLIC_BUILD_FETCH_TIMEOUT_MS}.
 */
export const CALENDAR_PUBLIC_CLIENT_FETCH_TIMEOUT_MS = 15_000;

/**
 * @deprecated Use {@link CALENDAR_PUBLIC_BUILD_FETCH_TIMEOUT_MS} for server/export fetches
 * or {@link CALENDAR_PUBLIC_CLIENT_FETCH_TIMEOUT_MS} for client hooks. This alias matches
 * the build timeout for backward compatibility with existing imports.
 */
export const CALENDAR_PUBLIC_FETCH_TIMEOUT_MS = CALENDAR_PUBLIC_BUILD_FETCH_TIMEOUT_MS;
const MAX_PAST_EVENTS = 5;
const BOOKING_SYSTEM_QUERY_PARAM = 'booking_system';
export const EVENT_BOOKING_SYSTEM = 'event-booking';
/** Consultation one-off booking modal (same reservation API shape as events). */
export const CONSULTATION_BOOKING_SYSTEM = 'consultation-booking';
export const MY_BEST_AUNTIE_BOOKING_SYSTEM = 'my-best-auntie-booking';
const MY_BEST_AUNTIE_BOOKING_HASH = 'my-best-auntie-booking';

/** Query keys for `GET /v1/calendar/public` (OpenAPI: `service_type`, `slug`, `service_key`). */
export interface EventsFetchParams {
  serviceType?: 'event' | 'training_course';
  slug?: string;
  serviceKey?: string;
}

interface EventBookingDatePart {
  id: string;
  /** 1-based session ordinal when known from API/content `part` (for MBA cohort dates). */
  sessionPart?: number;
  startDateTime: string;
  endDateTime: string;
  description: string;
}

/** Calendar / landing-page event reservations (public events feed). */
export interface EventCalendarBookingModalPayload {
  variant: 'event';
  bookingSystem: typeof EVENT_BOOKING_SYSTEM;
  /** Parent service public key from calendar JSON `service_key` (required for booking). */
  serviceKey: string;
  /** Public instance slug from calendar JSON `slug` (required for booking). */
  instanceSlug: string;
  title: string;
  subtitle: string;
  originalAmount: number;
  locationName: string;
  locationAddress: string;
  directionHref: string;
  dateParts: EventBookingDatePart[];
  selectedDateLabel: string;
  selectedDateStartTime: string;
  /** From landing page JSON `cta.bookingTopicsField` when `slug` matches a registered page. */
  topicsFieldConfig?: BookingTopicsFieldConfig;
  /** Optional notes/topics prefill when opening via `EventBookingModal` (e.g. landing CTA). */
  topicsPrefill?: string;
}

/** One-off consultations (same modal + API shape as calendar events, distinct booking_system). */
export interface ConsultationEventBookingModalPayload {
  variant: 'event';
  bookingSystem: typeof CONSULTATION_BOOKING_SYSTEM;
  serviceKey: string;
  title: string;
  subtitle: string;
  originalAmount: number;
  locationName: string;
  locationAddress: string;
  /** Omit or empty: modal hides “Get directions”. */
  directionHref?: string;
  dateParts: EventBookingDatePart[];
  selectedDateLabel: string;
  selectedDateStartTime: string;
  topicsFieldConfig?: BookingTopicsFieldConfig;
  /** Pre-fills the booking modal topics / notes field (consultations focus + level). */
  topicsPrefill?: string;
}

export type EventBookingModalPayload =
  | EventCalendarBookingModalPayload
  | ConsultationEventBookingModalPayload;

interface MyBestAuntieEventCohortDate {
  part: number;
  start_datetime: string;
  end_datetime: string;
}

export interface MyBestAuntieEventCohort {
  /** Public instance slug (`service_instances.slug` from API; content `slug`). */
  slug: string;
  /** Tier slug from calendar/API JSON key `service_tier` (formerly `age_group`). */
  service_tier: string;
  title: string;
  description: string;
  /**
   * Cohort month-year token from the API. Accepts legacy numeric month form (`04-26`)
   * or canonical three-letter English month abbreviations (`apr-26`, case-insensitive).
   */
  cohort: string;
  spaces_total: number;
  spaces_left: number;
  is_fully_booked: boolean;
  price: number;
  currency: string;
  location: string;
  booking_system: string;
  tags: string[];
  categories: string[];
  location_name: string;
  location_address: string;
  location_url: string;
  dates: MyBestAuntieEventCohortDate[];
}

export interface MyBestAuntieBookingModalPayload {
  variant: 'my-best-auntie';
  bookingSystem: typeof MY_BEST_AUNTIE_BOOKING_SYSTEM;
  selectedServiceTierLabel: string;
  selectedCohortDateLabel: string;
  selectedCohort: MyBestAuntieEventCohort;
}

export type EventCardBookingModalPayload =
  | EventBookingModalPayload
  | MyBestAuntieBookingModalPayload;

export interface EventCardData {
  id: string;
  title: string;
  summary?: string;
  dateLabel?: string;
  timeLabel?: string;
  costLabel?: string;
  isFreeCost?: boolean;
  isVirtualEvent: boolean;
  locationName?: string;
  locationAddress?: string;
  directionHref?: string;
  ctaHref: string;
  ctaLabel: string;
  tags: string[];
  partners?: string[];
  status: EventStatus;
  timestamp: number | null;
  endTimestamp?: number | null;
  price?: number;
  currency?: string;
  bookingSystem?: string;
  bookingModalPayload?: EventCardBookingModalPayload;
}

export interface LandingPageHeroEventContent {
  title: string;
  startDateTime?: string;
  endDateTime?: string;
  locationLabel?: string;
  partners?: string[];
  categoryChips: string[];
}

export interface LandingPageBookingEventContent {
  status: EventStatus;
  bookingPayload: EventBookingModalPayload | null;
  ctaPriceLabel?: string;
  spacesLeft?: number;
  eyebrowDateLabel?: string;
}

export interface LandingPageStructuredDataContent {
  eventName: string;
  description: string;
  startDate: string;
  endDate?: string;
  locationName?: string;
  locationAddress?: string;
  offerPrice?: string;
  offerCurrency?: string;
  offerAvailability: 'InStock' | 'SoldOut';
}

function resolveEventsLocale(locale?: string): Locale {
  if (locale === 'zh-CN' || locale === 'zh-HK') {
    return locale;
  }

  return 'en';
}

function formatEnumLikeLabel(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  // Preserve numeric ranges (for example, "1-4") used as age-group tags.
  if (/^\d+\s*-\s*\d+$/.test(trimmedValue)) {
    return trimmedValue.replace(/\s*-\s*/g, '-');
  }

  if (/\s/.test(trimmedValue) || !/[_-]/.test(trimmedValue)) {
    return trimmedValue;
  }

  return trimmedValue
    .split(/[_-]+/)
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1).toLowerCase())
    .join(' ');
}

/** Display labels for landing page hero category chips (CRM `categories` list). */
function formatLandingPageCategoryChipLabel(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  if (/^\d+\s*-\s*\d+$/.test(trimmedValue)) {
    return trimmedValue.replace(/\s*-\s*/g, '-');
  }

  return trimmedValue
    .split('-')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function sanitizeExternalHref(value: string | undefined): string {
  const href = readOptionalText(value);
  if (!href || !isHttpHref(href)) {
    return '';
  }

  return href;
}

function localizeRoutePath(path: string, locale: Locale): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath === '/') {
    return `/${locale}`;
  }

  return `/${locale}${normalizedPath}`;
}

function resolveBookingSystemCtaHref(
  bookingSystemValue: string | undefined,
  locale: Locale,
): string {
  const bookingSystem = readOptionalText(bookingSystemValue);
  if (!bookingSystem) {
    return '';
  }

  if (bookingSystem === EVENT_BOOKING_SYSTEM) {
    const localizedEventsPath = localizeRoutePath(ROUTES.events, locale);
    return `${localizedEventsPath}?${BOOKING_SYSTEM_QUERY_PARAM}=${EVENT_BOOKING_SYSTEM}`;
  }

  if (bookingSystem !== MY_BEST_AUNTIE_BOOKING_SYSTEM) {
    return '';
  }

  const localizedMyBestAuntiePath = localizeRoutePath(
    ROUTES.servicesMyBestAuntieTrainingCourse,
    locale,
  );

  return `${localizedMyBestAuntiePath}?${BOOKING_SYSTEM_QUERY_PARAM}=${MY_BEST_AUNTIE_BOOKING_SYSTEM}#${MY_BEST_AUNTIE_BOOKING_HASH}`;
}

function isGoogleMapsHref(href: string): boolean {
  try {
    const parsedUrl = new URL(href);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    if (hostname === 'maps.app.goo.gl') {
      return true;
    }

    if (!hostname.includes('google.')) {
      return false;
    }

    return pathname === '/' || pathname.startsWith('/maps');
  } catch {
    return false;
  }
}

function sanitizeGoogleMapsHref(value: string | undefined): string {
  const href = sanitizeExternalHref(value);
  if (!href || !isGoogleMapsHref(href)) {
    return '';
  }

  return href;
}

function parseTimestamp(value: string | undefined): number | null {
  const text = readOptionalText(value);
  if (!text) {
    return null;
  }

  const parsedTimestamp = Date.parse(text);
  if (Number.isNaN(parsedTimestamp)) {
    return null;
  }

  return parsedTimestamp;
}

function resolveNumericCandidate(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  const value = readFirstCandidateValue(record, keys);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const textValue = readOptionalText(value);
  if (!textValue) {
    return null;
  }

  return parseNumericText(textValue);
}

function resolveStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? readOptionalText(entry) : undefined))
    .filter((entry): entry is string => Boolean(entry));
}

function resolvePartnerSlugs(value: unknown): string[] {
  const slugs = resolveStringList(value)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[a-z0-9-]+$/.test(entry));

  return Array.from(new Set(slugs));
}

function resolveBookingTopicsFieldFromLandingPage(
  record: Record<string, unknown>,
  locale: Locale,
): BookingTopicsFieldConfig | undefined {
  const landingPageSlug = readCandidateText(record, ['slug'])?.trim() ?? '';
  if (!landingPageSlug || !isValidLandingPageSlug(landingPageSlug)) {
    return undefined;
  }

  const pageLocale = getLandingPageContent(landingPageSlug, locale);
  const field = pageLocale?.cta?.bookingTopicsField;
  if (!field) {
    return undefined;
  }

  const label = readOptionalText(field.label);
  if (!label) {
    return undefined;
  }

  return {
    label,
    placeholder: readOptionalText(field.placeholder),
    required: Boolean(field.required),
  };
}

function resolveBookingDateParts(
  record: Record<string, unknown>,
  defaultDescription: string,
): EventBookingDatePart[] {
  const dateEntries = Array.isArray(record.dates) ? record.dates : [];

  return dateEntries.flatMap((entry, index): EventBookingDatePart[] => {
    const dateRecord = toRecord(entry);
    if (!dateRecord) {
      return [];
    }

    const startDateTime = readCandidateText(dateRecord, [
      'start_datetime',
      'startDateTime',
      'start',
    ]) ?? '';
    const endDateTime = readCandidateText(dateRecord, [
      'end_datetime',
      'endDateTime',
      'end',
    ]) ?? '';
    const partRaw = readFirstCandidateValue(dateRecord, ['part', 'Part']);
    let part: number | null = null;
    if (typeof partRaw === 'number' && Number.isInteger(partRaw) && partRaw > 0) {
      part = partRaw;
    } else {
      const partText = readOptionalText(partRaw);
      if (partText) {
        const parsed = Number.parseInt(partText, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          part = parsed;
        }
      }
    }
    if (part === null) {
      part = index + 1;
    }
    const id = `part-${part}`;
    if (!startDateTime) {
      return [];
    }

    return [
      {
        id,
        sessionPart: part,
        startDateTime,
        endDateTime,
        description: index === 0 ? defaultDescription : '',
      },
    ];
  });
}

function buildEventBookingModalPayload(
  record: Record<string, unknown>,
  locale: Locale,
  title: string,
  summary: string | undefined,
  locationName: string | undefined,
  locationAddress: string | undefined,
  directionHref: string,
): EventCalendarBookingModalPayload {
  const dateParts = resolveBookingDateParts(record, summary ?? '');
  const selectedDateStartTime = dateParts[0]?.startDateTime ?? '';
  const selectedDateLabel =
    formatSiteCompactDate(selectedDateStartTime, locale) || title;
  const originalAmount = resolveNumericCandidate(record, [
    'price',
    'cost',
    'amount',
    'fee',
    'eventPrice',
    'event_price',
  ]) ?? 0;

  const topicsFieldConfig = resolveBookingTopicsFieldFromLandingPage(record, locale);

  const instanceSlug = readCandidateText(record, ['slug', 'id', 'eventId'])?.trim() ?? '';
  const serviceKey =
    readCandidateText(record, ['service_key', 'serviceKey'])?.trim() ?? '';

  return {
    variant: 'event',
    bookingSystem: EVENT_BOOKING_SYSTEM,
    serviceKey,
    instanceSlug,
    title,
    subtitle: summary ?? '',
    originalAmount,
    locationName: locationName ?? '',
    locationAddress: locationAddress ?? '',
    directionHref,
    dateParts,
    selectedDateLabel,
    selectedDateStartTime,
    ...(topicsFieldConfig ? { topicsFieldConfig } : {}),
  };
}

function buildMyBestAuntieBookingModalPayload(
  record: Record<string, unknown>,
  locale: Locale,
): MyBestAuntieBookingModalPayload | null {
  const slug =
    readCandidateText(record, ['slug', 'id', 'eventId'])?.trim() ?? '';
  const serviceTier = readCandidateText(record, ['service_tier']) ?? '';
  const cohortValue = readCandidateText(record, ['cohort']) ?? '';
  if (!slug || !serviceTier || !cohortValue) {
    return null;
  }

  const title = readCandidateText(record, ['title']) ?? '';
  const description = readCandidateText(record, ['description']) ?? '';
  const spacesTotal = resolveNumericCandidate(record, ['spaces_total']) ?? 0;
  const spacesLeft = resolveNumericCandidate(record, ['spaces_left']) ?? 0;
  const price = resolveNumericCandidate(record, ['price']) ?? 0;
  const currency = readCandidateText(record, ['currency']) ?? 'HKD';
  const location = readCandidateText(record, ['location']) ?? 'physical';
  const locationAddress = readCandidateText(record, [
    'location_address',
    'locationAddress',
    'address',
  ]) ?? '';
  const locationName = readCandidateText(record, [
    'location_name',
    'locationName',
    'venue',
  ]) ?? locationAddress;
  const locationUrl = sanitizeGoogleMapsHref(
    readCandidateText(record, ['location_url', 'locationUrl', 'address_url']),
  );
  const dates = resolveBookingDateParts(record, '').map((partRow, idx) => {
    const part =
      typeof partRow.sessionPart === 'number' && partRow.sessionPart > 0
        ? partRow.sessionPart
        : idx + 1;
    return {
      part,
      start_datetime: partRow.startDateTime,
      end_datetime: partRow.endDateTime,
    };
  });
  if (dates.length === 0) {
    return null;
  }

  const selectedCohort: MyBestAuntieEventCohort = {
    slug,
    service_tier: serviceTier,
    title,
    description,
    cohort: cohortValue,
    spaces_total: spacesTotal,
    spaces_left: spacesLeft,
    is_fully_booked: resolveEventStatus(record) === 'fully_booked',
    price,
    currency,
    location,
    booking_system: MY_BEST_AUNTIE_BOOKING_SYSTEM,
    tags: resolveStringList(record.tags),
    categories: resolveStringList(record.categories),
    location_name: locationName,
    location_address: locationAddress,
    location_url: locationUrl,
    dates,
  };

  return {
    variant: 'my-best-auntie',
    bookingSystem: MY_BEST_AUNTIE_BOOKING_SYSTEM,
    selectedServiceTierLabel: serviceTier,
    selectedCohortDateLabel: formatCohortValue(cohortValue, locale),
    selectedCohort,
  };
}

function resolveBookingModalPayload(
  record: Record<string, unknown>,
  bookingSystem: string | undefined,
  locale: Locale,
  title: string,
  summary: string | undefined,
  locationName: string | undefined,
  locationAddress: string | undefined,
  directionHref: string,
): EventCardBookingModalPayload | undefined {
  if (bookingSystem === EVENT_BOOKING_SYSTEM) {
    return buildEventBookingModalPayload(
      record,
      locale,
      title,
      summary,
      locationName,
      locationAddress,
      directionHref,
    );
  }

  if (bookingSystem === MY_BEST_AUNTIE_BOOKING_SYSTEM) {
    return buildMyBestAuntieBookingModalPayload(record, locale) ?? undefined;
  }

  return undefined;
}

function extractTrailingLocationSegment(value: string | undefined): string | undefined {
  const normalizedValue = readOptionalText(value);
  if (!normalizedValue) {
    return undefined;
  }

  const lastCommaIndex = normalizedValue.lastIndexOf(',');
  if (lastCommaIndex < 0) {
    return normalizedValue;
  }

  const trailingSegment = normalizedValue.slice(lastCommaIndex + 1).trim();
  return trailingSegment || normalizedValue;
}

function dedupeChipLabels(chips: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const uniqueChips: string[] = [];

  for (const value of chips) {
    const normalizedValue = readOptionalText(value);
    if (!normalizedValue) {
      continue;
    }
    if (seen.has(normalizedValue)) {
      continue;
    }

    seen.add(normalizedValue);
    uniqueChips.push(normalizedValue);
  }

  return uniqueChips;
}

function readLandingPageCategoryChips(
  record: Record<string, unknown>,
): string[] {
  const value = record.categories;
  const categories: string[] = [];

  if (Array.isArray(value)) {
    categories.push(
      ...value
        .map((entry) => {
          if (typeof entry === 'string') {
            return readOptionalText(entry);
          }
          const entryRecord = toRecord(entry);
          if (!entryRecord) {
            return undefined;
          }
          return readCandidateText(entryRecord, ['label', 'title', 'name']);
        })
        .filter((entry): entry is string => Boolean(entry)),
    );
  } else if (typeof value === 'string') {
    categories.push(
      ...value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry): entry is string => Boolean(entry)),
    );
  } else {
    const valueRecord = toRecord(value);
    if (valueRecord) {
      categories.push(
        ...Object.values(valueRecord)
          .map((entry) => (typeof entry === 'string' ? readOptionalText(entry) : undefined))
          .filter((entry): entry is string => Boolean(entry)),
      );
    }
  }

  return dedupeChipLabels(
    categories.map((entry) => formatLandingPageCategoryChipLabel(entry)),
  );
}

function resolveDateTimeDetails(
  record: Record<string, unknown>,
  locale: Locale,
): {
  dateLabel?: string;
  timeLabel?: string;
  timeZoneLabel?: string;
  timestamp: number | null;
  endTimestamp?: number | null;
} {
  const dateEntries = Array.isArray(record.dates) ? record.dates : [];
  const dateRecords = dateEntries
    .map((entry) => toRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const firstDateRecord = dateRecords[0] ?? null;

  if (!firstDateRecord) {
    return { timestamp: null };
  }

  const startDateTime = readCandidateText(firstDateRecord, [
    'start_datetime',
    'startDateTime',
    'start',
  ]);
  const endDateTime = readCandidateText(firstDateRecord, [
    'end_datetime',
    'endDateTime',
    'end',
  ]);

  if (!startDateTime) {
    return { timestamp: null };
  }

  const lastDateRecord = dateRecords[dateRecords.length - 1] ?? firstDateRecord;
  const lastEndDateTime = readCandidateText(lastDateRecord, [
    'end_datetime',
    'endDateTime',
    'end',
  ]) ?? endDateTime;

  const dateLabel = formatSiteCompactDate(startDateTime, locale);
  const startTimeLabel = formatSiteTimeOfDay(startDateTime, locale);
  const endTimeLabel = endDateTime ? formatSiteTimeOfDay(endDateTime, locale) : '';
  const timeLabel =
    startTimeLabel && endTimeLabel
      ? `${startTimeLabel} - ${endTimeLabel}`
      : startTimeLabel;
  const timeZoneLabel = formatSiteTimeZoneShortName(startDateTime, locale);

  return {
    dateLabel: dateLabel || undefined,
    timeLabel: timeLabel || undefined,
    timeZoneLabel: timeZoneLabel || undefined,
    timestamp: parseTimestamp(startDateTime),
    endTimestamp: parseTimestamp(lastEndDateTime),
  };
}

function buildEventsApiUrl(crmApiBaseUrl: string): string {
  return buildCrmApiUrl(crmApiBaseUrl, EVENTS_API_PATH);
}

/**
 * Builds the calendar public endpoint path including optional filters
 * (`service_type`, `slug`, `service_key`).
 */
export function buildEventsApiPath(params?: EventsFetchParams): string {
  if (!params) {
    return EVENTS_API_PATH;
  }

  const search = new URLSearchParams();
  if (params.serviceType) {
    search.set('service_type', params.serviceType);
  }
  if (params.slug?.trim()) {
    search.set('slug', params.slug.trim());
  }
  if (params.serviceKey?.trim()) {
    search.set('service_key', params.serviceKey.trim());
  }

  const query = search.toString();
  return query ? `${EVENTS_API_PATH}?${query}` : EVENTS_API_PATH;
}

function normalizeLocationLabel(
  value: string | undefined,
  content: EventsContent,
): string | undefined {
  const normalizedValue = readOptionalText(value);
  if (!normalizedValue) {
    return undefined;
  }

  const normalizedKey = normalizedValue.toLowerCase();

  if (normalizedKey === 'virtual') {
    return content.locationTypeLabels.virtual;
  }

  if (normalizedKey === 'physical') {
    return content.locationTypeLabels.inPerson;
  }

  return formatEnumLikeLabel(normalizedValue);
}

function isVirtualLocationType(value: string | undefined): boolean {
  const normalizedValue = readOptionalText(value)?.toLowerCase();
  return normalizedValue === 'virtual';
}

function readFirstCandidateValue(
  record: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      return record[key];
    }
  }

  return undefined;
}

function parseNumericText(value: string): number | null {
  const normalizedValue = value.replaceAll(',', '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number(normalizedValue);
  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return parsedValue;
}

function formatNumberWithThousandsSeparators(value: number): string {
  return new Intl.NumberFormat('en-US', {
    useGrouping: true,
    maximumFractionDigits: 20,
  }).format(value);
}

function resolveEventCost(
  record: Record<string, unknown>,
  content: EventsContent,
): { costLabel?: string; isFreeCost: boolean } {
  const explicitCostLabel = readCandidateText(record, [
    'costLabel',
    'cost_label',
    'priceLabel',
    'price_label',
    'priceDisplay',
    'price_display',
    'costDisplay',
    'cost_display',
    'feeLabel',
    'fee_label',
    'amountLabel',
    'amount_label',
  ]);
  if (explicitCostLabel) {
    const explicitAmount = parseNumericText(explicitCostLabel);
    if (explicitAmount === 0) {
      return { costLabel: content.card.freeLabel, isFreeCost: true };
    }

    if (explicitAmount !== null) {
      return {
        costLabel: formatNumberWithThousandsSeparators(explicitAmount),
        isFreeCost: false,
      };
    }
    return { costLabel: explicitCostLabel, isFreeCost: false };
  }

  const rawAmount = readFirstCandidateValue(record, [
    'price',
    'cost',
    'amount',
    'fee',
    'eventPrice',
    'event_price',
  ]);
  const currencyPrefix = readCandidateText(record, [
    'currencySymbol',
    'currency_symbol',
    'currencyPrefix',
    'currency_prefix',
    'currencyCode',
    'currency_code',
    'currency',
    'priceCurrency',
    'price_currency',
  ]);
  const normalizedCurrencyPrefix = normalizeCurrencyPrefixForDisplay(currencyPrefix);

  const amountText =
    typeof rawAmount === 'number' && Number.isFinite(rawAmount)
      ? String(rawAmount)
      : readOptionalText(rawAmount);
  if (!amountText) {
    return { isFreeCost: false };
  }

  const numericAmount = parseNumericText(amountText);
  if (numericAmount === 0) {
    return { costLabel: content.card.freeLabel, isFreeCost: true };
  }

  const formattedAmountText =
    numericAmount === null
      ? amountText
      : formatNumberWithThousandsSeparators(numericAmount);

  if (numericAmount !== null && normalizedCurrencyPrefix) {
    return { costLabel: `${normalizedCurrencyPrefix}${formattedAmountText}`, isFreeCost: false };
  }

  return { costLabel: formattedAmountText, isFreeCost: false };
}

function formatLandingPageEventCtaPriceLabel(
  record: Record<string, unknown>,
): string | undefined {
  const amount = resolveNumericCandidate(record, [
    'price',
    'cost',
    'amount',
    'fee',
    'eventPrice',
    'event_price',
  ]);
  if (amount === null) {
    return undefined;
  }

  const formattedAmount = formatNumberWithThousandsSeparators(amount);
  const currencyPrefix = normalizeCurrencyPrefixForDisplay(
    readCandidateText(record, [
      'currencySymbol',
      'currency_symbol',
      'currencyPrefix',
      'currency_prefix',
      'currencyCode',
      'currency_code',
      'currency',
      'priceCurrency',
      'price_currency',
    ]),
  );

  if (currencyPrefix) {
    return `${currencyPrefix}${formattedAmount}`;
  }

  return formattedAmount;
}

export async function fetchEventsPayload(
  crmApiClient: CrmApiClient | null,
  signal: AbortSignal,
  params?: EventsFetchParams,
): Promise<unknown> {
  if (!crmApiClient) {
    throw new Error('CRM API client is not configured');
  }

  return crmApiClient.request({
    endpointPath: buildEventsApiPath(params),
    method: 'GET',
    signal,
  });
}

function resolveLandingPageCalendarFetchFailureReason(error: unknown): string {
  if (isAbortRequestError(error)) {
    return 'timeout';
  }

  if (error instanceof CrmApiRequestError) {
    if (error.statusCode >= 500) {
      return 'http_5xx';
    }
    if (error.statusCode >= 400) {
      return 'http_4xx';
    }
  }

  return 'fetch_error';
}

export interface FetchLandingPageCalendarPayloadOptions {
  slug: string;
  timeoutMs?: number;
  attempts?: number;
}

export interface FetchLandingPageCalendarPayloadResult {
  payload: unknown | null;
  lastError: unknown | null;
}

/**
 * Server-side fetch for landing page calendar with per-attempt timeout and retries.
 * Reports every failed attempt (including timeouts) via {@link reportInternalError}.
 */
export async function fetchLandingPageCalendarPayload({
  slug,
  timeoutMs = CALENDAR_PUBLIC_BUILD_FETCH_TIMEOUT_MS,
  attempts = 2,
}: FetchLandingPageCalendarPayloadOptions): Promise<FetchLandingPageCalendarPayloadResult> {
  const crmApiClient = createPublicCrmApiClient();
  if (!crmApiClient) {
    const error = new Error('CRM API client is not configured');
    reportInternalError({
      context: 'landing-page-calendar-fetch',
      error,
      metadata: { slug, attempt: 0, reason: 'missing_public_crm_client' },
    });
    return { payload: null, lastError: error };
  }

  const normalizedAttempts = Math.max(1, attempts);
  let lastError: unknown | null = null;

  for (let attempt = 1; attempt <= normalizedAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const payload = await fetchEventsPayload(crmApiClient, controller.signal, {
        slug,
      });
      return { payload, lastError: null };
    } catch (error) {
      lastError = error;
      const reason = resolveLandingPageCalendarFetchFailureReason(error);
      reportInternalError({
        context: 'landing-page-calendar-fetch',
        error,
        metadata: { slug, attempt, reason },
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return { payload: null, lastError };
}

export function resolveEventsApiUrl(
  crmApiBaseUrl: string,
): string {
  return buildEventsApiUrl(crmApiBaseUrl);
}

function findEventsArray(payload: unknown, depth = 0): unknown[] {
  if (depth > 6) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  const record = toRecord(payload);
  if (!record) {
    return [];
  }

  const directArrayKeys = ['events', 'items', 'results', 'records'];
  for (const key of directArrayKeys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  const nestedKeys = ['data', 'payload', 'result', 'response'];
  for (const key of nestedKeys) {
    const nested = findEventsArray(record[key], depth + 1);
    if (nested.length > 0) {
      return nested;
    }
  }

  return [];
}

export function findLandingPageEventInPayload(
  payload: unknown,
  slug: string,
): Record<string, unknown> | null {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  for (const entry of findEventsArray(payload)) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }

    const eventSlug = readCandidateText(record, ['slug']);
    if (!eventSlug) {
      continue;
    }

    if (eventSlug.trim().toLowerCase() === normalizedSlug) {
      return record;
    }
  }

  return null;
}

function findFirstEventDateRecord(
  eventRecord: Record<string, unknown>,
): Record<string, unknown> | null {
  const dateEntries = Array.isArray(eventRecord.dates) ? eventRecord.dates : [];
  return dateEntries
    .map((entry) => toRecord(entry))
    .find((entry): entry is Record<string, unknown> => entry !== null) ?? null;
}

function normalizeEventsFromArray(
  eventsArray: unknown[],
  content: EventsContent,
  locale: Locale,
): EventCardData[] {
  return eventsArray
    .map((item, index) => normalizeEventCard(item, index, content, locale))
    .filter((item): item is EventCardData => item !== null);
}

function readTagList(record: Record<string, unknown>): string[] {
  const tagKeys = ['tags', 'chips', 'categories'];
  const tags: string[] = [];
  const seenTags = new Set<string>();

  for (const key of tagKeys) {
    const value = record[key];
    const collectedTags: string[] = [];

    if (Array.isArray(value)) {
      collectedTags.push(
        ...value
        .map((item) => {
          if (typeof item === 'string') {
            return readOptionalText(item);
          }
          const itemRecord = toRecord(item);
          if (!itemRecord) {
            return undefined;
          }

          return readCandidateText(itemRecord, ['label', 'title', 'name']);
        })
        .filter((item): item is string => Boolean(item)),
      );
    }

    if (typeof value === 'string') {
      collectedTags.push(
        ...value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry): entry is string => Boolean(entry)),
      );
    }

    const valueRecord = toRecord(value);
    if (valueRecord) {
      collectedTags.push(
        ...Object.values(valueRecord)
          .map((entry) => (typeof entry === 'string' ? readOptionalText(entry) : ''))
          .filter((entry): entry is string => Boolean(entry)),
      );
    }

    for (const tag of collectedTags) {
      const normalizedTag = formatEnumLikeLabel(tag);
      if (!normalizedTag) {
        continue;
      }
      if (!seenTags.has(normalizedTag)) {
        seenTags.add(normalizedTag);
        tags.push(normalizedTag);
      }
    }
  }

  return tags;
}

function resolveEventStatus(record: Record<string, unknown>): EventStatus {
  const statusText = readCandidateText(record, [
    'status',
    'bookingStatus',
    'availability',
  ]);

  if (statusText) {
    const normalizedStatus = statusText.toLowerCase();
    if (
      normalizedStatus.includes('full') ||
      normalizedStatus.includes('booked') ||
      normalizedStatus.includes('sold')
    ) {
      return 'fully_booked';
    }
  }

  const fullStateKeys = ['isFullyBooked', 'fullyBooked', 'soldOut', 'isSoldOut'];
  for (const key of fullStateKeys) {
    if (record[key] === true) {
      return 'fully_booked';
    }
  }

  if (record.is_fully_booked === true) {
    return 'fully_booked';
  }

  return 'open';
}

function normalizeEventCard(
  value: unknown,
  index: number,
  content: EventsContent,
  locale: Locale,
): EventCardData | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const title = readCandidateText(record, ['title', 'name', 'eventTitle']);
  if (!title) {
    return null;
  }

  const dateTimeDetails = resolveDateTimeDetails(record, locale);
  const summary = readCandidateText(record, [
    'summary',
    'description',
    'details',
    'excerpt',
    'body',
  ]);

  const dateLabel = readCandidateText(record, [
    'dateLabel',
    'date',
    'eventDate',
    'startDateLabel',
    'dateDisplay',
  ]) ?? dateTimeDetails.dateLabel;
  const rawTimeLabel = readCandidateText(record, [
    'timeLabel',
    'time',
    'eventTime',
    'startTimeLabel',
    'timeDisplay',
  ]) ?? dateTimeDetails.timeLabel;
  const timeZoneLabel = dateTimeDetails.timeZoneLabel;
  const timeLabel = appendTimeZoneLabel(rawTimeLabel, timeZoneLabel);

  const timestamp =
    parseTimestamp(
      readCandidateText(record, [
        'startsAt',
        'startAt',
        'startDateTime',
        'startDate',
        'dateIso',
      ]),
    ) ??
    dateTimeDetails.timestamp ??
    parseTimestamp(dateLabel);

  const locationName =
    readCandidateText(record, [
      'location_name',
      'locationName',
      'venue',
      'location_address',
      'locationAddress',
      'address',
    ]) ?? normalizeLocationLabel(readOptionalText(record.location), content);
  const isVirtualEvent = isVirtualLocationType(
    readCandidateText(record, [
      'locationType',
      'location_type',
      'location',
      'venueType',
      'venue_type',
    ]),
  );
  const locationAddress = readCandidateText(record, [
    'location_address',
    'locationAddress',
    'venueAddress',
    'address',
  ]);
  const directionHref = sanitizeGoogleMapsHref(
    readCandidateText(record, [
      'location_url',
      'directionHref',
      'directionUrl',
      'mapHref',
      'mapUrl',
      'mapsUrl',
      'locationMapUrl',
      'locationUrl',
      'address_url',
    ]),
  );
  const bookingSystem = readOptionalText(record.booking_system) ?? undefined;
  const bookingModalPayload = resolveBookingModalPayload(
    record,
    bookingSystem,
    locale,
    title,
    summary,
    locationName,
    locationAddress,
    directionHref,
  );

  const ctaHref =
    resolveBookingSystemCtaHref(bookingSystem, locale) ||
    sanitizeExternalHref(readOptionalText(record.external_url));
  const ctaLabel =
    readCandidateText(record, ['ctaLabel', 'buttonLabel', 'actionLabel']) ??
    content.card.ctaLabel;

  const rawId = readCandidateText(record, ['slug', 'id', 'eventId']) ?? '';
  const fallbackId = `${title}-${dateLabel ?? ''}-${index}`;
  const status = resolveEventStatus(record);
  const tags = readTagList(record);
  const partners = resolvePartnerSlugs(record.partners);
  const { costLabel, isFreeCost } = resolveEventCost(record, content);
  const rawPrice = resolveNumericCandidate(record, [
    'price',
    'cost',
    'amount',
    'fee',
    'eventPrice',
    'event_price',
  ]);
  const rawCurrency = readCandidateText(record, [
    'currency',
    'priceCurrency',
    'price_currency',
  ]);

  return {
    id: rawId || fallbackId,
    title,
    summary,
    dateLabel,
    timeLabel,
    costLabel,
    isFreeCost,
    isVirtualEvent,
    locationName,
    locationAddress:
      locationAddress && locationAddress !== locationName
        ? locationAddress
        : undefined,
    directionHref: directionHref || undefined,
    ctaHref,
    ctaLabel,
    tags,
    partners: partners.length > 0 ? partners : undefined,
    status,
    timestamp,
    endTimestamp: dateTimeDetails.endTimestamp,
    price: rawPrice ?? undefined,
    currency: rawCurrency ?? undefined,
    bookingSystem,
    bookingModalPayload,
  };
}

export function normalizeEvents(
  payload: unknown,
  content: EventsContent,
  locale?: string,
): EventCardData[] {
  const normalizedLocale = resolveEventsLocale(locale);
  const eventsArray = findEventsArray(payload);

  return normalizeEventsFromArray(eventsArray, content, normalizedLocale);
}

export function getLandingPageHeroEventContentFromPayload(
  payload: unknown,
  slug: string,
): LandingPageHeroEventContent | null {
  const eventRecord = findLandingPageEventInPayload(payload, slug);
  if (!eventRecord) {
    return null;
  }

  const title = readCandidateText(eventRecord, ['title', 'name', 'eventTitle']);
  if (!title) {
    return null;
  }

  const firstDateRecord = findFirstEventDateRecord(eventRecord);
  const startDateTime = firstDateRecord
    ? readCandidateText(firstDateRecord, ['start_datetime', 'startDateTime', 'start'])
    : undefined;
  const endDateTime = firstDateRecord
    ? readCandidateText(firstDateRecord, ['end_datetime', 'endDateTime', 'end'])
    : undefined;
  const locationSource =
    readCandidateText(eventRecord, [
      'location_address',
      'locationAddress',
      'venueAddress',
      'address',
      'location_name',
      'locationName',
      'venue',
    ]) ?? readOptionalText(eventRecord.location);
  const locationLabel = extractTrailingLocationSegment(locationSource);
  const partners = resolvePartnerSlugs(eventRecord.partners);

  return {
    title,
    startDateTime: startDateTime || undefined,
    endDateTime: endDateTime || undefined,
    locationLabel,
    partners: partners.length > 0 ? partners : undefined,
    categoryChips: readLandingPageCategoryChips(eventRecord),
  };
}

export function getLandingPageBookingEventContentFromPayload(
  payload: unknown,
  slug: string,
  locale?: string,
): LandingPageBookingEventContent | null {
  const eventRecord = findLandingPageEventInPayload(payload, slug);
  if (!eventRecord) {
    return null;
  }

  const title = readCandidateText(eventRecord, ['title', 'name', 'eventTitle']);
  if (!title) {
    return null;
  }

  const normalizedLocale = resolveEventsLocale(locale);
  const firstDateRecord = findFirstEventDateRecord(eventRecord);
  const firstStartDateTime = firstDateRecord
    ? readCandidateText(firstDateRecord, ['start_datetime', 'startDateTime', 'start'])
    : undefined;
  const spacesLeft = resolveNumericCandidate(eventRecord, ['spaces_left', 'spacesLeft']);
  const summary = readCandidateText(eventRecord, [
    'summary',
    'description',
    'details',
    'excerpt',
    'body',
  ]);
  const locationName = readCandidateText(eventRecord, [
    'location_name',
    'locationName',
    'venue',
    'location_address',
    'locationAddress',
    'address',
  ]);
  const locationAddress = readCandidateText(eventRecord, [
    'location_address',
    'locationAddress',
    'venueAddress',
    'address',
  ]);
  const directionHref = sanitizeGoogleMapsHref(
    readCandidateText(eventRecord, [
      'location_url',
      'directionHref',
      'directionUrl',
      'mapHref',
      'mapUrl',
      'mapsUrl',
      'locationMapUrl',
      'locationUrl',
      'address_url',
    ]),
  );
  const bookingSystem = readOptionalText(eventRecord.booking_system) ?? undefined;
  const resolvedPayload = resolveBookingModalPayload(
    eventRecord,
    bookingSystem,
    normalizedLocale,
    title,
    summary,
    locationName,
    locationAddress,
    directionHref,
  );

  return {
    status: resolveEventStatus(eventRecord),
    bookingPayload: resolvedPayload?.variant === 'event' ? resolvedPayload : null,
    ctaPriceLabel: formatLandingPageEventCtaPriceLabel(eventRecord),
    spacesLeft: spacesLeft ?? undefined,
    eyebrowDateLabel: formatHeroFullDateLine(firstStartDateTime, normalizedLocale),
  };
}

export function getLandingPageStructuredDataContentFromPayload(
  payload: unknown,
  slug: string,
): LandingPageStructuredDataContent | null {
  const eventRecord = findLandingPageEventInPayload(payload, slug);
  if (!eventRecord) {
    return null;
  }

  const title = readCandidateText(eventRecord, ['title', 'name', 'eventTitle']);
  if (!title) {
    return null;
  }

  const firstDateRecord = findFirstEventDateRecord(eventRecord);
  if (!firstDateRecord) {
    return null;
  }

  const startDateTime = readCandidateText(firstDateRecord, [
    'start_datetime',
    'startDateTime',
    'start',
  ]);
  if (!startDateTime) {
    return null;
  }

  const parsedStartDate = new Date(startDateTime);
  if (Number.isNaN(parsedStartDate.getTime())) {
    return null;
  }

  const endDateTime = readCandidateText(firstDateRecord, [
    'end_datetime',
    'endDateTime',
    'end',
  ]);
  const parsedEndDate = endDateTime ? new Date(endDateTime) : null;
  const endDate =
    parsedEndDate && !Number.isNaN(parsedEndDate.getTime())
      ? parsedEndDate.toISOString()
      : undefined;

  const description = readCandidateText(eventRecord, [
    'description',
    'summary',
    'details',
    'excerpt',
    'body',
  ]) ?? title;
  const locationAddress = readCandidateText(eventRecord, [
    'location_address',
    'locationAddress',
    'venueAddress',
    'address',
  ]);
  const locationName = readCandidateText(eventRecord, [
    'location_name',
    'locationName',
    'venue',
    'location_address',
    'locationAddress',
  ]) ?? extractTrailingLocationSegment(locationAddress);
  const offerPriceNumeric = resolveNumericCandidate(eventRecord, [
    'price',
    'cost',
    'amount',
    'fee',
    'eventPrice',
    'event_price',
  ]);
  const offerCurrency = readCandidateText(eventRecord, [
    'currency',
    'priceCurrency',
    'price_currency',
  ]);

  return {
    eventName: title,
    description,
    startDate: parsedStartDate.toISOString(),
    endDate,
    locationName: locationName ?? undefined,
    locationAddress: locationAddress ?? undefined,
    offerPrice: offerPriceNumeric === null ? undefined : String(offerPriceNumeric),
    offerCurrency: offerPriceNumeric === null ? undefined : (offerCurrency ?? 'HKD'),
    offerAvailability:
      resolveEventStatus(eventRecord) === 'fully_booked' ? 'SoldOut' : 'InStock',
  };
}

function resolveServiceTypeForCalendarRecord(
  record: Record<string, unknown>,
): string {
  const fromServiceType = readCandidateText(record, ['service_type', 'serviceType']);
  if (fromServiceType) {
    return fromServiceType.trim().toLowerCase();
  }

  const fromService = readCandidateText(record, ['service'])?.trim().toLowerCase() ?? '';
  if (fromService === 'training-course' || fromService === 'training_course') {
    return 'training_course';
  }

  return '';
}

function recordToMyBestAuntieEventCohort(
  record: Record<string, unknown>,
): MyBestAuntieEventCohort | null {
  const slug =
    readCandidateText(record, ['slug', 'id', 'eventId'])?.trim() ?? '';
  const serviceTier = readCandidateText(record, ['service_tier']) ?? '';
  const cohortValue = readCandidateText(record, ['cohort']) ?? '';
  if (!slug || !serviceTier || !cohortValue) {
    return null;
  }

  const title = readCandidateText(record, ['title']) ?? '';
  const description = readCandidateText(record, ['description']) ?? '';
  const spacesTotal = resolveNumericCandidate(record, ['spaces_total']) ?? 0;
  const spacesLeft = resolveNumericCandidate(record, ['spaces_left']) ?? 0;
  const price = resolveNumericCandidate(record, ['price']) ?? 0;
  const currency = readCandidateText(record, ['currency']) ?? 'HKD';
  const location = readCandidateText(record, ['location']) ?? 'physical';
  const locationAddress = readCandidateText(record, [
    'location_address',
    'locationAddress',
    'address',
  ]) ?? '';
  const locationName = readCandidateText(record, [
    'location_name',
    'locationName',
    'venue',
  ]) ?? locationAddress;
  const locationUrl = sanitizeGoogleMapsHref(
    readCandidateText(record, ['location_url', 'locationUrl', 'address_url']),
  );
  const dates = resolveBookingDateParts(record, '').map((partRow, idx) => {
    const part =
      typeof partRow.sessionPart === 'number' && partRow.sessionPart > 0
        ? partRow.sessionPart
        : idx + 1;
    return {
      part,
      start_datetime: partRow.startDateTime,
      end_datetime: partRow.endDateTime,
    };
  });
  if (dates.length === 0) {
    return null;
  }

  return {
    slug,
    service_tier: serviceTier,
    title,
    description,
    cohort: cohortValue,
    spaces_total: spacesTotal,
    spaces_left: spacesLeft,
    is_fully_booked: resolveEventStatus(record) === 'fully_booked',
    price,
    currency,
    location,
    booking_system: MY_BEST_AUNTIE_BOOKING_SYSTEM,
    tags: resolveStringList(record.tags),
    categories: resolveStringList(record.categories),
    location_name: locationName,
    location_address: locationAddress,
    location_url: locationUrl,
    dates,
  };
}

/**
 * MBA training-course cohort rows from a calendar public payload (API shape).
 */
export function normalizeMyBestAuntieCohortsFromPayload(
  payload: unknown,
): MyBestAuntieEventCohort[] {
  const cohorts: MyBestAuntieEventCohort[] = [];

  for (const entry of findEventsArray(payload)) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }

    const bookingSystem = readOptionalText(record.booking_system) ?? '';
    if (bookingSystem !== MY_BEST_AUNTIE_BOOKING_SYSTEM) {
      continue;
    }

    if (resolveServiceTypeForCalendarRecord(record) !== 'training_course') {
      continue;
    }

    const cohort = recordToMyBestAuntieEventCohort(record);
    if (!cohort) {
      continue;
    }

    cohorts.push(cohort);
  }

  cohorts.sort((left, right) => {
    const leftStart = left.dates[0]?.start_datetime?.trim() ?? '';
    const rightStart = right.dates[0]?.start_datetime?.trim() ?? '';
    const leftParsed = leftStart ? Date.parse(leftStart) : Number.NaN;
    const rightParsed = rightStart ? Date.parse(rightStart) : Number.NaN;
    const leftValue = Number.isNaN(leftParsed) ? Number.POSITIVE_INFINITY : leftParsed;
    const rightValue = Number.isNaN(rightParsed) ? Number.POSITIVE_INFINITY : rightParsed;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
    return left.slug.localeCompare(right.slug);
  });

  return cohorts;
}

export function sortUpcomingEvents(
  events: EventCardData[],
): EventCardData[] {
  const entries = events.map((event, index) => ({ event, index }));
  const now = Date.now();

  const upcomingEntries = entries.filter((entry) => {
    const timestamp = entry.event.timestamp;
    return timestamp === null || timestamp >= now;
  });
  upcomingEntries.sort((left, right) => {
    const leftValue = left.event.timestamp;
    const rightValue = right.event.timestamp;

    if (leftValue === null && rightValue === null) {
      return left.index - right.index;
    }
    if (leftValue === null) {
      return 1;
    }
    if (rightValue === null) {
      return -1;
    }
    if (leftValue === rightValue) {
      return left.index - right.index;
    }

    return leftValue - rightValue;
  });
  return upcomingEntries.map((entry) => entry.event);
}

export function sortPastEvents(
  events: EventCardData[],
): EventCardData[] {
  const entries = events.map((event, index) => ({ event, index }));
  const now = Date.now();
  const pastEntries = entries.filter((entry) => {
    const timestamp = entry.event.timestamp;
    return timestamp !== null && timestamp < now;
  });

  pastEntries.sort((left, right) => {
    const leftValue = left.event.timestamp;
    const rightValue = right.event.timestamp;
    if (leftValue === null || rightValue === null) {
      return left.index - right.index;
    }
    if (leftValue === rightValue) {
      return left.index - right.index;
    }

    return rightValue - leftValue;
  });

  return pastEntries
    .slice(0, MAX_PAST_EVENTS)
    .map((entry) => entry.event);
}

export function sortEvents(
  events: EventCardData[],
): EventCardData[] {
  return sortUpcomingEvents(events);
}
