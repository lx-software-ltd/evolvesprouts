import {
  type CalendarUnavailableSlot,
  deriveHalfDayBlockersFromSlots,
} from '@/lib/calendar-availability';
import { createPublicCrmApiClient } from '@/lib/crm-api-client';
import { CALENDAR_PUBLIC_CLIENT_FETCH_TIMEOUT_MS } from '@/lib/events-data';
import { PUBLIC_SITE_IANA_TIMEZONE } from '@/lib/site-datetime';

export const PUBLIC_CALENDAR_AVAILABILITY_API_PATH = '/v1/calendar/availability';

export type PublicCalendarAvailabilityPurpose = 'consultation_booking' | 'intro_call_booking';

export interface PublicCalendarSlot {
  startIso: string;
  endIso: string;
}

export interface PublicCalendarAvailabilityMeta {
  purpose: PublicCalendarAvailabilityPurpose | string;
  from: string;
  to: string;
  wallTimeZone: string;
  defaultHorizonDays: number;
  maxHorizonDays: number;
  maxForwardDays?: number;
  leadHours?: number;
  leadCalendarDays?: number;
}

export interface ConsultationCalendarAvailabilityFetchResult {
  slots: CalendarUnavailableSlot[];
  /** True when the CRM client is missing or the HTTP request failed. */
  fetchFailed: boolean;
}

export interface IntroCallSlot {
  startIso: string;
  endIso: string;
}

export interface IntroCallSlotsFetchResult {
  slots: IntroCallSlot[];
  fetchFailed: boolean;
}

export const INTRO_CALL_HORIZON_DAYS = 21;

const SITE_YMD_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: PUBLIC_SITE_IANA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const SITE_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PUBLIC_SITE_IANA_TIMEZONE,
  weekday: 'short',
});

/** YYYY-MM-DD for the calendar date of `instant` in {@link PUBLIC_SITE_IANA_TIMEZONE}. */
export function ymdFromSiteTimeZone(instant: Date): string {
  return SITE_YMD_FORMATTER.format(instant);
}

const _WEEKDAY_TO_OFFSET: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const _SITE_YMD_ONLY = new Intl.DateTimeFormat('en-CA', {
  timeZone: PUBLIC_SITE_IANA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** UTC instant when the calendar date is `ymd` at 00:00 in {@link PUBLIC_SITE_IANA_TIMEZONE}. */
function utcMillisForSiteWallMidnight(ymd: string): number {
  const [y, mo, d] = ymd.split('-').map((part) => Number(part));
  let utc = Date.UTC(y, mo - 1, d, 0, 0, 0);
  for (let i = 0; i < 48; i += 1) {
    if (_SITE_YMD_ONLY.format(new Date(utc)) === ymd) {
      return utc;
    }
    utc += 3600000;
  }
  return Date.UTC(y, mo - 1, d, 0, 0, 0);
}

/** Noon on `ymd` in the site IANA zone (works for DST zones; not hardcoded to +08). */
function noonSiteOnYmd(ymd: string): Date {
  return new Date(utcMillisForSiteWallMidnight(ymd) + 12 * 3600000);
}

/**
 * Monday of the ISO week containing `instant`, in the site IANA zone (same “today” as the
 * consultation picker). Returned as noon that Monday in +08:00 for stable day arithmetic.
 */
function startOfWeekMondaySiteTz(instant: Date): Date {
  const ymd = ymdFromSiteTimeZone(instant);
  const noon = noonSiteOnYmd(ymd);
  const wdLabel = SITE_WEEKDAY_FORMATTER.format(noon);
  const dow = _WEEKDAY_TO_OFFSET[wdLabel] ?? 0;
  const offsetFromMonday = (dow + 6) % 7;
  return new Date(noon.getTime() - offsetFromMonday * 86400000);
}

/** Inclusive end date: start Monday + 119 days (17 weeks − 1 day), still ≤120-day API span. */
export function buildConsultationBlockersQueryRange(now: Date): { fromYmd: string; toYmd: string } {
  const start = startOfWeekMondaySiteTz(now);
  const end = new Date(start.getTime() + 119 * 86400000);
  return { fromYmd: ymdFromSiteTimeZone(start), toYmd: ymdFromSiteTimeZone(end) };
}

function buildPublicCalendarAvailabilityPath(params: {
  purpose: PublicCalendarAvailabilityPurpose;
  fromYmd: string;
  toYmd: string;
}): string {
  const search = new URLSearchParams();
  search.set('purpose', params.purpose);
  search.set('from', params.fromYmd);
  search.set('to', params.toYmd);
  return `${PUBLIC_CALENDAR_AVAILABILITY_API_PATH}?${search.toString()}`;
}

function firstDefinedString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return c.trim();
    }
  }
  return '';
}

