import { describe, expect, it } from 'vitest';

import {
  asBoolean,
  asNullableFiniteNumber,
  asNullableString,
  asNumber,
  asStringArray,
  asTrimmedString,
} from '@/lib/api-payload';

describe('api-payload coercion helpers', () => {
  it('asNullableString returns strings and null for other values', () => {
    expect(asNullableString('a')).toBe('a');
    expect(asNullableString(1)).toBeNull();
    expect(asNullableString(undefined)).toBeNull();
  });

  it('asNumber falls back for non-finite or non-number values', () => {
    expect(asNumber(3)).toBe(3);
    expect(asNumber('3')).toBe(0);
    expect(asNumber(Number.NaN, 7)).toBe(7);
  });

  it('asNullableFiniteNumber parses numeric strings', () => {
    expect(asNullableFiniteNumber(1.5)).toBe(1.5);
    expect(asNullableFiniteNumber(' 22.3 ')).toBe(22.3);
    expect(asNullableFiniteNumber('')).toBeNull();
    expect(asNullableFiniteNumber('abc')).toBeNull();
  });

  it('asBoolean only accepts booleans', () => {
    expect(asBoolean(true)).toBe(true);
    expect(asBoolean('true', false)).toBe(false);
  });

  it('asTrimmedString trims and drops empty strings', () => {
    expect(asTrimmedString('  x ')).toBe('x');
    expect(asTrimmedString('   ')).toBeNull();
  });

  it('asStringArray keeps only string entries', () => {
    expect(asStringArray(['a', 1, 'b'])).toEqual(['a', 'b']);
    expect(asStringArray('a')).toEqual([]);
  });
});
