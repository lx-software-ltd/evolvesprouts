import { getAdminDefaultCurrencyCode } from '@/lib/config';
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
  SessionSlot,
  SessionSlotFormRow,
} from '@/types/services';

import adminSelectableCurrency from '@shared-config/admin-selectable-currency-codes.json';

const SERVICE_TITLE_TIER_SEP = '\u00b7';
const DISPLAY_PART_SEP = ` ${SERVICE_TITLE_TIER_SEP} `;

/**
 * CRM contact line: `display name · email` when both exist; otherwise name, email, or id fallback.
 * Matches billing enrollment picker party labels for contact bill-to.
 */
export function formatContactNameEmailLabel(
  displayName: string,
  email: string | null | undefined,
  idFallback: string,
): string {
  const name = displayName.trim();
  const em = (email ?? '').trim();
  if (name) {
    return em ? `${name}${DISPLAY_PART_SEP}${em}` : name;
  }
  if (em) {
    return em;
  }
  return idFallback;
}

/** Admin CRM contact: first + last name trimmed, or empty string. */
export function formatAdminContactFullName(contact: {
  first_name?: string | null;
  last_name?: string | null;
}): string {
  return [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
}

/**
 * Select options and pickers: `name · email` when name is set; otherwise email or id.
 */
export function formatAdminContactPickerLabel(contact: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  id: string;
}): string {
  return formatContactNameEmailLabel(formatAdminContactFullName(contact), contact.email, contact.id);
}

/**
 * Family or organization party line: `entity · primary contact` when both exist (billing/enrollment convention).
 */
export function formatFamilyOrOrganizationPartyLabel(
  entityName: string | null | undefined,
  primaryContactName: string | null | undefined,
): string {
  const entity = entityName?.trim() ?? '';
  const primary = primaryContactName?.trim() ?? '';
  if (entity && primary) {
    return `${entity}${DISPLAY_PART_SEP}${primary}`;
  }
  if (entity) {
    return entity;
  }
  if (primary) {
    return primary;
  }
  return '';
}

/** Billing draft invoice enrollment picker — Party column: server `partyDisplayName` only. */
export function formatBillingEnrollmentPartyCell(row: {
  partyDisplayName?: string | null;
}): string {
  return row.partyDisplayName?.trim() ?? '';
}

/** Service enrollment list — Party cell: API label, else picker-derived labels by structural parent id. */
export function resolveEnrollmentListPartyLabel(
  enrollment: {
    partyDisplayName?: string | null;
    contactId?: string | null;
    familyId?: string | null;
    organizationId?: string | null;
  },
  labelByContactId: Map<string, string>,
  labelByFamilyId: Map<string, string>,
  labelByOrganizationId: Map<string, string>,
): string {
  const fromApi = enrollment.partyDisplayName?.trim();
  if (fromApi) {
    return fromApi;
  }
  const cid = enrollment.contactId?.trim();
  if (cid) {
    return labelByContactId.get(cid) ?? cid;
  }
  const fid = enrollment.familyId?.trim();
  if (fid) {
    return labelByFamilyId.get(fid) ?? fid;
  }
  const oid = enrollment.organizationId?.trim();
  if (oid) {
    return labelByOrganizationId.get(oid) ?? oid;
  }
  return '—';
}

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

/** Same date/time field choices as the app shell navbar timestamp (local TZ + default locale). */
export const NAVBAR_LOCAL_DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

const LOCAL_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  ...NAVBAR_LOCAL_DATETIME_OPTIONS,
  year: 'numeric',
});
const LOCAL_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

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

const SESSION_SLOT_TABLE_DATETIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Session slot start for instances table: `dd Mmm @ HH:mm` in local time (en-GB parts).
 */
export function formatSessionSlotStartsAtDisplay(iso: string | null | undefined): string {
  if (iso == null) {
    return '-';
  }
  const trimmed = iso.trim();
  if (!trimmed) {
    return '-';
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return '-';
  }
  const parts = SESSION_SLOT_TABLE_DATETIME_FORMATTER.formatToParts(parsed);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  if (!day || !month || !hour || !minute) {
    return '-';
  }
  const monthNorm = month.replace(/\.$/, '');
  return `${day} ${monthNorm} @ ${hour}:${minute}`;
}

function sessionSlotSortKey(slot: SessionSlot, index: number): number {
  const o = slot.sortOrder;
  if (typeof o === 'number' && Number.isFinite(o)) {
    return o;
  }
  return index;
}