function parseAvailabilityPayload(payload: unknown): {
  slots: PublicCalendarSlot[];
  meta: PublicCalendarAvailabilityMeta | null;
} {
  if (!payload || typeof payload !== 'object') {
    return { slots: [], meta: null };
  }
  const rawSlots = (payload as { slots?: unknown }).slots;
  const rawMeta = (payload as { meta?: unknown }).meta;
  const slots: PublicCalendarSlot[] = [];
  if (Array.isArray(rawSlots)) {
    for (const row of rawSlots) {
      if (!row || typeof row !== 'object') {
        continue;
      }
      const r = row as Record<string, unknown>;
      const startIso = firstDefinedString(r.start_iso, r.startIso);
      const endIso = firstDefinedString(r.end_iso, r.endIso);
      if (startIso && endIso) {
        slots.push({ startIso, endIso });
      }
    }
  }
  let meta: PublicCalendarAvailabilityMeta | null = null;
  if (rawMeta && typeof rawMeta === 'object') {
    const m = rawMeta as Record<string, unknown>;
    const wall = firstDefinedString(m.wall_time_zone, m.wallTimeZone);
    meta = {
      purpose: typeof m.purpose === 'string' ? m.purpose : '',
      from: typeof m.from === 'string' ? m.from : '',
      to: typeof m.to === 'string' ? m.to : '',
      wallTimeZone: wall,
      defaultHorizonDays: typeof m.default_horizon_days === 'number' ? m.default_horizon_days : 0,
      maxHorizonDays: typeof m.max_horizon_days === 'number' ? m.max_horizon_days : 0,
      maxForwardDays: typeof m.max_forward_days === 'number' ? m.max_forward_days : undefined,
      leadHours: typeof m.lead_hours === 'number' ? m.lead_hours : undefined,
      leadCalendarDays:
        typeof m.lead_calendar_days === 'number' ? m.lead_calendar_days : undefined,
    };
  }
  return { slots, meta };
}

export async function fetchPublicCalendarAvailability(params: {
  purpose: PublicCalendarAvailabilityPurpose;
  fromYmd: string;
  toYmd: string;
  signal: AbortSignal;
}): Promise<{
  slots: PublicCalendarSlot[];
  meta: PublicCalendarAvailabilityMeta | null;
  fetchFailed: boolean;
}> {
  const client = createPublicCrmApiClient();
  if (!client) {
    return { slots: [], meta: null, fetchFailed: true };
  }
  const payload = await client.request({
    endpointPath: buildPublicCalendarAvailabilityPath(params),
    method: 'GET',
    signal: params.signal,
    bypassGetCache: true,
  });
  const parsed = parseAvailabilityPayload(payload);
  return { ...parsed, fetchFailed: false };
}

/** Attempts per availability fetch (matches the deploy-guard convention in CI). */
export const CALENDAR_AVAILABILITY_FETCH_ATTEMPTS = 2;

export interface AvailabilityFetchRetryOptions {
  attempts?: number;
  timeoutMs?: number;
}

/**
 * Availability fetch with a per-attempt timeout and retry, so one Lambda cold start or
 * transient network failure does not surface as a terminal picker error. The caller's
 * `unmountSignal` only signals component unmount; each attempt gets its own controller.
 */
