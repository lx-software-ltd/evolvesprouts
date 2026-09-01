import { describe, expect, it } from 'vitest';

import {
  computeLatLngErrors,
  evaluateInlineLocationDraft,
  parseOptionalCoordinate,
} from '@/components/admin/locations/inline-location-validation';

describe('parseOptionalCoordinate', () => {
  it('returns null for empty or whitespace', () => {
    expect(parseOptionalCoordinate('')).toBeNull();
    expect(parseOptionalCoordinate('   ')).toBeNull();
  });

  it('returns finite numbers for valid numeric strings', () => {
    expect(parseOptionalCoordinate('22.3')).toBe(22.3);
    expect(parseOptionalCoordinate('-114')).toBe(-114);
  });

  it('returns NaN for non-numeric input', () => {
    const r = parseOptionalCoordinate('abc');
    expect(Number.isNaN(r)).toBe(true);
  });
});

describe('computeLatLngErrors', () => {
  it('detects parse errors', () => {
    const e = computeLatLngErrors('x', '1');
    expect(e.latParseError).toBe(true);
    expect(e.coordinatesInvalid).toBe(true);
  });

  it('detects range errors', () => {
    const e = computeLatLngErrors('100', '0');
    expect(e.latRangeError).toBe(true);
    expect(e.coordinatesInvalid).toBe(true);
  });

  it('detects only one coordinate provided', () => {
    const e = computeLatLngErrors('1', '');
    expect(e.onlyOneCoordinate).toBe(true);
  });

  it('allows both empty', () => {
    const e = computeLatLngErrors('', '');
    expect(e.onlyOneCoordinate).toBe(false);
    expect(e.coordinatesInvalid).toBe(false);
  });
});

describe('evaluateInlineLocationDraft', () => {
  it('treats empty editing draft as valid and not persistable', () => {
    const draft = evaluateInlineLocationDraft({
      areaId: '',
      address: '',
      lat: '',
      lng: '',
      existingLocationId: null,
      isEditing: true,
      readOnly: false,
    });
    expect(draft.isEmpty).toBe(true);
    expect(draft.isInvalid).toBe(false);
    expect(draft.isPersistable).toBe(false);
  });

  it('allows area-only drafts to persist', () => {
    const draft = evaluateInlineLocationDraft({
      areaId: 'area-1',
      address: '',
      lat: '',
      lng: '',
      existingLocationId: null,
      isEditing: true,
      readOnly: false,
    });
    expect(draft.isInvalid).toBe(false);
    expect(draft.isPersistable).toBe(true);
  });

  it('marks address without area as invalid', () => {
    const draft = evaluateInlineLocationDraft({
      areaId: '',
      address: '1 Road',
      lat: '',
      lng: '',
      existingLocationId: null,
      isEditing: true,
      readOnly: false,
    });
    expect(draft.isInvalid).toBe(true);
    expect(draft.isPersistable).toBe(false);
  });

  it('marks a single coordinate as invalid', () => {
    const draft = evaluateInlineLocationDraft({
      areaId: 'area-1',
      address: '',
      lat: '22',
      lng: '',
      existingLocationId: null,
      isEditing: true,
      readOnly: false,
    });
    expect(draft.isInvalid).toBe(true);
    expect(draft.isPersistable).toBe(false);
  });

  it('does not flag summary or read-only drafts as invalid', () => {
    const summary = evaluateInlineLocationDraft({
      areaId: 'area-1',
      address: '1 Road',
      lat: 'x',
      lng: '',
      existingLocationId: 'loc-1',
      isEditing: false,
      readOnly: false,
    });
    expect(summary.isInvalid).toBe(false);
    expect(summary.isPersistable).toBe(false);

    const readOnly = evaluateInlineLocationDraft({
      areaId: '',
      address: '1 Road',
      lat: '',
      lng: '',
      existingLocationId: null,
      isEditing: true,
      readOnly: true,
    });
    expect(readOnly.isInvalid).toBe(false);
    expect(readOnly.isPersistable).toBe(false);
  });
});
