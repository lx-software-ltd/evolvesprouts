import { describe, expect, it } from 'vitest';

import {
  emphasizedTexts,
  highlightAuditJson,
  joinHighlightText,
} from '@/lib/audit-value-highlight';

describe('highlightAuditJson', () => {
  it('pretty-prints without emphasis when there is no counterpart', () => {
    const value = { first_name: 'Ann', last_name: 'Lee' };
    const segments = highlightAuditJson({ value });
    expect(joinHighlightText(segments)).toBe(JSON.stringify(value, null, 2));
    expect(emphasizedTexts(segments)).toEqual([]);
  });

  it('bolds only the changed field name and differing string in both snapshots', () => {
    const oldValues = { first_name: 'Ann', last_name: 'Lee', status: 'active' };
    const newValues = { first_name: 'Anne', last_name: 'Lee', status: 'active' };

    const oldSegments = highlightAuditJson({ value: oldValues, counterpart: newValues });
    const newSegments = highlightAuditJson({ value: newValues, counterpart: oldValues });

    expect(joinHighlightText(oldSegments)).toBe(JSON.stringify(oldValues, null, 2));
    expect(joinHighlightText(newSegments)).toBe(JSON.stringify(newValues, null, 2));
    expect(emphasizedTexts(oldSegments)).toEqual(['"first_name"', 'Ann']);
    expect(emphasizedTexts(newSegments)).toEqual(['"first_name"', 'Anne']);
  });

  it('bolds only the changed middle of a longer shared string', () => {
    const oldValues = { notes: 'Called on Monday about enrollment' };
    const newValues = { notes: 'Called on Tuesday about enrollment' };

    const oldSegments = highlightAuditJson({ value: oldValues, counterpart: newValues });
    const newSegments = highlightAuditJson({ value: newValues, counterpart: oldValues });

    expect(joinHighlightText(oldSegments)).toBe(JSON.stringify(oldValues, null, 2));
    expect(joinHighlightText(newSegments)).toBe(JSON.stringify(newValues, null, 2));
    expect(emphasizedTexts(oldSegments)).toEqual(['"notes"', 'Monday']);
    expect(emphasizedTexts(newSegments)).toEqual(['"notes"', 'Tuesday']);
  });

  it('recurses into nested objects so unchanged siblings stay regular weight', () => {
    const oldValues = {
      name: 'Ada',
      address: { city: 'Hong Kong', street: '1 Main St' },
    };
    const newValues = {
      name: 'Ada',
      address: { city: 'Kowloon', street: '1 Main St' },
    };

    const oldSegments = highlightAuditJson({ value: oldValues, counterpart: newValues });
    expect(joinHighlightText(oldSegments)).toBe(JSON.stringify(oldValues, null, 2));
    expect(emphasizedTexts(oldSegments)).toEqual(['"address"', '"city"', 'Hong Kong']);
    expect(emphasizedTexts(oldSegments)).not.toContain('"street"');
    expect(emphasizedTexts(oldSegments)).not.toContain('"name"');
  });

  it('bolds keys and values that exist only on one side', () => {
    const oldValues = { status: 'draft', total: '10.00' };
    const newValues = { status: 'draft', currency: 'HKD' };

    const oldSegments = highlightAuditJson({ value: oldValues, counterpart: newValues });
    const newSegments = highlightAuditJson({ value: newValues, counterpart: oldValues });

    expect(emphasizedTexts(oldSegments)).toEqual(['"total"', '"10.00"']);
    expect(emphasizedTexts(newSegments)).toEqual(['"currency"', '"HKD"']);
  });

  it('bolds a changed_fields entry even when redacted values look equal', () => {
    const oldValues = { bill_to_email: '***REDACTED***', status: 'draft' };
    const newValues = { bill_to_email: '***REDACTED***', status: 'draft' };
    const segments = highlightAuditJson({
      value: oldValues,
      counterpart: newValues,
      changedFields: ['bill_to_email'],
    });

    expect(emphasizedTexts(segments)).toEqual(['"bill_to_email"', '"***REDACTED***"']);
  });

  it('bolds changed array items without marking unchanged items', () => {
    const oldValues = { tags: ['alpha', 'beta'] };
    const newValues = { tags: ['alpha', 'gamma'] };
    const oldSegments = highlightAuditJson({ value: oldValues, counterpart: newValues });

    expect(joinHighlightText(oldSegments)).toBe(JSON.stringify(oldValues, null, 2));
    expect(emphasizedTexts(oldSegments)).toEqual(['"tags"', 'beta']);
  });
});
