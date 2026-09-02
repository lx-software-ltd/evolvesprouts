import { getAdminDefaultCurrencyCode } from '@/lib/config';
import { DISPLAY_PART_SEP } from '@/lib/format-separators';
import { orderSessionSlotsForDisplay } from '@/lib/format-datetime';
import { formatAmountInCurrency } from '@/lib/vendor-spend';
import {
  CLIENT_DOCUMENT_ASSET_TAG,
  CUSTOMER_INVOICE_ASSET_TAG,
  EXPENSE_ATTACHMENT_ASSET_TAG,
} from '@/types/assets';
import type {
  DiscountCode,
  LocationSummary,
  ServiceInstance,
  ServiceSummary,
} from '@/types/services';

import adminSelectableCurrency from '@shared-config/admin-selectable-currency-codes.json';

export { DISPLAY_PART_SEP, SERVICE_TITLE_TIER_SEP } from '@/lib/format-separators';
export {
  formatAdminContactFullName,
  formatAdminContactPickerLabel,
  formatBillingEnrollmentPartyCell,
  formatContactNameEmailLabel,
  formatFamilyOrOrganizationPartyLabel,
  resolveEnrollmentListPartyLabel,
} from '@/lib/format-party-labels';
export {
  DATETIME_LOCAL_WALL_PATTERN,
  NAVBAR_LOCAL_DATETIME_OPTIONS,
  buildSessionSlotsUtcPayload,
  compareInstancesByFirstSlotStartsDesc,
  formatDate,
  formatDateForInput,
  formatDateOnly,
  formatIsoForDatetimeLocalInput,
  formatSessionSlotStartsAtDisplay,
  formatYmdAsLocalDate,
  getFirstSessionSlotForDisplay,
  getFirstSessionSlotStartTimeMs,
  isDatetimeLocalWallString,
  localTodayYmd,
  mapSessionSlotsFromApiToForm,
  orderSessionSlotsForDisplay,
  parseAdminDateTimeInputToIsoUtc,
  parseDatetimeLocalToIsoUtc,
  sessionSlotApiTimesToFormLocals,
} from '@/lib/format-datetime';
export type { SessionSlotApiRow, SessionSlotsUtcPayload } from '@/lib/format-datetime';

/** Service list label: title, space, interpunct, space, tier when tier is set. */
export function formatServiceTitleWithTier(title: string, serviceTier: string | null): string {
  const tier = serviceTier?.trim();
  if (tier) {
    return `${title}${DISPLAY_PART_SEP}${tier}`;
  }
  return title;
}

/** Title + optional tier + cohort for discount instance scope (editor select and table). */
export function formatDiscountCodeInstanceScopeLabel(
  instance: Pick<ServiceInstance, 'id' | 'title' | 'parentServiceTitle' | 'resolvedTitle' | 'parentServiceTier' | 'cohort'>
): string {
  const baseTitle =
    instance.title?.trim() ||
    instance.parentServiceTitle?.trim() ||
    instance.resolvedTitle?.trim() ||
    instance.id;
  const tier = instance.parentServiceTier?.trim();
  const cohort = instance.cohort?.trim();
  let label = baseTitle;
  if (tier) {
    label = `${label}${DISPLAY_PART_SEP}${tier}`;
  }
  if (cohort) {
    label = `${label}${DISPLAY_PART_SEP}${cohort}`;
  }
  return label;
}

/**
 * Discount code editor — instance scope select: instance `title` when set,
 * otherwise parent service title, then resolved title, then id; then optional
 * parent tier and cohort, each separated by space + interpunct + space when present.
 */
export function formatDiscountCodeInstanceOptionLabel(instance: ServiceInstance): string {
  return formatDiscountCodeInstanceScopeLabel(instance);
}

/** Discount codes table — scope column: same labels as the editor service/instance pickers. */
export function formatDiscountCodeScopeSummary(
  row: DiscountCode,
  serviceById: Map<string, ServiceSummary>,
  instanceById: ReadonlyMap<string, ServiceInstance>
): string {
  if (!row.serviceId && !row.instanceId) {
    return 'All services';
  }
  const serviceId = row.serviceId?.trim() ?? '';
  const instanceId = row.instanceId?.trim() ?? '';

  if (instanceId) {
    const resolved = instanceById.get(instanceId);
    if (resolved) {
      return formatDiscountCodeInstanceScopeLabel(resolved);
    }
    if (serviceId) {
      const svc = serviceById.get(serviceId);
      if (svc) {
        return formatDiscountCodeInstanceScopeLabel({
          id: instanceId,
          title: null,
          parentServiceTitle: svc.title?.trim() ? svc.title : null,
          resolvedTitle: null,
          parentServiceTier: svc.serviceTier,
          cohort: null,
        });
      }
    }
    return formatDiscountCodeInstanceScopeLabel({
      id: instanceId,
      title: null,
      parentServiceTitle: null,
      resolvedTitle: null,
      parentServiceTier: null,
      cohort: null,
    });
  }

  if (!serviceId) {
    return 'Service';
  }
  const svc = serviceById.get(serviceId);
  if (!svc) {
    return 'Service (unknown)';
  }
  return formatServiceTitleWithTier(svc.title, svc.serviceTier);
}

