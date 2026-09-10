import { describe, expect, it } from 'vitest';

import { groupMapPinsByCoordinate } from '@/lib/contacts-map-pins';
import type { AdminContactMapPin } from '@/lib/entity-api';

function pin(overrides: Partial<AdminContactMapPin> & Pick<AdminContactMapPin, 'id' | 'label'>): AdminContactMapPin {
  return {
    entity_type: 'contact',
    area_name: 'Central',
    address: '1 Test Street',
    lat: 22.2819,
    lng: 114.1582,
    ...overrides,
  };
}

describe('groupMapPinsByCoordinate', () => {
  it('groups pins that share the same stored coordinates', () => {
    const family = pin({
      id: '11111111-1111-1111-1111-111111111111',
      entity_type: 'family',
      label: 'Chan family',
    });
    const org = pin({
      id: '22222222-2222-2222-2222-222222222222',
      entity_type: 'organization',
      label: 'Harbour School',
    });
    const other = pin({
      id: '33333333-3333-3333-3333-333333333333',
      label: 'Lee Wong',
      lat: 22.4,
      lng: 114.1,
    });

    const groups = groupMapPinsByCoordinate([family, org, other]);
    expect(groups).toHaveLength(2);
    const shared = groups.find((group) => group.items.length === 2);
    expect(shared?.items.map((item) => item.label)).toEqual(['Chan family', 'Harbour School']);
    const solo = groups.find((group) => group.items.length === 1);
    expect(solo?.items[0].label).toBe('Lee Wong');
  });

  it('skips pins with non-finite coordinates', () => {
    expect(
      groupMapPinsByCoordinate([
        pin({
          id: '44444444-4444-4444-4444-444444444444',
          label: 'Broken',
          lat: Number.NaN,
          lng: 114,
        }),
      ])
    ).toEqual([]);
  });
});
