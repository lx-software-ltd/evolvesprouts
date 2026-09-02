import { describe, expect, it } from 'vitest';

import {
  ADMIN_API_MAX_LIST_LIMIT,
  ADMIN_LIST_PAGE_SIZE,
  appendAdminQueryValue,
  buildAdminListPath,
  clampAdminListLimit,
} from '@/lib/admin-list-query';

describe('clampAdminListLimit', () => {
  it('clamps to max and minimum 1', () => {
    expect(clampAdminListLimit(ADMIN_API_MAX_LIST_LIMIT + 50)).toBe(ADMIN_API_MAX_LIST_LIMIT);
    expect(clampAdminListLimit(0)).toBe(1);
    expect(clampAdminListLimit(-5)).toBe(1);
  });

  it('preserves valid values', () => {
    expect(clampAdminListLimit(25)).toBe(25);
    expect(clampAdminListLimit(100)).toBe(100);
  });

  it('keeps the default page size within the API cap', () => {
    expect(ADMIN_LIST_PAGE_SIZE).toBeLessThanOrEqual(ADMIN_API_MAX_LIST_LIMIT);
  });
});

describe('appendAdminQueryValue', () => {
  it('skips empty values and serializes booleans, numbers, and arrays', () => {
    const query = new URLSearchParams();
    appendAdminQueryValue(query, 'blank', '  ');
    appendAdminQueryValue(query, 'nil', null);
    appendAdminQueryValue(query, 'off', false);
    appendAdminQueryValue(query, 'empty', []);
    appendAdminQueryValue(query, 'on', true);
    appendAdminQueryValue(query, 'count', 3);
    appendAdminQueryValue(query, 'nan', Number.NaN);
    appendAdminQueryValue(query, 'stage', ['new', ' won ', '']);
    appendAdminQueryValue(query, 'q', '  hello ');
    expect(query.toString()).toBe('on=true&count=3&stage=new%2Cwon&q=hello');
  });
});

describe('buildAdminListPath', () => {
  it('returns the base path when there are no parameters', () => {
    expect(buildAdminListPath('/v1/admin/tags')).toBe('/v1/admin/tags');
    expect(buildAdminListPath('/v1/admin/tags', { filters: { q: '' }, cursor: null })).toBe('/v1/admin/tags');
  });

  it('orders filters, then cursor, then clamped limit', () => {
    expect(
      buildAdminListPath('/v1/admin/leads', {
        filters: { stage: ['new'], unassigned: true },
        cursor: 'abc',
        limit: 500,
      })
    ).toBe('/v1/admin/leads?stage=new&unassigned=true&cursor=abc&limit=100');
  });

  it('ignores non-positive limits', () => {
    expect(buildAdminListPath('/v1/admin/leads', { limit: 0 })).toBe('/v1/admin/leads');
  });
});