/** Short user-visible label for a location (venue name, address, or id). */
export function formatLocationLabel(location: LocationSummary): string {
  const name = location.name?.trim();
  if (name) {
    return name;
  }
  const address = location.address?.trim();
  if (address) {
    return address;
  }
  return location.id;
}

/** Partner-org name(s) in selects when present; otherwise venue/address label. */
export function formatInstanceLocationOptionLabel(location: LocationSummary): string {
  if (location.partnerOrganizationLabels.length > 0) {
    return location.partnerOrganizationLabels.join(', ');
  }
  return formatLocationLabel(location);
}

/** Instances table: instance title when set, otherwise parent service title only (tier/cohort use {@link formatInstanceTableTierCohort}). */
export function formatInstanceTableTitle(instance: ServiceInstance): string {
  const own = instance.title?.trim();
  if (own) {
    return own;
  }
  return instance.parentServiceTitle?.trim() ?? '';
}

/** Column header for the instances table tier + cohort column (space, interpunct, space between words). */
export const INSTANCE_TABLE_TIER_COHORT_HEADER = `Tier${DISPLAY_PART_SEP}Cohort`;

/** Billing enrollment picker — column header for instance title vs parent service name. */
export const ENROLLMENT_PICKER_INSTANCE_SERVICE_HEADER = `Instance${DISPLAY_PART_SEP}Service`;

/**
 * Billing enrollment picker cell: instance title when non-empty, otherwise parent service title.
 * Returns empty string when neither is present (caller may render an em dash).
 */
export function formatEnrollmentPickerInstanceServiceDisplay(row: {
  instanceTitle?: string | null;
  parentServiceTitle?: string | null;
}): string {
  const own = row.instanceTitle?.trim();
  if (own) {
    return own;
  }
  const parent = row.parentServiceTitle?.trim();
  if (parent) {
    return parent;
  }
  return '';
}

/**
 * Tier and cohort on one line (instances table, billing enrollment picker, and similar).
 * Uses space + interpunct + space only when both tier and cohort are non-empty after trim.
 * If only one is present, returns that value alone (no interpunct).
 * Returns empty string when neither is present (UI should show a single placeholder dash).
 */
export function formatTierCohortDisplay(
  tier: string | null | undefined,
  cohort: string | null | undefined,
): string {
  const t = tier?.trim() ?? '';
  const c = cohort?.trim() ?? '';
  if (t && c) {
    return `${t}${DISPLAY_PART_SEP}${c}`;
  }
  if (t) {
    return t;
  }
  if (c) {
    return c;
  }
  return '';
}

/** Instances table: seats remaining / max when capped; otherwise unlimited label. */
export function formatInstanceTableCapacity(instance: ServiceInstance): string {
  const max = instance.maxCapacity;
  if (max == null) {
    return 'Unlimited';
  }
  const used = instance.capacityEnrolledCount ?? 0;
  const rawRemaining = Math.max(0, max - used);
  const left =
    typeof instance.capacityLeftEffective === 'number'
      ? instance.capacityLeftEffective
      : rawRemaining;
  return `${left}/${max}`;
}

export function formatInstanceTableTierCohort(instance: ServiceInstance): string {
  return formatTierCohortDisplay(instance.parentServiceTier, instance.cohort);
}

/** Full venue label: address (when present) plus geographic area name. */
export function formatEntityVenueLocationLabel(location: {
  name?: string | null;
  address?: string | null;
  areaName?: string | null;
  id: string;
}): string {
  const address = location.address?.trim();
  const area = location.areaName?.trim();
  const name = location.name?.trim();
  const parts: string[] = [];
  if (address) {
    parts.push(address);
  } else if (name) {
    parts.push(name);
  }
  if (area) {
    parts.push(area);
  }
  if (parts.length > 0) {
    return parts.join(' · ');
  }
  return location.id;
}