async function fetchPublicCalendarAvailabilityWithRetry(
  params: {
    purpose: PublicCalendarAvailabilityPurpose;
    fromYmd: string;
    toYmd: string;
    unmountSignal: AbortSignal;
  },
  options: AvailabilityFetchRetryOptions = {},
): Promise<{
  slots: PublicCalendarSlot[];
  meta: PublicCalendarAvailabilityMeta | null;
  fetchFailed: boolean;
}> {
  const attempts = Math.max(1, options.attempts ?? CALENDAR_AVAILABILITY_FETCH_ATTEMPTS);
  const timeoutMs = options.timeoutMs ?? CALENDAR_PUBLIC_CLIENT_FETCH_TIMEOUT_MS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (params.unmountSignal.aborted) {
      break;
    }
    const attemptController = new AbortController();
    const abortAttempt = () => {
      attemptController.abort();
    };
    params.unmountSignal.addEventListener('abort', abortAttempt);
    const timeoutId = setTimeout(abortAttempt, timeoutMs);
    try {
      const result = await fetchPublicCalendarAvailability({
        purpose: params.purpose,
        fromYmd: params.fromYmd,
        toYmd: params.toYmd,
        signal: attemptController.signal,
      });
      // fetchFailed here only means the CRM client is unconfigured; retrying cannot help.
      return result;
    } catch {
      // Timeout or transport error: fall through to the next attempt unless unmounted.
    } finally {
      clearTimeout(timeoutId);
      params.unmountSignal.removeEventListener('abort', abortAttempt);
    }
  }
  return { slots: [], meta: null, fetchFailed: true };
}

/**
 * Consultation half-day unavailable slots derived from discrete availability slots (same modal shape
 * as the legacy blockers API).
 */
export async function fetchConsultationCalendarAvailability(
  signal: AbortSignal,
  options: AvailabilityFetchRetryOptions = {},
): Promise<ConsultationCalendarAvailabilityFetchResult> {
  const { fromYmd, toYmd } = buildConsultationBlockersQueryRange(new Date());

  const { slots, meta, fetchFailed } = await fetchPublicCalendarAvailabilityWithRetry(
    {
      purpose: 'consultation_booking',
      fromYmd,
      toYmd,
      unmountSignal: signal,
    },
    options,
  );
  if (fetchFailed) {
    return { slots: [], fetchFailed: true };
  }
  const wall = meta?.wallTimeZone?.trim();
  if (!wall) {
    return { slots: [], fetchFailed: true };
  }
  const derived = deriveHalfDayBlockersFromSlots(slots, wall, { fromYmd, toYmd });
  return { slots: derived, fetchFailed: false };
}

/** Backward-compatible name for {@link fetchConsultationCalendarAvailability}. */
export const fetchConsultationCalendarBlockersSlots = fetchConsultationCalendarAvailability;

export function ymdFromSiteTimeZoneForIntro(instant: Date): string {
  return ymdFromSiteTimeZone(instant);
}

export async function fetchIntroCallSlots(
  signal: AbortSignal,
  options: AvailabilityFetchRetryOptions = {},
): Promise<IntroCallSlotsFetchResult> {
  const now = new Date();
  const fromYmd = ymdFromSiteTimeZoneForIntro(now);
  const end = new Date(now.getTime() + INTRO_CALL_HORIZON_DAYS * 86400000);
  const toYmd = ymdFromSiteTimeZoneForIntro(end);

  const { slots, fetchFailed } = await fetchPublicCalendarAvailabilityWithRetry(
    {
      purpose: 'intro_call_booking',
      fromYmd,
      toYmd,
      unmountSignal: signal,
    },
    options,
  );
  if (fetchFailed) {
    return { slots: [], fetchFailed: true };
  }
  return { slots, fetchFailed: false };
}

export const INTRO_CALL_SLOTS_API_PATH = PUBLIC_CALENDAR_AVAILABILITY_API_PATH;

export function buildIntroCallSlotsApiPath(params: { fromYmd: string; toYmd: string }): string {
  const search = new URLSearchParams();
  search.set('purpose', 'intro_call_booking');
  search.set('from', params.fromYmd);
  search.set('to', params.toYmd);
  return `${PUBLIC_CALENDAR_AVAILABILITY_API_PATH}?${search.toString()}`;
}

export { CALENDAR_PUBLIC_CLIENT_FETCH_TIMEOUT_MS };
