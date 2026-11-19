/** Hong Kong civil calendar for fiscal-year classification (April–March). */
export const HONG_KONG_IANA_TIMEZONE = 'Asia/Hong_Kong';

/** First calendar year of the FY interval (1 April Y → 31 March Y+1). */
export function getFiscalYearRangeInclusive(startYear: number): { start: string; end: string; label: string } {
  const y = Math.floor(startYear);
  const start = `${y}-04-01`;
  const end = `${y + 1}-03-31`;
  const label = `FY${String(y).slice(-2)}–${String(y + 1).slice(-2)}`;
  return { start, end, label };
}

/** ISO `YYYY-MM-DD` comparison valid for same-calendar convention. */
export function isDateInInclusiveRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export function formatInstantAsHongKongDateString(iso: string | null | undefined): string | null {
  const raw = iso?.trim() ?? '';
  if (raw === '') {
    return null;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: HONG_KONG_IANA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Validates `YYYY-MM-DD` and rejects impossible calendar dates. */
export function parseIsoDateOnly(raw: string | null | undefined): string | null {
  const t = raw?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return null;
  }
  const [ys, ms, ds] = t.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const day = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return t;
}

/** Fiscal year start year Y such that `hongKongToday` falls in [April Y, March Y+1]. */
export function inferCurrentFiscalYearStartYear(hongKongDateStr: string): number {
  const parsed = parseIsoDateOnly(hongKongDateStr);
  if (!parsed) {
    return new Date().getUTCFullYear();
  }
  const y = Number(parsed.slice(0, 4));
  const monthDay = parsed.slice(5);
  if (monthDay >= '04-01') {
    return y;
  }
  return y - 1;
}

/** Today’s date string in Hong Kong (for default FY selection). */
export function todayHongKongDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: HONG_KONG_IANA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The next `00:00` in Hong Kong after `now`. Hong Kong is UTC+8 all year.
 * An open dashboard tab uses this to move the current month without a reload.
 */
export function nextHongKongMonthBoundary(now: Date = new Date()): Date {
  const today = todayHongKongDateString(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return new Date(Date.UTC(nextYear, nextMonth - 1, 1) - 8 * 60 * 60 * 1000);
}

/** Year options: `startYear` from `fromYear` through `throughYear` inclusive. */
export function enumerateFiscalYearStartYears(fromYear: number, throughYear: number): number[] {
  const lo = Math.min(fromYear, throughYear);
  const hi = Math.max(fromYear, throughYear);
  const out: number[] = [];
  for (let y = lo; y <= hi; y += 1) {
    out.push(y);
  }
  return out.reverse();
}