const COORD_DISPLAY_FRACTION_DIGITS = 5;

/** Single-line coordinates display for admin location summaries. */
export function formatLocationCoordinatesLabel(lat: number | null, lng: number | null): string {
  if (lat !== null && lng !== null) {
    return `${lat.toFixed(COORD_DISPLAY_FRACTION_DIGITS)}, ${lng.toFixed(COORD_DISPLAY_FRACTION_DIGITS)}`;
  }
  return 'No coordinates set';
}

/**
 * Split on underscores, capitalize the first character of each segment, join with spaces.
 * Drops empty segments (for example from consecutive underscores). Does not normalize each
 * segment’s body to lowercase; most admin UI should call {@link formatEnumLabel} instead so API
 * snake_case enums render consistently.
 */
export function toTitleCase(value: string): string {
  return value
    .split('_')
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** User-visible label for snake_case API enums (trim, lowercase words, then {@link toTitleCase}). */
export function formatEnumLabel(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    return '';
  }
  return toTitleCase(trimmed.toLowerCase());
}

/** User-visible label for an asset tag name (API snake_case). */
export function formatAssetTagDisplayName(tagName: string): string {
  const lower = tagName.toLowerCase();
  if (lower === EXPENSE_ATTACHMENT_ASSET_TAG) {
    return 'Expense';
  }
  if (lower === CLIENT_DOCUMENT_ASSET_TAG) {
    return 'Client';
  }
  if (lower === CUSTOMER_INVOICE_ASSET_TAG) {
    return 'Invoices';
  }
  return formatEnumLabel(tagName);
}

const DEFAULT_CURRENCY_LABEL_HKD = 'Hong Kong Dollar';

const ADMIN_SELECTABLE_CURRENCY_CODES = adminSelectableCurrency.codes as readonly string[];

function getAdminSelectableCurrencyCodesOrdered(): string[] {
  const defaultCode = getAdminDefaultCurrencyCode();
  const inAllowlist = ADMIN_SELECTABLE_CURRENCY_CODES.includes(defaultCode);
  if (inAllowlist) {
    return [defaultCode, ...ADMIN_SELECTABLE_CURRENCY_CODES.filter((c) => c !== defaultCode)];
  }
  return [defaultCode, ...ADMIN_SELECTABLE_CURRENCY_CODES];
}

type CurrencyOption = {
  value: string;
  label: string;
};

let cachedCurrencyOptions: CurrencyOption[] | null = null;

