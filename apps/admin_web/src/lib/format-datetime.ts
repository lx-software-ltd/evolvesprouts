import type { ServiceInstance, SessionSlot, SessionSlotFormRow } from '@/types/services';

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