/** Same ordering as legacy multi-slot display: `sort_order`, then start time, then index. */
export function orderSessionSlotsForDisplay(slots: SessionSlot[]): SessionSlot[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => {
      const ko = sessionSlotSortKey(a.slot, a.index) - sessionSlotSortKey(b.slot, b.index);
      if (ko !== 0) {
        return ko;
      }
      const ra = a.slot.startsAt?.trim() ?? '';
      const rb = b.slot.startsAt?.trim() ?? '';
      const ta = ra ? new Date(ra).getTime() : NaN;
      const tb = rb ? new Date(rb).getTime() : NaN;
      const fa = Number.isFinite(ta);
      const fb = Number.isFinite(tb);
      if (fa && fb && ta !== tb) {
        return ta - tb;
      }
      if (fa !== fb) {
        return fa ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ slot }) => slot);
}

/**
 * First session slot in {@link orderSessionSlotsForDisplay} order that has a
 * non-empty `startsAt` (for the instances table "First slot" column).
 */
export function getFirstSessionSlotForDisplay(slots: SessionSlot[]): SessionSlot | null {
  for (const slot of orderSessionSlotsForDisplay(slots)) {
    if (slot.startsAt?.trim()) {
      return slot;
    }
  }
  return null;
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

/** Timestamp of the earliest slot with a valid `startsAt`, or `null` if none. */
export function getFirstSessionSlotStartTimeMs(slots: SessionSlot[]): number | null {
  const ordered = orderSessionSlotsForDisplay(slots);
  for (const slot of ordered) {
    const raw = slot.startsAt?.trim() ?? '';
    if (!raw) {
      continue;
    }
    const ms = new Date(raw).getTime();
    if (Number.isFinite(ms)) {
      return ms;
    }
  }
  return null;
}

/**
 * Sort instances for the admin table: latest first session start first; instances
 * without slot times last (stable tie-break on id).
 */
export function compareInstancesByFirstSlotStartsDesc(a: ServiceInstance, b: ServiceInstance): number {
  const ta = getFirstSessionSlotStartTimeMs(a.sessionSlots);
  const tb = getFirstSessionSlotStartTimeMs(b.sessionSlots);
  if (ta == null && tb == null) {
    return a.id.localeCompare(b.id);
  }
  if (ta == null) {
    return 1;
  }
  if (tb == null) {
    return -1;
  }
  if (tb !== ta) {
    return tb - ta;
  }
  return a.id.localeCompare(b.id);
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

export function formatDate(value: string | null): string {
  if (!value) {
    return '—';
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return LOCAL_DATE_TIME_FORMATTER.format(parsedDate);
}

export function formatDateOnly(value: string | null): string {
  if (!value) {
    return '—';
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return LOCAL_DATE_FORMATTER.format(parsedDate);
}

export function localTodayYmd(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Format a `YYYY-MM-DD` calendar date without TZ shifting. */
export function formatYmdAsLocalDate(value: string | null): string {
  if (!value) {
    return '—';
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) {
    return value;
  }
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10) - 1;
  const day = Number.parseInt(m[3], 10);
  return LOCAL_DATE_FORMATTER.format(new Date(year, month, day));
}

export function formatDateForInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Map API ISO instant to `datetime-local` value in the browser's local timezone. */
export function formatIsoForDatetimeLocalInput(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

/** `YYYY-MM-DDTHH:mm` only (no offset, no seconds); used for `datetime-local` and strict parsing. */
export const DATETIME_LOCAL_WALL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function parseWallDatetimeLocalToUtcDate(trimmed: string): Date | null {
  if (!DATETIME_LOCAL_WALL_PATTERN.test(trimmed)) {
    return null;
  }
  const [datePart, timePart] = trimmed.split('T');
  const dateSegments = datePart.split('-').map(Number);
  const timeSegments = timePart.split(':').map(Number);
  if (
    dateSegments.length !== 3 ||
    timeSegments.length !== 2 ||
    dateSegments.some((n) => !Number.isFinite(n)) ||
    timeSegments.some((n) => !Number.isFinite(n))
  ) {
    return null;
  }
  const [y, mo, d] = dateSegments;
  const [hh, mm] = timeSegments;
  const parsed = new Date(y, mo - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

/**
 * Parse `datetime-local` wall time (`YYYY-MM-DDTHH:mm` only) and return UTC ISO for the API.
 * Uses explicit `Date(year, monthIndex, …)` construction (no `new Date(string)` for this shape).
 * Strings with offsets, `Z`, or seconds are rejected so callers do not double-shift instants.
 */
export function parseDatetimeLocalToIsoUtc(local: string): string | null {
  const trimmed = local.trim();
  if (!trimmed) {
    return null;
  }
  const wall = parseWallDatetimeLocalToUtcDate(trimmed);
  if (!wall) {
    return null;
  }
  return wall.toISOString();
}

/**
 * Parse admin date-time input: `YYYY-MM-DDTHH:mm` wall time (explicit local calendar fields),
 * or any other string accepted by `Date` (for example pasted RFC 3339 with `Z` or offset).
 */
export function parseAdminDateTimeInputToIsoUtc(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const wall = parseWallDatetimeLocalToUtcDate(trimmed);
  if (wall) {
    return wall.toISOString();
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

/** True if the string is exactly `YYYY-MM-DDTHH:mm` (not an offset ISO instant). */
export function isDatetimeLocalWallString(value: string): boolean {
  return DATETIME_LOCAL_WALL_PATTERN.test(value.trim());
}

/**
 * Normalize session slot times from the API (UTC ISO) into `datetime-local` wall strings
 * for editors. Values that are already `YYYY-MM-DDTHH:mm` are left unchanged.
 */
export function sessionSlotApiTimesToFormLocals(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined
): { startsAtLocal: string | null; endsAtLocal: string | null } {
  const toLocal = (value: string | null | undefined): string | null => {
    if (!value?.trim()) {
      return null;
    }
    const t = value.trim();
    if (DATETIME_LOCAL_WALL_PATTERN.test(t)) {
      return t;
    }
    const formatted = formatIsoForDatetimeLocalInput(t);
    return formatted || null;
  };
  return { startsAtLocal: toLocal(startsAt), endsAtLocal: toLocal(endsAt) };
}

/** Map API session slots to form rows (`startsAtLocal` / `endsAtLocal` are `datetime-local` wall times). */
export function mapSessionSlotsFromApiToForm(slots: SessionSlot[]): SessionSlotFormRow[] {
  return slots.map((slot) => {
    const { startsAtLocal, endsAtLocal } = sessionSlotApiTimesToFormLocals(slot.startsAt, slot.endsAt);
    return {
      id: slot.id,
      instanceId: slot.instanceId,
      locationId: slot.locationId,
      startsAtLocal,
      endsAtLocal,
      sortOrder: slot.sortOrder,
    };
  });
}

export type SessionSlotApiRow = {
  location_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
};

export type SessionSlotsUtcPayload =
  | { ok: true; session_slots: SessionSlotApiRow[] }
  | { ok: false; message: string };

/**
 * Build `session_slots` for create/update API payloads: only `YYYY-MM-DDTHH:mm` wall values
 * are accepted (rejects offset/Z ISO in form state to avoid double-shifting).
 */
export function buildSessionSlotsUtcPayload(slots: SessionSlotFormRow[]): SessionSlotsUtcPayload {
  const session_slots: SessionSlotApiRow[] = [];
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const startsRaw = (slot.startsAtLocal ?? '').trim();
    const endsRaw = (slot.endsAtLocal ?? '').trim();
    if (!startsRaw && !endsRaw) {
      session_slots.push({
        location_id: slot.locationId,
        starts_at: null,
        ends_at: null,
        sort_order: slot.sortOrder ?? index,
      });
      continue;
    }
    if (!startsRaw || !endsRaw) {
      return {
        ok: false,
        message: 'Each session slot needs both a start time and an end time.',
      };
    }
    if (!isDatetimeLocalWallString(startsRaw) || !isDatetimeLocalWallString(endsRaw)) {
      return {
        ok: false,
        message:
          'Session slot times must use the date and time pickers (local wall format). ' +
          'Remove any pasted offset or Z suffix and pick the slot times again.',
      };
    }
    const starts_at = parseDatetimeLocalToIsoUtc(startsRaw);
    const ends_at = parseDatetimeLocalToIsoUtc(endsRaw);
    if (!starts_at || !ends_at) {
      return {
        ok: false,
        message: 'One or more session slot times are invalid. Check start and end times.',
      };
    }
    if (new Date(starts_at).getTime() >= new Date(ends_at).getTime()) {
      return {
        ok: false,
        message: 'Each session slot must end after it starts.',
      };
    }
    session_slots.push({
      location_id: slot.locationId,
      starts_at,
      ends_at,
      sort_order: slot.sortOrder ?? index,
    });
  }
  return { ok: true, session_slots };
}
