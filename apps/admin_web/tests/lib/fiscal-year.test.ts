import { describe, expect, it } from 'vitest';

import {
  enumerateFiscalYearStartYears,
  formatInstantAsHongKongDateString,
  getFiscalYearRangeInclusive,
  inferCurrentFiscalYearStartYear,
  isDateInInclusiveRange,
  parseIsoDateOnly,
  nextHongKongMonthBoundary,
  todayHongKongDateString,
} from '@/lib/fiscal-year';

describe('fiscal-year', () => {
  it('returns FY range and label', () => {
    expect(getFiscalYearRangeInclusive(2025)).toEqual({
      start: '2025-04-01',
      end: '2026-03-31',
      label: 'FY25–26',
    });
  });

  it('checks inclusive date range lexicographically', () => {
    expect(isDateInInclusiveRange('2025-04-01', '2025-04-01', '2026-03-31')).toBe(true);
    expect(isDateInInclusiveRange('2026-03-31', '2025-04-01', '2026-03-31')).toBe(true);
    expect(isDateInInclusiveRange('2025-03-31', '2025-04-01', '2026-03-31')).toBe(false);
    expect(isDateInInclusiveRange('2026-04-01', '2025-04-01', '2026-03-31')).toBe(false);
  });

  it('validates ISO date-only strings', () => {
    expect(parseIsoDateOnly('2025-02-29')).toBe(null);
    expect(parseIsoDateOnly('2024-02-29')).toBe('2024-02-29');
    expect(parseIsoDateOnly('not-a-date')).toBe(null);
  });

  it('infers fiscal start year from HK calendar date', () => {
    expect(inferCurrentFiscalYearStartYear('2025-04-01')).toBe(2025);
    expect(inferCurrentFiscalYearStartYear('2025-03-31')).toBe(2024);
  });

  it('formats instants in Hong Kong civil date', () => {
    expect(formatInstantAsHongKongDateString('2026-06-01T00:00:00.000Z')).toBe('2026-06-01');
  });

  it('enumerates fiscal start years descending', () => {
    expect(enumerateFiscalYearStartYears(2023, 2025)).toEqual([2025, 2024, 2023]);
  });

  it('returns the next Hong Kong month start as a UTC instant', () => {
    expect(nextHongKongMonthBoundary(new Date('2026-11-19T04:00:00.000Z')).toISOString()).toBe(
      '2026-11-30T16:00:00.000Z',
    );
    expect(nextHongKongMonthBoundary(new Date('2026-12-15T04:00:00.000Z')).toISOString()).toBe(
      '2026-12-31T16:00:00.000Z',
    );
  });

  it('returns today in Hong Kong as YYYY-MM-DD', () => {
    const s = todayHongKongDateString(new Date('2026-01-15T12:00:00.000Z'));
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