function getCurrencyName(code: string): string {
  if (typeof Intl.DisplayNames === 'undefined') {
    return code;
  }

  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function collectDistinctLocationLabels(
  locationById: Map<string, LocationSummary>,
  ids: Iterable<string | null | undefined>
): string[] {
  const labels = new Map<string, string>();
  for (const raw of ids) {
    const id = raw?.trim();
    if (!id || labels.has(id)) {
      continue;
    }
    const loc = locationById.get(id);
    labels.set(id, loc ? formatInstanceLocationOptionLabel(loc) : id);
  }
  return [...labels.values()];
}

/**
 * Distinct venue labels for instance default, session slots, and partner org venues.
 */
export function formatInstanceSlotLocationSummary(
  instance: ServiceInstance,
  locationById: Map<string, LocationSummary>
): string {
  const idSequence: string[] = [];
  const resolved = instance.locationId ?? instance.resolvedLocationId;
  if (resolved?.trim()) {
    idSequence.push(resolved);
  }
  for (const slot of orderSessionSlotsForDisplay(instance.sessionSlots)) {
    if (slot.locationId?.trim()) {
      idSequence.push(slot.locationId);
    }
  }
  for (const partner of instance.partnerOrganizations) {
    if (partner.locationId?.trim()) {
      idSequence.push(partner.locationId);
    }
  }
  const labels = collectDistinctLocationLabels(locationById, idSequence);
  if (labels.length === 0) {
    return '-';
  }
  return labels.join(' · ');
}

function parseDecimalAmountString(raw: string | null | undefined): number | null {
  if (raw == null) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

function resolveIsoCurrencyCode(code: string | null | undefined): string {
  const trimmed = code?.trim().toUpperCase() ?? '';
  return trimmed.length === 3 ? trimmed : getAdminDefaultCurrencyCode();
}

/**
 * One-line default pricing for the admin services list (training/event default price;
 * consultation Free, hourly rate, or package price). Amounts use the same currency
 * formatting as the Vendors total spend column ({@link formatAmountInCurrency}).
 */
export function formatServiceListPriceLabel(service: ServiceSummary): string {
  if (service.serviceType === 'training_course') {
    const d = service.trainingDetails;
    if (!d) {
      return '—';
    }
    const amount = parseDecimalAmountString(d.defaultPrice);
    if (amount == null) {
      return '—';
    }
    return formatAmountInCurrency(amount, resolveIsoCurrencyCode(d.defaultCurrency));
  }
  if (service.serviceType === 'event') {
    const d = service.eventDetails;
    if (!d) {
      return '—';
    }
    const amount = parseDecimalAmountString(d.defaultPrice);
    if (amount == null) {
      return '—';
    }
    return formatAmountInCurrency(amount, resolveIsoCurrencyCode(d.defaultCurrency));
  }
  if (service.serviceType === 'consultation' || service.serviceType === 'intro_call') {
    const d = service.consultationDetails;
    if (!d) {
      return '—';
    }
    if (d.pricingModel === 'free') {
      return 'Free';
    }
    if (d.pricingModel === 'hourly') {
      const amount = parseDecimalAmountString(d.defaultHourlyRate);
      if (amount == null) {
        return '—';
      }
      const formatted = formatAmountInCurrency(amount, resolveIsoCurrencyCode(d.defaultCurrency));
      return `${formatted} / hr`;
    }
    if (d.pricingModel === 'package') {
      const amount = parseDecimalAmountString(d.defaultPackagePrice);
      if (amount == null) {
        return '—';
      }
      const formatted = formatAmountInCurrency(amount, resolveIsoCurrencyCode(d.defaultCurrency));
      if (typeof d.defaultPackageSessions === 'number' && d.defaultPackageSessions > 0) {
        return `${formatted} (${d.defaultPackageSessions} sessions)`;
      }
      return formatted;
    }
    return '—';
  }
  return '—';
}

export function getCurrencyOptions(): CurrencyOption[] {
  if (cachedCurrencyOptions) {
    return cachedCurrencyOptions;
  }

  const options = getAdminSelectableCurrencyCodesOrdered().map((code) => {
    if (code === 'HKD') {
      return { value: code, label: `${code} ${DEFAULT_CURRENCY_LABEL_HKD}` };
    }
    return { value: code, label: `${code} ${getCurrencyName(code)}` };
  });

  cachedCurrencyOptions = options;
  return options;
}

/** BCP 47 tags for admin asset content language (matches admin API allowlist). */
export const ADMIN_ASSET_CONTENT_LANGUAGE_TAGS = ['en', 'zh-CN', 'zh-HK'] as const;

const ADMIN_ASSET_CONTENT_LANGUAGE_LABELS: Record<
  (typeof ADMIN_ASSET_CONTENT_LANGUAGE_TAGS)[number],
  string
> = {
  en: 'English',
  'zh-CN': 'Mandarin (Simplified)',
  'zh-HK': 'Cantonese (Hong Kong)',
};

type ContentLanguageOption = {
  value: string;
  label: string;
};

/**
 * Fixed allowlist for admin asset content-language dropdowns (ISO-style BCP 47 tags).
 * Same pattern as {@link getCurrencyOptions} (no module cache — avoids brittle test state).
 */
export function getContentLanguageOptions(): ContentLanguageOption[] {
  return ADMIN_ASSET_CONTENT_LANGUAGE_TAGS.map((tag) => ({
    value: tag,
    label: ADMIN_ASSET_CONTENT_LANGUAGE_LABELS[tag],
  }));
}

/**
 * Match stored API `content_language` to the admin allowlist, or detect unsupported values.
 */
export function matchAdminSelectableContentLanguage(
  value: string | null | undefined
): (typeof ADMIN_ASSET_CONTENT_LANGUAGE_TAGS)[number] | null | 'unrecognized' {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }
  const lower = raw.toLowerCase();
  for (const tag of ADMIN_ASSET_CONTENT_LANGUAGE_TAGS) {
    if (tag.toLowerCase() === lower) {
      return tag;
    }
  }
  return 'unrecognized';
}

/** User-visible label for an asset's stored content_language tag, or raw tag / em dash. */
export function formatAssetContentLanguageLabel(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) {
    return '—';
  }
  const lower = raw.toLowerCase();
  for (const tag of ADMIN_ASSET_CONTENT_LANGUAGE_TAGS) {
    if (tag.toLowerCase() === lower) {
      return ADMIN_ASSET_CONTENT_LANGUAGE_LABELS[tag];
    }
  }
  return raw;
}
